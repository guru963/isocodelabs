import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { flushQueue, type SyncItem, type SyncResult, type Transport } from "./queue";
import { createOfflineStore, type QueuedUpdate } from "./store";

const USER = "user-1";

function update(overrides: Partial<QueuedUpdate>): QueuedUpdate {
  return {
    id: "a",
    userId: USER,
    milestoneId: "m1",
    workDate: "2026-11-06",
    qty: 100,
    capturedAt: "2026-11-06T12:00:00.000Z",
    state: "PENDING",
    ...overrides,
  };
}

describe("a file the server cannot store", () => {
  it("holds back only its own update; every other count still sends", async () => {
    const store = createOfflineStore(new IDBFactory());
    const voice = new Blob(["voice"], { type: "audio/webm" });
    await store.putUpdate(update({ id: "with-voice", milestoneId: "m1", voice }));
    await store.putUpdate(update({ id: "plain", milestoneId: "m2" }));

    const synced: SyncItem[][] = [];
    const transport: Transport = {
      async upload() {
        throw new ApiError(500, "INTERNAL", "Something went wrong");
      },
      async sync(items): Promise<SyncResult[]> {
        synced.push(items);
        return items.map((item) => ({ id: item.id, status: "ACCEPTED", doneQty: item.qty, plannedQty: 1000 }));
      },
    };

    const outcome = await flushQueue(store, transport, USER);

    expect(outcome).toEqual({ offline: false, signedOut: false });
    expect(synced.flat().map((item) => item.id)).toEqual(["plain"]);
    const left = await store.allUpdates(USER);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: "with-voice", state: "PENDING" });
    expect(left[0]?.voice).toBeDefined();
  });
});
