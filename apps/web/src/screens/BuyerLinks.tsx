import { Check, Copy, ExternalLink, EyeOff, Link2, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { LoadError, SkeletonRows } from "../components/States";
import { api, errorMessage } from "../lib/api";
import { days, fullDate } from "../lib/format";
import { notify } from "../lib/toast";
import type { Board, BoardOrder, Reference } from "../lib/types";
import { useLoad } from "../lib/useLoad";

interface LinkRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

type LinkState = "ACTIVE" | "EXPIRED" | "REVOKED";

const LIFETIMES = [30, 90, 180];
const DAY_MS = 86_400_000;
const day = (iso: string) => fullDate(iso.slice(0, 10));

function linkState(link: LinkRow): LinkState {
  if (link.revokedAt) return "REVOKED";
  return new Date(link.expiresAt) <= new Date() ? "EXPIRED" : "ACTIVE";
}

const STATE_LABEL: Record<LinkState, string> = { ACTIVE: "Active", EXPIRED: "Expired", REVOKED: "Revoked" };

/** Two letters for the buyer's mark: the initials of its first two words. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

function LinkLine({
  link,
  busy,
  confirming,
  onAsk,
  onCancel,
  onRevoke,
}: {
  link: LinkRow;
  busy: boolean;
  confirming: boolean;
  onAsk(): void;
  onCancel(): void;
  onRevoke(): void;
}) {
  const state = linkState(link);
  const start = new Date(link.createdAt).getTime();
  const end = new Date(link.expiresAt).getTime();
  const now = Date.now();
  // How much of the link's life is left, drawn as thread: solid for time left, stitches for time used.
  const left = state === "ACTIVE" ? Math.max(0, Math.min(1, (end - now) / (end - start))) : 0;
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY_MS));

  return (
    <li className="link-line" data-state={state}>
      <span className={`link-state link-state-${state}`}>{STATE_LABEL[state]}</span>
      <div className="link-dates">
        <span className="cell-main">
          {state === "REVOKED"
            ? `Revoked ${day(link.revokedAt!)}`
            : state === "EXPIRED"
              ? `Expired ${day(link.expiresAt)}`
              : `${days(daysLeft)} left`}
        </span>
        <span className="cell-sub">
          Created {day(link.createdAt)}
          {state === "ACTIVE" && <>, expires {day(link.expiresAt)}</>}
        </span>
      </div>
      <div className="link-life" aria-hidden="true">
        <span className="link-life-fill" style={{ width: `${left * 100}%` }} />
      </div>
      <div className="link-actions">
        {state === "ACTIVE" &&
          (confirming ? (
            <span className="confirm-inline">
              <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={onRevoke}>
                Yes, revoke
              </button>
              <button type="button" className="btn btn-small btn-ghost" onClick={onCancel}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-small btn-ghost link-revoke" onClick={onAsk}>
              Revoke
            </button>
          ))}
      </div>
    </li>
  );
}

function BuyerSection({ buyer, orders }: { buyer: Reference["buyers"][number]; orders: BoardOrder[] | null }) {
  const links = useLoad(() => api<{ links: LinkRow[] }>(`/buyers/${buyer.id}/links`), buyer.id);
  const [lifetime, setLifetime] = useState(90);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPast, setShowPast] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const { id, token } = await api<{ id: string; token: string }>(`/buyers/${buyer.id}/links`, {
        method: "POST",
        body: { expiresInDays: lifetime },
      });
      // After the # so the secret is never sent to any server or written in its logs.
      setCreated({ id, url: `${window.location.origin}/buyer#${token}` });
      await links.reload();
      notify.success(`Link created for ${buyer.name}`, `Valid for ${lifetime} days. Copy it now; it is shown only once.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/buyer-links/${id}/revoke`, { method: "POST" });
      setConfirming(null);
      // A revoked link no longer opens, so stop offering it for copying.
      if (created?.id === id) setCreated(null);
      await links.reload();
      notify.success("Link revoked", `${buyer.name} can no longer open it.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      notify.success("Link copied", "Paste it into your message to the buyer.");
    } catch {
      setError("Could not copy automatically. Select the link and copy it by hand.");
    }
  }

  const all = links.data?.links ?? [];
  const active = all.filter((link) => linkState(link) === "ACTIVE");
  const past = all.filter((link) => linkState(link) !== "ACTIVE");
  const headingId = `buyer-${buyer.id}`;

  return (
    <section className="panel buyer-card" aria-labelledby={headingId}>
      <div className="buyer-card-head">
        <span className="buyer-mark" aria-hidden="true">
          {initials(buyer.name)}
        </span>
        <div className="buyer-card-title">
          <h2 id={headingId}>{buyer.name}</h2>
          <p className="small muted">
            {buyer.country}
            {links.data && (
              <>
                {" · "}
                {active.length === 0 ? "No active link" : active.length === 1 ? "1 active link" : `${active.length} active links`}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="buyer-sees">
        <p className="buyer-sees-label">Open orders on this link</p>
        {orders === null ? (
          <SkeletonRows rows={1} height={28} />
        ) : orders.length === 0 ? (
          <p className="small muted">No open orders right now.</p>
        ) : (
          <ul className="buyer-sees-list">
            {orders.map((order) => (
              <li key={order.id}>
                <Link to={`/orders/${order.id}`} className="buyer-sees-po">
                  {order.poNumber}
                </Link>
                <span className="small muted">
                  {order.style}, ships {fullDate(order.exFactoryDate)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="link-create">
        <div className="segmented" role="radiogroup" aria-label={`Link lifetime for ${buyer.name}`}>
          {LIFETIMES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={lifetime === value}
              className="segmented-option"
              onClick={() => setLifetime(value)}
            >
              {value} days
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
          <Link2 size={17} aria-hidden="true" />
          Create link
        </button>
      </div>

      {created && (
        <div className="link-ticket" role="status">
          <div className="link-ticket-head">
            <p className="link-ticket-title">New link for {buyer.name}</p>
            <p className="small">
              <EyeOff size={14} aria-hidden="true" /> Shown only once. Copy it before you leave this page.
            </p>
          </div>
          <div className="link-ticket-row">
            <input
              className="input link-url"
              readOnly
              aria-label={`New link for ${buyer.name}`}
              value={created.url}
              onFocus={(event) => event.target.select()}
            />
            <button type="button" className="btn btn-primary" onClick={() => void copy()}>
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <a className="btn btn-ghost" href={created.url} target="_blank" rel="noreferrer">
              <ExternalLink size={16} aria-hidden="true" />
              Preview
            </a>
          </div>
        </div>
      )}

      {error && (
        <p className="form-error link-error" role="alert">
          {error}
        </p>
      )}

      {links.error && !links.data ? (
        <div className="link-body">
          <LoadError error={links.error} onRetry={() => void links.reload()} />
        </div>
      ) : !links.data ? (
        <div className="link-body">
          <SkeletonRows rows={1} height={44} />
        </div>
      ) : all.length === 0 ? (
        <p className="link-body small muted">No links yet. Create one to share this buyer's order progress.</p>
      ) : (
        <div className="link-body">
          {active.length > 0 && (
            <ul className="link-lines">
              {active.map((link) => (
                <LinkLine
                  key={link.id}
                  link={link}
                  busy={busy}
                  confirming={confirming === link.id}
                  onAsk={() => setConfirming(link.id)}
                  onCancel={() => setConfirming(null)}
                  onRevoke={() => void revoke(link.id)}
                />
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <>
              <button
                type="button"
                className="linklike small link-past-toggle"
                aria-expanded={showPast}
                onClick={() => setShowPast(!showPast)}
              >
                {showPast ? "Hide" : "Show"} {past.length} expired or revoked {past.length === 1 ? "link" : "links"}
              </button>
              {showPast && (
                <ul className="link-lines link-lines-past">
                  {past.map((link) => (
                    <LinkLine
                      key={link.id}
                      link={link}
                      busy={busy}
                      confirming={false}
                      onAsk={() => undefined}
                      onCancel={() => undefined}
                      onRevoke={() => undefined}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default function BuyerLinks() {
  const reference = useLoad(() => api<Reference>("/reference"), "reference");
  // Open orders, so each buyer card can say exactly what its link will show.
  const board = useLoad(() => api<Board>("/orders/board"), "links-board");
  const ordersFor = (name: string) => (board.data ? board.data.orders.filter((order) => order.buyer === name) : null);

  return (
    <main className="page page-medium">
      <div className="links-head">
        <h1>Buyer links</h1>
        <p className="muted">A private, read-only page for each buyer, to share instead of sending progress by hand.</p>
        <ul className="links-promises">
          <li>
            <LockKeyhole size={16} aria-hidden="true" />
            One buyer's orders only
          </li>
          <li>
            <EyeOff size={16} aria-hidden="true" />
            No internal figures
          </li>
          <li>
            <ShieldCheck size={16} aria-hidden="true" />
            Delays only after you confirm
          </li>
        </ul>
      </div>
      {reference.error && !reference.data ? (
        <LoadError error={reference.error} onRetry={() => void reference.reload()} />
      ) : !reference.data ? (
        <SkeletonRows rows={2} height={220} />
      ) : (
        <div className="stack">
          {reference.data.buyers.map((buyer) => (
            <BuyerSection key={buyer.id} buyer={buyer} orders={board.error ? [] : ordersFor(buyer.name)} />
          ))}
        </div>
      )}
    </main>
  );
}
