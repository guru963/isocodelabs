import { describe, expect, it, vi } from "vitest";
import { createReadCache } from "./cache.js";
import { createMemoryStore } from "./memoryStore.js";

describe("read cache", () => {
  it("loads once, then answers from the store", async () => {
    const cache = createReadCache(createMemoryStore());
    const load = vi.fn(async () => ({ orders: 3 }));

    expect(await cache.read("board", load)).toEqual({ orders: 3 });
    expect(await cache.read("board", load)).toEqual({ orders: 3 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps different keys apart, so one buyer's answer is never another's", async () => {
    const cache = createReadCache(createMemoryStore());

    await cache.read("buyer:b:orders", async () => "Company B");
    expect(await cache.read("buyer:c:orders", async () => "Company C")).toBe("Company C");
  });

  it("loads fresh data after a write", async () => {
    const cache = createReadCache(createMemoryStore());
    await cache.read("board", async () => "before");

    await cache.invalidate();

    expect(await cache.read("board", async () => "after")).toBe("after");
  });

  it("does not bring back old data when a read overlaps a write", async () => {
    const cache = createReadCache(createMemoryStore());
    let finishRead = (_value: string) => {};
    const slowRead = cache.read("board", () => new Promise<string>((resolve) => (finishRead = resolve)));
    await vi.waitFor(() => expect(finishRead).not.toBe(undefined));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await cache.invalidate();
    finishRead("from before the write");
    await slowRead;

    expect(await cache.read("board", async () => "from after the write")).toBe("from after the write");
  });

  it("shares one load between identical requests made together", async () => {
    const cache = createReadCache(createMemoryStore());
    const load = vi.fn(async () => "answer");

    const answers = await Promise.all([cache.read("board", load), cache.read("board", load)]);

    expect(answers).toEqual(["answer", "answer"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not save a failed load", async () => {
    const cache = createReadCache(createMemoryStore());

    await expect(
      cache.read("order", async () => {
        throw new Error("not found");
      }),
    ).rejects.toThrow("not found");

    expect(await cache.read("order", async () => "found")).toBe("found");
  });

  it("still answers when the store is down", async () => {
    const store = createMemoryStore();
    store.fail = true;
    const warn = vi.fn();
    const cache = createReadCache(store, warn);

    expect(await cache.read("board", async () => "from the database")).toBe("from the database");
    await expect(cache.invalidate()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("still answers when the store goes down after reading the version", async () => {
    const store = createMemoryStore();
    const cache = createReadCache(store);
    const realSet = store.setWithExpiry;
    store.setWithExpiry = async () => {
      throw new Error("store is down");
    };

    expect(await cache.read("board", async () => "from the database")).toBe("from the database");
    store.setWithExpiry = realSet;
  });

  it("does nothing without a store", async () => {
    const cache = createReadCache(null);
    const load = vi.fn(async () => "answer");

    await cache.read("board", load);
    await cache.read("board", load);
    await cache.invalidate();

    expect(load).toHaveBeenCalledTimes(2);
  });
});
