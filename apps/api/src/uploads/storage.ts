import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";

export interface StoredFile {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
}

export interface Storage {
  /** Saves a file and returns the URL it is served from. */
  save(content: Buffer, extension: string): Promise<string>;
  /**
   * Reads a saved file back by its name. Storage that has this serves files through the app;
   * local disk leaves it out and is served straight from the folder instead.
   */
  read?(name: string): Promise<StoredFile | null>;
}

const FILE_NAME = /^[0-9a-f-]{36}\.(jpg|png|webp|webm|ogg|m4a)$/;
const FILE_URL = /^\/files\/[0-9a-f-]{36}\.(jpg|png|webp|webm|ogg|m4a)$/;

/** Stops an update from pointing at anything other than a file this app stored. */
export const isStoredFileUrl = (url: string): boolean => FILE_URL.test(url);

/** A bare file name in the shape this app gives its files, and nothing that could walk a path. */
export const isStoredFileName = (name: string): boolean => FILE_NAME.test(name);

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  webm: "audio/webm",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

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

/**
 * Vercel Blob, for hosts whose disk is wiped between requests. Files are private: the store
 * never hands out a public address, and the app reads each one back when it is asked for, so
 * the files keep the same /files/... URLs the database already holds.
 */
export function createBlobStorage(token: string): Storage {
  return {
    async save(content, extension) {
      const name = `${randomUUID()}.${extension}`;
      await put(`files/${name}`, content, {
        access: "private",
        addRandomSuffix: false,
        contentType: CONTENT_TYPES[extension],
        token,
      });
      return `/files/${name}`;
    },
    async read(name) {
      if (!isStoredFileName(name)) return null;
      const found = await get(`files/${name}`, { access: "private", token });
      if (!found || found.statusCode !== 200) return null;
      return { stream: found.stream, contentType: found.blob.contentType, size: found.blob.size };
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
