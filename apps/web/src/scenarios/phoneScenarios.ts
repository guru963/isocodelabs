import { ApiError, NetworkError } from "../lib/api";
import { enqueue, flushQueue, type SyncItem, type SyncResult, type Transport } from "../offline/queue";
import type { OfflineStore, QueuedUpdate, SavedWorklist } from "../offline/store";

export interface ScenarioResult {
  group: string;
  title: string;
  setup: string;
  expected: string;
  actual: string;
  pass: boolean;
}

const GROUP = "Phone queue";
const USER = "scenario-supervisor";

/** The phone's queue, held in memory so the real IndexedDB queue on this device is never touched. */
function memoryStore(): OfflineStore & { rows: Map<string, QueuedUpdate> } {
  const rows = new Map<string, QueuedUpdate>();
  const lists = new Map<string, SavedWorklist>();
  return {
    rows,
    async allUpdates(userId) {
      return [...rows.values()].filter((r) => r.userId === userId).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    },
    async putUpdate(update) {
      rows.set(update.id, update);
    },
    async deleteUpdate(id) {
      rows.delete(id);
    },
    async saveWorklist(userId, saved) {
      lists.set(userId, saved);
    },
    async loadWorklist(userId) {
      return lists.get(userId) ?? null;
    },
  };
}

let clock = 0;
function update(overrides: Partial<QueuedUpdate>): QueuedUpdate {
  clock += 1;
  return {
    id: `u${clock}`,
    userId: USER,
    milestoneId: "cutting",
    workDate: "2026-11-06",
    qty: 100,
    capturedAt: `2026-11-06T10:00:${String(clock % 60).padStart(2, "0")}.000Z`,
    state: "PENDING",
    ...overrides,
  };
}

/** A fake server: answers every count as accepted unless told otherwise. */
function server(options: {
  upload?: (file: Blob) => Promise<string>;
  answer?: (item: SyncItem) => SyncResult;
  sync?: (items: SyncItem[]) => Promise<SyncResult[]>;
}): Transport & { sent: SyncItem[] } {
  const sent: SyncItem[] = [];
  return {
    sent,
    upload: options.upload ?? (async () => `/files/${Math.random().toString(36).slice(2)}.webm`),
    async sync(items) {
      if (options.sync) return options.sync(items);
      sent.push(...items);
      return items.map((item) => options.answer?.(item) ?? { id: item.id, status: "ACCEPTED", doneQty: item.qty, plannedQty: 1000 });
    },
  };
}

type Check = () => Promise<{ actual: string; pass: boolean }>;
const voice = () => new Blob(["voice"], { type: "audio/webm" });

