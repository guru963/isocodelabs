import type { PrismaClient } from "@prisma/client";
import { storedFileName } from "../uploads/storage.js";
import type { NoteClassifier } from "./classification.js";
import type { Transcriber } from "./transcriber.js";

/** What the queue needs to turn a voice note into text before the classifier reads it. */
export interface VoiceSupport {
  transcriber: Transcriber;
  /** Reads a stored file back, by the name in its /files/ URL. */
  load(name: string): Promise<Buffer | null>;
}

const MAX_ATTEMPTS = 3;
const SWEEP_MS = 60_000;

export interface AiQueue {
  /** Starts classifying in the background and returns straight away. */
  schedule(issueId: string): void;
  /** Picks up anything left PENDING, including after a server restart. */
  sweep(): Promise<void>;
  start(): void;
  stop(): void;
  /** Resolves when running work has finished. Used by shutdown and tests. */
  idle(): Promise<void>;
}

/**
 * The database is the queue: an issue stays PENDING until it succeeds or runs out of
 * attempts. It needs no broker, survives restarts, and suits one server at this volume.
 * `classifier` is null when no API key is set; notes then go straight to human review.
 */
export function createAiQueue(
  prisma: PrismaClient,
  classifier: NoteClassifier | null,
  /** Called when a result changes what screens show. */
  onChanged: () => Promise<void> = async () => undefined,
  /**
   * On a serverless host the function can be frozen once its response is sent. This hands each
   * piece of background work to the host, such as Vercel's waitUntil, so it is allowed to finish.
   */
  keepAlive: (work: Promise<unknown>) => void = () => undefined,
  /** Without it, a voice note with no typed words goes straight to a person, as before. */
  voice: VoiceSupport | null = null,
): AiQueue {
  const running = new Map<string, Promise<void>>();
  let timer: NodeJS.Timeout | undefined;

  /** Marks a note as needing a person, without spending an attempt: retrying would not help. */
  async function giveUp(issueId: string, reason: string): Promise<void> {
    await prisma.issue.update({ where: { id: issueId }, data: { aiStatus: "FAILED", aiError: reason } });
    await onChanged();
  }

  async function process(issueId: string): Promise<void> {
    const found = await prisma.issue.findUnique({
      where: { id: issueId },
      include: { dailyUpdate: { select: { voiceUrl: true } } },
    });
    if (!found || found.aiStatus !== "PENDING") return;
    let issue = found;

    // A voice note with no typed words: write down what was said, then read it like a typed note.
    // The transcript is saved on its own first, so a later classifier failure never repeats it.
    if (!issue.originalText) {
      const name = issue.dailyUpdate.voiceUrl ? storedFileName(issue.dailyUpdate.voiceUrl) : null;
      if (!name || !voice) return giveUp(issueId, "VOICE_NOT_TRANSCRIBED");
      const audio = await voice.load(name);
      if (!audio) return giveUp(issueId, "VOICE_FILE_MISSING");
      try {
        const text = await voice.transcriber.transcribe(audio, name);
        if (!text) return giveUp(issueId, "NO_SPEECH");
        issue = await prisma.issue.update({
          where: { id: issueId },
          data: { originalText: text },
          include: { dailyUpdate: { select: { voiceUrl: true } } },
        });
        await onChanged();
      } catch (error) {
        const attempts = issue.aiAttempts + 1;
        await prisma.issue.update({
          where: { id: issueId },
          data: {
            aiAttempts: attempts,
            aiStatus: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
            aiError: `TRANSCRIPTION: ${error instanceof Error ? error.message.slice(0, 480) : "Unknown error"}`,
          },
        });
        await onChanged();
        return;
      }
    }

    if (!classifier) {
      await prisma.issue.update({
        where: { id: issueId },
        data: { aiStatus: "FAILED", aiError: "AI_NOT_CONFIGURED" },
      });
      await onChanged();
      return;
    }

    try {
      const result = await classifier.classify(issue.originalText);
      await prisma.issue.update({
        where: { id: issueId },
        data: {
          aiStatus: "COMPLETED",
          aiAttempts: { increment: 1 },
          aiError: null,
          translatedText: result.translation,
          aiCategory: result.category,
          aiConfidence: result.confidence,
        },
      });
      await onChanged();
    } catch (error) {
      const attempts = issue.aiAttempts + 1;
      await prisma.issue.update({
        where: { id: issueId },
        data: {
          aiAttempts: attempts,
          aiStatus: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
          aiError: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
        },
      });
      await onChanged();
    }
  }

  function schedule(issueId: string): void {
    if (running.has(issueId)) return;
    const work = process(issueId)
      .catch((error: unknown) => console.error(`AI step failed for issue ${issueId}`, error))
      .finally(() => running.delete(issueId));
    running.set(issueId, work);
    keepAlive(work);
  }

  async function sweep(): Promise<void> {
    const pending = await prisma.issue.findMany({
      where: { aiStatus: "PENDING" },
      select: { id: true },
      take: 20,
    });
    for (const issue of pending) schedule(issue.id);
  }

  return {
    schedule,
    sweep,
    start() {
      timer = setInterval(() => void sweep().catch(console.error), SWEEP_MS);
      timer.unref();
      void sweep().catch(console.error);
    },
    stop() {
      clearInterval(timer);
    },
    async idle() {
      await Promise.all(running.values());
    },
  };
}
