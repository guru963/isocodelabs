import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { enqueue, flushQueue, type SyncItem, type SyncResult, type Transport } from "./queue";
import { createOfflineStore, type OfflineStore, type QueuedUpdate } from "./store";

export const offlineStore: OfflineStore = createOfflineStore();

const transport: Transport = {
  async upload(file) {
    const form = new FormData();
    form.append("file", file);
    const { url } = await api<{ url: string }>("/supervisor/uploads", { method: "POST", form });
    return url;
  },
  async sync(items: SyncItem[]) {
    const { results } = await api<{ results: SyncResult[] }>("/supervisor/updates/sync", {
      method: "POST",
      body: { updates: items },
    });
    return results;
  },
};

const RETRY_MS = 30_000;

export function useQueue(userId: string, onSynced: () => void) {
  const [updates, setUpdates] = useState<QueuedUpdate[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [sending, setSending] = useState(false);
  const running = useRef(false);
  const rerun = useRef(false);
  const synced = useRef(onSynced);
  synced.current = onSynced;

  const refresh = useCallback(async () => {
    setUpdates(await offlineStore.allUpdates(userId));
  }, [userId]);

  const flush = useCallback(async (): Promise<void> => {
    // Something added mid-send would otherwise wait for the next retry, so send again after.
    if (running.current) {
      rerun.current = true;
      return;
    }
    running.current = true;
    setSending(true);
    try {
      const before = await offlineStore.allUpdates(userId);
      const outcome = await flushQueue(offlineStore, transport, userId);
      setOnline(!outcome.offline && navigator.onLine);
      await refresh();
      if (!outcome.offline && !outcome.signedOut && before.length > 0) synced.current();
    } finally {
      running.current = false;
      setSending(false);
    }
    if (rerun.current) {
      rerun.current = false;
      await flush();
    }
  }, [refresh, userId]);

  useEffect(() => {
    void refresh().then(flush);
    const onOnline = () => {
      setOnline(true);
      void flush();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = window.setInterval(() => void flush(), RETRY_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(timer);
    };
  }, [flush, refresh]);

  const add = useCallback(
    async (update: QueuedUpdate) => {
      await enqueue(offlineStore, update);
      await refresh();
      void flush();
    },
    [flush, refresh],
  );

  const discard = useCallback(
    async (id: string) => {
      await offlineStore.deleteUpdate(id);
      await refresh();
    },
    [refresh],
  );

  return { updates, online, sending, add, discard, flush };
}