const CASES: { title: string; setup: string; expected: string; run: Check }[] = [
  {
    title: "Everything sends when the signal is back",
    setup: "Three counts wait on the phone for three stages.",
    expected: "All three sent, queue empty",
    async run() {
      const store = memoryStore();
      for (const milestoneId of ["cutting", "stitching", "packing"]) await store.putUpdate(update({ milestoneId }));
      const fake = server({});
      const outcome = await flushQueue(store, fake, USER);
      const pass = fake.sent.length === 3 && store.rows.size === 0 && !outcome.offline;
      return { actual: `${fake.sent.length} sent, ${store.rows.size} left on the phone`, pass };
    },
  },
  {
    title: "Retry after a lost answer",
    setup: "The count reached the server, but the reply never came back, so the phone sends it again.",
    expected: "Server says duplicate, phone clears it",
    async run() {
      const store = memoryStore();
      await store.putUpdate(update({}));
      const fake = server({ answer: (item) => ({ id: item.id, status: "DUPLICATE" }) });
      await flushQueue(store, fake, USER);
      return { actual: store.rows.size === 0 ? "Cleared from the phone, not stored twice" : "Still on the phone", pass: store.rows.size === 0 };
    },
  },
  {
    title: "Signal lost half way",
    setup: "Two counts wait; the network drops while sending.",
    expected: "Phone shows offline, keeps both",
    async run() {
      const store = memoryStore();
      await store.putUpdate(update({ milestoneId: "cutting" }));
      await store.putUpdate(update({ milestoneId: "stitching" }));
      const fake = server({
        sync: async () => {
          throw new NetworkError("Failed to fetch");
        },
      });
      const outcome = await flushQueue(store, fake, USER);
      const pass = outcome.offline && store.rows.size === 2;
      return { actual: `${outcome.offline ? "Offline" : "Online"}, ${store.rows.size} kept`, pass };
    },
  },
  {
    title: "Voice note the server cannot store yet",
    setup: "One count carries a voice note and file storage is down (500); another count has no file.",
    expected: "Plain count sends, voice note waits",
    async run() {
      const store = memoryStore();
      const withVoice = update({ milestoneId: "cutting", voice: voice() });
      await store.putUpdate(withVoice);
      await store.putUpdate(update({ milestoneId: "stitching" }));
      const fake = server({
        upload: async () => {
          throw new ApiError(500, "STORAGE_FAILED", "Could not store the file");
        },
      });
      await flushQueue(store, fake, USER);
      const left = [...store.rows.values()];
      const pass = fake.sent.length === 1 && left.length === 1 && left[0]?.id === withVoice.id && left[0].state === "PENDING";
      return { actual: `${fake.sent.length} sent, ${left.length} waiting with its voice note`, pass };
    },
  },
  {
    title: "A file the server refuses",
    setup: "The supervisor attached a file of the wrong type (415).",
    expected: "Marked for the supervisor to fix, not retried",
    async run() {
      const store = memoryStore();
      const bad = update({ voice: new Blob(["x"], { type: "application/zip" }) });
      await store.putUpdate(bad);
      const fake = server({
        upload: async () => {
          throw new ApiError(415, "UNSUPPORTED_FILE", "This file type is not allowed");
        },
      });
      await flushQueue(store, fake, USER);
      const row = store.rows.get(bad.id);
      const pass = row?.state === "REJECTED" && row.rejectCode === "FILE_REFUSED" && fake.sent.length === 0;
      return { actual: row ? `${row.state === "REJECTED" ? "Shown as refused" : "Still pending"} (${row.rejectCode ?? "no code"})` : "Gone from the phone", pass };
    },
  },
  {
    title: "A file uploads, then the signal drops",
    setup: "The voice note uploads, then the count itself fails to send.",
    expected: "File kept as a link, never uploaded twice",
    async run() {
      const store = memoryStore();
      const item = update({ voice: voice() });
      await store.putUpdate(item);
      let uploads = 0;
      const upload = async () => {
        uploads += 1;
        return "/files/voice-1.webm";
      };
      await flushQueue(store, server({ upload, sync: async () => { throw new NetworkError("Failed to fetch"); } }), USER);
      await flushQueue(store, server({ upload }), USER);
      const pass = uploads === 1 && store.rows.size === 0;
      return { actual: `Uploaded ${uploads} time${uploads === 1 ? "" : "s"}, ${store.rows.size} left`, pass };
    },
  },
  {
    title: "Count corrected before it sends",
    setup: "Supervisor types 120 with a voice note, then changes it to 150 while offline.",
    expected: "Only 150 waits, voice note kept",
    async run() {
      const store = memoryStore();
      await enqueue(store, update({ qty: 120, voice: voice() }));
      await enqueue(store, update({ qty: 150 }));
      const left = [...store.rows.values()];
      const pass = left.length === 1 && left[0]?.qty === 150 && left[0].voice !== undefined;
      return { actual: `${left.length} waiting: ${left.map((r) => `${r.qty}${r.voice ? " with voice" : ""}`).join(", ")}`, pass };
    },
  },
  {
    title: "Session ran out",
    setup: "The supervisor's sign-in expired (401) while counts wait.",
    expected: "Asked to sign in, queue kept",
    async run() {
      const store = memoryStore();
      await store.putUpdate(update({}));
      const fake = server({
        sync: async () => {
          throw new ApiError(401, "UNAUTHENTICATED", "Please sign in");
        },
      });
      const outcome = await flushQueue(store, fake, USER);
      const pass = outcome.signedOut && store.rows.size === 1;
      return { actual: `${outcome.signedOut ? "Signed out" : "Not signed out"}, ${store.rows.size} kept`, pass };
    },
  },
  {
    title: "Server refuses one count",
    setup: "Of two counts, the server rejects one as more than planned.",
    expected: "Refused one shown with the reason, other cleared",
    async run() {
      const store = memoryStore();
      const big = update({ milestoneId: "cutting", qty: 99999 });
      await store.putUpdate(big);
      await store.putUpdate(update({ milestoneId: "stitching" }));
      const fake = server({
        answer: (item) =>
          item.id === big.id
            ? { id: item.id, status: "REJECTED", code: "OVER_PLANNED", message: "More than the order quantity" }
            : { id: item.id, status: "ACCEPTED", doneQty: item.qty, plannedQty: 1000 },
      });
      await flushQueue(store, fake, USER);
      const row = store.rows.get(big.id);
      const pass = store.rows.size === 1 && row?.state === "REJECTED" && row.rejectCode === "OVER_PLANNED";
      return { actual: `${store.rows.size} left: ${row?.rejectMessage ?? "none"}`, pass };
    },
  },
  {
    title: "Seventy counts after a week offline",
    setup: "A phone was offline for days and has 70 counts waiting.",
    expected: "Sent in two batches of at most 50",
    async run() {
      const store = memoryStore();
      for (let i = 0; i < 70; i += 1) await store.putUpdate(update({ milestoneId: `m${i}` }));
      const batches: number[] = [];
      const fake = server({
        sync: async (items) => {
          batches.push(items.length);
          return items.map((item) => ({ id: item.id, status: "ACCEPTED", doneQty: item.qty, plannedQty: 1000 }) as SyncResult);
        },
      });
      await flushQueue(store, fake, USER);
      const pass = batches.length === 2 && Math.max(...batches) <= 50 && store.rows.size === 0;
      return { actual: `Batches of ${batches.join(" and ")}, ${store.rows.size} left`, pass };
    },
  },
];

/** Runs the phone's real queue code against a pretend server, in this browser. */
export async function runPhoneScenarios(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of CASES) {
    let actual: string;
    let pass: boolean;
    try {
      ({ actual, pass } = await scenario.run());
    } catch (error) {
      actual = `Crashed: ${error instanceof Error ? error.message : String(error)}`;
      pass = false;
    }
    results.push({ group: GROUP, title: scenario.title, setup: scenario.setup, expected: scenario.expected, actual, pass });
  }
  return results;
}
