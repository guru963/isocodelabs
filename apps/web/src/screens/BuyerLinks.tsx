import { useState } from "react";
import { Select } from "../components/Picker";
import { LoadError, SkeletonRows } from "../components/States";
import { api, errorMessage } from "../lib/api";
import { fullDate } from "../lib/format";
import type { Reference } from "../lib/types";
import { useLoad } from "../lib/useLoad";
import { notify } from "../lib/toast";

interface LinkRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

const LIFETIMES = [30, 90, 180];
const day = (iso: string) => fullDate(iso.slice(0, 10));

function linkState(link: LinkRow): "Active" | "Expired" | "Revoked" {
  if (link.revokedAt) return "Revoked";
  return new Date(link.expiresAt) <= new Date() ? "Expired" : "Active";
}

function BuyerSection({ buyer }: { buyer: Reference["buyers"][number] }) {
  const links = useLoad(() => api<{ links: LinkRow[] }>(`/buyers/${buyer.id}/links`), buyer.id);
  const [lifetime, setLifetime] = useState(90);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const { token } = await api<{ token: string }>(`/buyers/${buyer.id}/links`, {
        method: "POST",
        body: { expiresInDays: lifetime },
      });
      // After the # so the secret is never sent to any server or written in its logs.
      setCreated(`${window.location.origin}/buyer#${token}`);
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
      await navigator.clipboard.writeText(created);
      setCopied(true);
      notify.success("Link copied", "Paste it into your message to the buyer.");
    } catch {
      setError("Could not copy automatically. Select the link and copy it by hand.");
    }
  }

  return (
    <section className="panel" aria-labelledby={`buyer-${buyer.id}`}>
      <div className="panel-body stack">
        <div className="link-head">
          <h2 id={`buyer-${buyer.id}`}>
            {buyer.name} <span className="muted small">{buyer.country}</span>
          </h2>
          <div className="row">
            <label className="visually-hidden" htmlFor={`lifetime-${buyer.id}`}>
              Link lifetime
            </label>
            <Select
              id={`lifetime-${buyer.id}`}
              className="link-lifetime"
              value={String(lifetime)}
              options={LIFETIMES.map((value) => ({ value: String(value), label: `Valid ${value} days` }))}
              onChange={(value) => setLifetime(Number(value))}
            />
            <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
              Create link
            </button>
          </div>
        </div>

        {created && (
          <div className="notice notice-ok stack" role="status">
            <p>Copy this link now. It will not be shown again.</p>
            <div className="link-copy">
              <input
                className="input"
                readOnly
                aria-label={`New link for ${buyer.name}`}
                value={created}
                onFocus={(event) => event.target.select()}
              />
              <button type="button" className="btn" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {links.error && !links.data ? (
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <LoadError error={links.error} onRetry={() => void links.reload()} />
        </div>
      ) : !links.data ? (
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <SkeletonRows rows={1} height={36} />
        </div>
      ) : links.data.links.length === 0 ? (
        <p className="panel-body muted" style={{ paddingTop: 0 }}>
          No links yet. Create one to share this buyer's order progress.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Expires</th>
                <th>State</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {links.data.links.map((link) => {
                const state = linkState(link);
                return (
                  <tr key={link.id}>
                    <td className="nowrap">{day(link.createdAt)}</td>
                    <td className="nowrap">{day(link.expiresAt)}</td>
                    <td className={state === "Active" ? "" : "muted"}>{state}</td>
                    <td className="stage-actions">
                      {state === "Active" &&
                        (confirming === link.id ? (
                          <>
                            <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => void revoke(link.id)}>
                              Yes, revoke
                            </button>{" "}
                            <button type="button" className="btn btn-small" onClick={() => setConfirming(null)}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn btn-small" onClick={() => setConfirming(link.id)}>
                            Revoke
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function BuyerLinks() {
  const reference = useLoad(() => api<Reference>("/reference"), "reference");

  return (
    <main className="page page-medium">
      <div className="page-head">
        <div>
          <h1>Buyer links</h1>
          <p className="small muted">
            Each link opens a read-only view of one buyer's orders and never shows another buyer's.
          </p>
        </div>
      </div>
      {reference.error && !reference.data ? (
        <LoadError error={reference.error} onRetry={() => void reference.reload()} />
      ) : !reference.data ? (
        <SkeletonRows rows={2} height={120} />
      ) : (
        <div className="stack">
          {reference.data.buyers.map((buyer) => (
            <BuyerSection key={buyer.id} buyer={buyer} />
          ))}
        </div>
      )}
    </main>
  );
}
