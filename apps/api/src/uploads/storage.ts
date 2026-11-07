import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Storage {
  /** Saves a file and returns the URL it is served from. */
  save(content: Buffer, extension: string): Promise<string>;
}

const FILE_URL = /^\/files\/[0-9a-f-]{36}\.(jpg|png|webp|webm|ogg|m4a)$/;

/** Stops an update from pointing at anything other than a file this app stored. */
export const isStoredFileUrl = (url: string): boolean => FILE_URL.test(url);

/**
 * Local disk, standing in for object storage. Random names are the only protection for
 * these files, and many hosts erase local disk on redeploy. The TDD records both limits.
 */
export function createDiskStorage(directory: string): Storage {
  return {
    async save(content, extension) {
      await mkdir(directory, { recursive: true });
      const name = `${randomUUID()}.${extension}`;
      await writeFile(path.join(directory, name), content);
      return `/files/${name}`;
    },
  };
}

interface FileKind {
  extension: string;
  matches(bytes: Buffer): boolean;
}

const ascii = (bytes: Buffer, start: number, end: number) => bytes.toString("latin1", start, end);

const FILE_KINDS: readonly FileKind[] = [
  { extension: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { extension: "png", matches: (b) => ascii(b, 1, 4) === "PNG" },
  { extension: "webp", matches: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  { extension: "webm", matches: (b) => b.readUInt32BE(0) === 0x1a45dfa3 },
  { extension: "ogg", matches: (b) => ascii(b, 0, 4) === "OggS" },
  { extension: "m4a", matches: (b) => ascii(b, 4, 8) === "ftyp" },
];

/** Decides a file's type from its first bytes, because a client can claim any type or name. */
export function detectFileKind(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  return FILE_KINDS.find((kind) => kind.matches(bytes))?.extension ?? null;
}
