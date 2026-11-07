import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../lib/api";
import type { Worklist } from "../lib/types";
import { enqueue, flushQueue, viewStages, workDateFor, type SyncItem, type SyncResult, type Transport } from "./queue";
import { createOfflineStore, type OfflineStore, type QueuedUpdate } from "./store";

const USER = "user-1";

function update(overrides: Partial<QueuedUpdate> = {}): QueuedUpdate {
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

type FakeTransport = Transport & { synced: SyncItem[][]; uploads: number };

function transport(overrides: Partial<Transport> = {}): FakeTransport {
  const fake: FakeTransport = {
    synced: [] as SyncItem[][],
    uploads: 0,
    async upload(): Promise<string> {
      fake.uploads += 1;
      return `/files/${fake.uploads}.jpg`;
    },
    async sync(items: SyncItem[]): Promise<SyncResult[]> {
      fake.synced.push(items);
      return items.map((item) => ({ id: item.id, status: "ACCEPTED", doneQty: item.qty, plannedQty: 1000 }));
    },
    ...overrides,
  };
  return fake;
}

describe("offline queue", () => {
  let store: OfflineStore;

  beforeEach(() => {
    store = createOfflineStore(new IDBFactory());
  });

  it("clears updates the server accepted, or already had", async () => {
    await store.putUpdate(update({ id: "a" }));
    await store.putUpdate(update({ id: "b", milestoneId: "m2" }));
    await store.putUpdate(update({ id: "c", milestoneId: "m3" }));
    const fake = transport({
      sync: async () => [
        { id: "a", status: "ACCEPTED", doneQty: 1, plannedQty: 2 },
        { id: "b", status: "DUPLICATE" },
        { id: "c", status: "STALE" },
      ],
    });

    await flushQueue(store, fake, USER);

    expect(await store.allUpdates(USER)).toEqual([]);
  });

  it("keeps everything when the network fails, then sends the same ids on retry", async () => {
    await store.putUpdate(update());
    const offline = await flushQueue(
      store,
      transport({
        sync: async () => {
          throw new NetworkError("down");
        },
      }),
      USER,
    );
    expect(offline).toEqual({ offline: true, signedOut: false });
    expect(await store.allUpdates(USER)).toHaveLength(1);

    const fake = transport();
    await flushQueue(store, fake, USER);
    expect(fake.synced[0]?.[0]?.id).toBe("a");
    expect(await store.allUpdates(USER)).toEqual([]);
  });

  it("keeps a rejected update with its reason, and does not send it again", async () => {
    await store.putUpdate(update({ id: "bad" }));
    await store.putUpdate(update({ id: "good", milestoneId: "m2" }));
    const first = transport({
      sync: async () => [
        { id: "bad", status: "REJECTED", code: "OVER_QUANTITY", message: "Too many" },
        { id: "good", status: "ACCEPTED", doneQty: 1, plannedQty: 2 },
      ],
    });

    await flushQueue(store, first, USER);

    const left = await store.allUpdates(USER);
    expect(left.map((item) => [item.id, item.state, item.rejectCode])).toEqual([["bad", "REJECTED", "OVER_QUANTITY"]]);

    const second = transport();
    await flushQueue(store, second, USER);
    expect(second.synced).toEqual([]);
  });

  it("uploads a file once, even if the sync after it fails", async () => {
    await store.putUpdate(update({ photo: new Blob(["x"]) }));
    const failing = transport({
      sync: async () => {
        throw new NetworkError("down");
      },
    });
    await flushQueue(store, failing, USER);
    expect(failing.uploads).toBe(1);

    const fake = transport();
    await flushQueue(store, fake, USER);
    expect(fake.uploads).toBe(0);
    expect(fake.synced[0]?.[0]?.photoUrl).toBe("/files/1.jpg");
  });

  it("holds an update whose file the server refuses, and still sends the others", async () => {
    await store.putUpdate(update({ id: "big", photo: new Blob(["x"]) }));
    await store.putUpdate(update({ id: "fine", milestoneId: "m2" }));
    const fake = transport({
      upload: async () => {
        throw new ApiError(413, "LIMIT_FILE_SIZE", "File too large");
      },
    });

    await flushQueue(store, fake, USER);

    const left = await store.allUpdates(USER);
    expect(left.map((item) => [item.id, item.state])).toEqual([["big", "REJECTED"]]);
  });

  it("keeps the queue when the session has ended", async () => {
    await store.putUpdate(update());
    const outcome = await flushQueue(
      store,
      transport({
        sync: async () => {
          throw new ApiError(401, "UNAUTHENTICATED", "Please sign in again");
        },
      }),
      USER,
    );
    expect(outcome).toEqual({ offline: false, signedOut: true });
    expect(await store.allUpdates(USER)).toHaveLength(1);
  });

  it("only sends the signed-in supervisor's updates", async () => {
    await store.putUpdate(update({ id: "theirs", userId: "user-2" }));
    const fake = transport();
    await flushQueue(store, fake, USER);
    expect(fake.synced).toEqual([]);
    expect(await store.allUpdates("user-2")).toHaveLength(1);
  });

  it("sends in batches the API accepts", async () => {
    for (let index = 0; index < 51; index += 1) {
      await store.putUpdate(update({ id: `u${index}`, milestoneId: `m${index}` }));
    }
    const fake = transport();
    await flushQueue(store, fake, USER);
    expect(fake.synced.map((batch) => batch.length)).toEqual([50, 1]);
  });

  it("replaces an unsent count for the same stage and day, keeping its photo", async () => {
    const photo = new Blob(["x"]);
    await enqueue(store, update({ id: "old", qty: 100, photo }));
    await enqueue(store, update({ id: "new", qty: 150 }));

    const left = await store.allUpdates(USER);
    expect(left.map((item) => [item.id, item.qty])).toEqual([["new", 150]]);
    expect(left[0]?.photo).toBeDefined();
  });
});

describe("workDateFor", () => {
  const saved = (today: string, fetchedOn: string) => ({
    worklist: { today, stages: [] },
    fetchedOn,
  });

  it("uses the server's date on the day it was fetched", () => {
    expect(workDateFor(saved("2026-11-06", "2026-11-07"), "2026-11-07")).toBe("2026-11-06");
  });

  it("moves forward with the days passed while offline", () => {
    expect(workDateFor(saved("2026-11-06", "2026-11-06"), "2026-11-08")).toBe("2026-11-08");
  });

  it("never goes backward if the phone's clock does", () => {
    expect(workDateFor(saved("2026-11-06", "2026-11-06"), "2026-11-02")).toBe("2026-11-06");
  });
});

describe("viewStages", () => {
  const worklist: Worklist = {
    today: "2026-11-06",
    stages: [
      {
        milestoneId: "m1",
        stage: "STITCHING",
        poNumber: "PO",
        style: "Tee",
        colour: "Navy",
        plannedQty: 1000,
        doneQty: 600,
        plannedDate: "2026-11-14",
        todayQty: 100,
      },
    ],
  };

  it("shows today's server figure when nothing is queued", () => {
    const [stage] = viewStages(worklist, [], "2026-11-06");
    expect(stage).toMatchObject({ shownTodayQty: 100, shownDoneQty: 600, maxToday: 500 });
  });

  it("swaps in an unsent count without counting today twice", () => {
    const [stage] = viewStages(worklist, [update({ qty: 250 })], "2026-11-06");
    expect(stage).toMatchObject({ shownTodayQty: 250, shownDoneQty: 750, maxToday: 500 });
  });

  it("does not count a rejected update as done", () => {
    const [stage] = viewStages(worklist, [update({ qty: 900, state: "REJECTED" })], "2026-11-06");
    expect(stage).toMatchObject({ shownTodayQty: 100, shownDoneQty: 600 });
  });

  it("starts a fresh day when the phone has moved past the saved list", () => {
    const [stage] = viewStages(worklist, [], "2026-11-07");
    expect(stage).toMatchObject({ shownTodayQty: null, shownDoneQty: 600, maxToday: 400 });
  });
});
