import { ApiError, NetworkError } from "../lib/api";
import type { Worklist, WorklistStage } from "../lib/types";
import type { OfflineStore, QueuedUpdate, SavedWorklist } from "./store";

export interface SyncItem {
  id: string;
  milestoneId: string;
  workDate: string;
  qty: number;
  noteText?: string;
  photoUrl?: string;
  voiceUrl?: string;
  capturedAt: string;
  enteredOn?: string;
}

export type SyncResult =
  | { id: string; status: "ACCEPTED"; doneQty: number; plannedQty: number }
  | { id: string; status: "DUPLICATE" | "STALE" }
  | { id: string | null; status: "REJECTED"; code: string; message: string };

export interface Transport {
  upload(file: Blob): Promise<string>;
  sync(items: SyncItem[]): Promise<SyncResult[]>;
}

export interface FlushOutcome {
  /** The network failed part way. Whatever is left stays queued for the next try. */
  offline: boolean;
  /** The session ended. The queue is kept until the supervisor signs in again. */
  signedOut: boolean;
}

/** The API accepts up to 50 updates in one request. */
const BATCH_SIZE = 50;

export function newUpdateId(): string {
  // randomUUID needs HTTPS, and a phone on a factory LAN might be on plain HTTP.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export function localDate(now: Date): string {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * The work date for an update. The server decides what today is, so this starts from its
 * answer and adds the days the phone has counted since, for a phone offline for days.
 */
export function workDateFor(saved: SavedWorklist, today: string): string {
  const passed = Math.max(Math.round((utc(today) - utc(saved.fetchedOn)) / DAY_MS), 0);
  return new Date(utc(saved.worklist.today) + passed * DAY_MS).toISOString().slice(0, 10);
}

export interface StageView extends WorklistStage {
  /** Today's count including one still waiting to send. */
  shownTodayQty: number | null;
  shownDoneQty: number;
  /** The most that can be entered for today, and for the missed day, together. */
  maxToday: number;
  queued: QueuedUpdate | null;
  /** The missed day to ask about, or null once it has a count or the list is from another day. */
  missedDate: string | null;
}

/** Shows the phone's own unsent figures on top of the last list from the server. */
export function viewStages(worklist: Worklist, updates: readonly QueuedUpdate[], workDate: string): StageView[] {
  const isCurrentDay = workDate === worklist.today;
  return worklist.stages.map((stage) => {
    const queued =
      updates.find(
        (update) => update.milestoneId === stage.milestoneId && update.workDate === workDate,
      ) ?? null;
    const serverToday = isCurrentDay ? stage.todayQty : null;
    const pending = queued?.state === "PENDING" ? queued : null;
    // The server's missed day is only right for the day it sent the list.
    const missedPending = isCurrentDay && stage.missedDate
      ? updates.find(
          (update) =>
            update.milestoneId === stage.milestoneId && update.workDate === stage.missedDate && update.state === "PENDING",
        )
      : undefined;
    const base = stage.doneQty - (serverToday ?? 0) + (missedPending?.qty ?? 0);
    const shownTodayQty = pending ? pending.qty : serverToday;
    return {
      ...stage,
      queued,
      shownTodayQty,
      shownDoneQty: base + (shownTodayQty ?? 0),
      // Older saved lists have no cap, so they fall back to the planned quantity.
      maxToday: Math.max(Math.min(stage.plannedQty, stage.capQty ?? stage.plannedQty) - base, 0),
      missedDate: isCurrentDay && !missedPending ? stage.missedDate : null,
    };
  });
}

/** A newer count for the same stage and day replaces an unsent one, keeping its attachments. */
export async function enqueue(store: OfflineStore, update: QueuedUpdate): Promise<void> {
  const existing = (await store.allUpdates(update.userId)).filter(
    (item) => item.milestoneId === update.milestoneId && item.workDate === update.workDate && item.id !== update.id,
  );
  const merged = { ...update };
  for (const old of existing) {
    merged.photo ??= old.photo;
    merged.voice ??= old.voice;
    merged.photoUrl ??= old.photoUrl;
    merged.voiceUrl ??= old.voiceUrl;
  }
  await store.putUpdate(merged);
  for (const old of existing) await store.deleteUpdate(old.id);
}

function toSyncItem(update: QueuedUpdate): SyncItem {
  return {
    id: update.id,
    milestoneId: update.milestoneId,
    workDate: update.workDate,
    qty: update.qty,
    noteText: update.noteText,
    photoUrl: update.photoUrl,
    voiceUrl: update.voiceUrl,
    capturedAt: update.capturedAt,
    enteredOn: update.enteredOn,
  };
}

/** Sends everything waiting. Safe to run at any moment, because retries are stored only once. */
export async function flushQueue(store: OfflineStore, transport: Transport, userId: string): Promise<FlushOutcome> {
  try {
    const pending = (await store.allUpdates(userId)).filter((update) => update.state === "PENDING");
    const ready: QueuedUpdate[] = [];

    for (const update of pending) {
      const uploaded = await uploadFiles(store, transport, update);
      if (uploaded) ready.push(uploaded);
    }

    for (let start = 0; start < ready.length; start += BATCH_SIZE) {
      const batch = ready.slice(start, start + BATCH_SIZE);
      const results = await transport.sync(batch.map(toSyncItem));
      for (const result of results) {
        if (!result.id) continue;
        if (result.status === "REJECTED") {
          const update = batch.find((item) => item.id === result.id);
          if (update) {
            await store.putUpdate({
              ...update,
              state: "REJECTED",
              rejectCode: result.code,
              rejectMessage: result.message,
            });
          }
        } else {
          await store.deleteUpdate(result.id);
        }
      }
    }
    return { offline: false, signedOut: false };
  } catch (error) {
    if (error instanceof NetworkError) return { offline: true, signedOut: false };
    if (error instanceof ApiError && error.status === 401) return { offline: false, signedOut: true };
    // A server fault is treated like a lost network: nothing is dropped, and it retries later.
    if (error instanceof ApiError && error.status >= 500) return { offline: true, signedOut: false };
    throw error;
  }
}

/** Saves each URL as soon as it has one, so a lost connection never uploads a file twice. */
async function uploadFiles(store: OfflineStore, transport: Transport, update: QueuedUpdate): Promise<QueuedUpdate | null> {
  let current = update;
  try {
    if (current.photo) {
      const photoUrl = await transport.upload(current.photo);
      current = { ...current, photoUrl, photo: undefined };
      await store.putUpdate(current);
    }
    if (current.voice) {
      const voiceUrl = await transport.upload(current.voice);
      current = { ...current, voiceUrl, voice: undefined };
      await store.putUpdate(current);
    }
    return current;
  } catch (error) {
    // Too big or the wrong type will never succeed, so the supervisor has to decide.
    if (error instanceof ApiError && (error.status === 413 || error.status === 415 || error.status === 400)) {
      await store.putUpdate({ ...current, state: "REJECTED", rejectCode: "FILE_REFUSED", rejectMessage: error.message });
      return null;
    }
    // The server could not store this file just now. This update waits for the next try, with any
    // file already uploaded kept, but the rest of the queue still goes: one stuck voice note must
    // never hold back every other count on the phone.
    if (error instanceof ApiError && error.status >= 500) return null;
    throw error;
  }
}
