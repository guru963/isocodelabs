import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export interface AppNotification {
  id: string;
  kind: "MISSED_COUNT" | "MISSED_YESTERDAY" | "MISSED_COUNT_ESCALATION" | "NOTE_WAITING" | "ORDER_RED";
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  read: boolean;
  /** Mock channels it was also "sent" on, such as WHATSAPP. */
  channels: string[];
}

const POLL_MS = 60_000;

/**
 * The signed-in person's notifications. Checks every minute and whenever the tab comes back into
 * view, which is plenty for reminders sent a few times a day. A failed check keeps what is shown.
 */
export function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ unread: number; notifications: AppNotification[] }>("/notifications");
      setItems(data.notifications);
      setUnread(data.unread);
    } catch {
      // Offline or signed out: the next check tries again.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const markRead = useCallback(async (id: string) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    setUnread((count) => Math.max(count - 1, 0));
    await api(`/notifications/${id}/read`, { method: "POST" }).catch(() => undefined);
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    setUnread(0);
    await api("/notifications/read-all", { method: "POST" }).catch(() => undefined);
  }, []);

  return { items, unread, refresh, markRead, markAllRead };
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}
