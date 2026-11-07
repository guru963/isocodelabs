import type { PrismaClient } from "@prisma/client";
import type { NoteClassifier } from "./classification.js";

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
export function createAiQueue(prisma: PrismaClient, classifier: NoteClassifier | null): AiQueue {
  const running = new Map<string, Promise<void>>();
  let timer: NodeJS.Timeout | undefined;

  async function process(issueId: string): Promise<void> {
    const issue = await prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue || issue.aiStatus !== "PENDING") return;

    if (!classifier) {
      await prisma.issue.update({
        where: { id: issueId },
        data: { aiStatus: "FAILED", aiError: "AI_NOT_CONFIGURED" },
      });
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
    }
  }

  function schedule(issueId: string): void {
    if (running.has(issueId)) return;
    const work = process(issueId)
      .catch((error: unknown) => console.error(`AI step failed for issue ${issueId}`, error))
      .finally(() => running.delete(issueId));
    running.set(issueId, work);
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
