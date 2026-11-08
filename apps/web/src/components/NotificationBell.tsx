import { Bell, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { timeAgo, useNotifications, type AppNotification } from "../lib/notifications";

/** A bell with a count, and a panel that opens beneath it rather than a page of its own. */
export function NotificationBell() {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(item: AppNotification) {
    if (!item.read) void markRead(item.id);
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  return (
    <div className="bell" ref={wrapper}>
      <button
        ref={button}
        type="button"
        className="bell-button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen(!open)}
      >
        <Bell size={20} aria-hidden="true" />
        {unread > 0 && <span className="bell-count">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <h2>Notifications</h2>
            {unread > 0 && (
              <button type="button" className="linklike small" onClick={() => void markAllRead()}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="bell-empty">
              Nothing yet. Reminders about missing counts, notes waiting for review and delayed orders appear here.
            </p>
          ) : (
            <ul className="bell-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" className={item.read ? "bell-item" : "bell-item is-unread"} onClick={() => choose(item)}>
                    <span className="bell-title">{item.title}</span>
                    <span className="bell-body">{item.body}</span>
                    <span className="bell-meta">
                      {timeAgo(item.createdAt)}
                      {item.channels.includes("WHATSAPP") && (
                        <span className="bell-channel">
                          <MessageCircle size={13} aria-hidden="true" /> WhatsApp (mock)
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
