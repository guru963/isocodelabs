import type { Worklist } from "../lib/types";

/** A floor update waiting on the phone. Only removed once the server has answered for it. */
export interface QueuedUpdate {
  /** Generated on the phone, so a retried send is stored only once by the server. */
  id: string;
  userId: string;
  milestoneId: string;
  workDate: string;
  qty: number;
  noteText?: string;
  capturedAt: string;
  /** The phone's work day when this was typed. Earlier than workDate means it was added late. */
  enteredOn?: string;
  /** Held as bytes until uploaded, then replaced by the URL so they are never sent twice. */
  photo?: Blob;
  voice?: Blob;
  photoUrl?: string;
  voiceUrl?: string;
  state: "PENDING" | "REJECTED";
  rejectCode?: string;
  rejectMessage?: string;
}

export interface SavedWorklist {
  worklist: Worklist;
  /** The phone's own date when fetched, used to count days passed while offline. */
  fetchedOn: string;
}

export interface OfflineStore {
  allUpdates(userId: string): Promise<QueuedUpdate[]>;
  putUpdate(update: QueuedUpdate): Promise<void>;
  deleteUpdate(id: string): Promise<void>;
  saveWorklist(userId: string, saved: SavedWorklist): Promise<void>;
  loadWorklist(userId: string): Promise<SavedWorklist | null>;
}

const DB_NAME = "tna-offline";
const UPDATES = "updates";
const WORKLISTS = "worklists";

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(UPDATES, { keyPath: "id" });
      request.result.createObjectStore(WORKLISTS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function createOfflineStore(factory: IDBFactory = indexedDB): OfflineStore {
  const database = open(factory);

  return {
    async allUpdates(userId) {
      const db = await database;
      const rows = await asPromise<QueuedUpdate[]>(db.transaction(UPDATES).objectStore(UPDATES).getAll());
      return rows
        .filter((row) => row.userId === userId)
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    },
    async putUpdate(update) {
      const transaction = (await database).transaction(UPDATES, "readwrite");
      transaction.objectStore(UPDATES).put(update);
      await committed(transaction);
    },
    async deleteUpdate(id) {
      const transaction = (await database).transaction(UPDATES, "readwrite");
      transaction.objectStore(UPDATES).delete(id);
      await committed(transaction);
    },
    async saveWorklist(userId, saved) {
      const transaction = (await database).transaction(WORKLISTS, "readwrite");
      transaction.objectStore(WORKLISTS).put(saved, userId);
      await committed(transaction);
    },
    async loadWorklist(userId) {
      const db = await database;
      const row = await asPromise<SavedWorklist | undefined>(db.transaction(WORKLISTS).objectStore(WORKLISTS).get(userId));
      return row ?? null;
    },
  };
}
