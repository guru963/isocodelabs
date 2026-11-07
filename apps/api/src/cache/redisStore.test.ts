import { createServer, type AddressInfo, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createReadCache } from "./cache.js";
import { createRedisStore, type RedisStore } from "./redisStore.js";

/** Just enough of the Redis protocol to test the real client without a Redis server. */
function startFakeRedis(): Promise<{ server: Server; url: string; commands: string[] }> {
  const values = new Map<string, string>();
  const commands: string[] = [];
  const server = createServer((socket) => {
    let buffer = "";
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const parsed = parseCommand(buffer);
        if (!parsed) return;
        buffer = buffer.slice(parsed.length);
        const [name = "", key = "", value = ""] = parsed.args;
        commands.push(name.toUpperCase());
        if (name.toUpperCase() === "GET") {
          const found = values.get(key);
          socket.write(found === undefined ? "$-1\r\n" : `$${Buffer.byteLength(found)}\r\n${found}\r\n`);
        } else if (name.toUpperCase() === "SET") {
          values.set(key, value);
          socket.write("+OK\r\n");
        } else if (name.toUpperCase() === "INCR") {
          const next = Number(values.get(key) ?? 0) + 1;
          values.set(key, String(next));
          socket.write(`:${next}\r\n`);
        } else if (name.toUpperCase() === "INFO") {
          socket.write("$0\r\n\r\n");
        } else {
          socket.write("+OK\r\n");
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `redis://127.0.0.1:${port}`, commands });
    });
  });
}

function parseCommand(text: string): { args: string[]; length: number } | null {
  const bytes = Buffer.from(text);
  let at = 0;
  const line = () => {
    const end = bytes.indexOf("\r\n", at);
    if (end === -1) return null;
    const value = bytes.toString("utf8", at, end);
    at = end + 2;
    return value;
  };
  const head = line();
  if (!head) return null;
  const count = Number(head.slice(1));
  const args: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const size = line();
    if (!size) return null;
    const length = Number(size.slice(1));
    if (bytes.length < at + length + 2) return null;
    args.push(bytes.toString("utf8", at, at + length));
    at += length + 2;
  }
  return { args, length: bytes.toString("utf8", 0, at).length };
}

const waitUntilReady = (store: RedisStore) =>
  expect
    .poll(
      () =>
        store.get("ping").then(
          () => true,
          () => false,
        ),
      { timeout: 3000 },
    )
    .toBe(true);

describe("redis store", () => {
  let store: RedisStore | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    await store?.close();
    server?.close();
    store = undefined;
    server = undefined;
  });

  it("saves and reads answers through the real client, including Tamil text", async () => {
    const fake = await startFakeRedis();
    server = fake.server;
    store = createRedisStore(fake.url, () => undefined);
    await waitUntilReady(store);
    const cache = createReadCache(store);

    await cache.read("note", async () => ({ text: "நேற்று 2 மெஷின் பழுதானது" }));
    const again = await cache.read("note", async () => ({ text: "should not load" }));

    expect(again).toEqual({ text: "நேற்று 2 மெஷின் பழுதானது" });
    await cache.invalidate();
    expect(fake.commands).toContain("INCR");
    expect(await cache.read("note", async () => ({ text: "fresh" }))).toEqual({ text: "fresh" });
  });

  it("falls through to the database quickly when nothing is listening", async () => {
    const messages: string[] = [];
    store = createRedisStore("redis://127.0.0.1:1", (message) => messages.push(message));
    const cache = createReadCache(store, () => undefined);

    const started = performance.now();
    const answer = await cache.read("board", async () => "from the database");

    expect(answer).toBe("from the database");
    expect(performance.now() - started).toBeLessThan(200);
    await cache.invalidate();
    await expect.poll(() => messages.length).toBeGreaterThanOrEqual(1);
    expect(messages).toHaveLength(1);
  });
});
