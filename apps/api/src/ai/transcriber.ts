import Groq, { toFile } from "groq-sdk";

/** Turns a voice note into text in the language it was spoken in. */
export interface Transcriber {
  transcribe(audio: Buffer, fileName: string): Promise<string>;
}

/**
 * Whisper on Groq: the same key and library as the note classifier, and no speech model to host.
 * Supervisors speak Tamil, so the language is given rather than guessed; that is faster, and stops
 * a short or noisy clip being heard as another language. Mixed-in English words still come through.
 */
export function createGroqTranscriber(apiKey: string, model: string, fetchImpl?: typeof fetch): Transcriber {
  const client = new Groq({
    apiKey,
    // Voice notes are capped at a few minutes; the queue retries a call that runs long.
    timeout: 45_000,
    maxRetries: 1,
    fetch: fetchImpl,
  });

  return {
    async transcribe(audio, fileName) {
      const result = await client.audio.transcriptions.create({
        file: await toFile(audio, fileName),
        model,
        language: "ta",
        temperature: 0,
        response_format: "json",
      });
      return result.text.trim();
    },
  };
}
