import { FileSpreadsheet } from "lucide-react";
import { useEffect, useState } from "react";
import { Brand } from "../components/Brand";
import { Seam } from "../components/Seam";
import { SkeletonRows } from "../components/States";
import { StatusTag } from "../components/Status";
import { api, ApiError, errorMessage } from "../lib/api";
import { dateTime, fullDate, pieces, shortDate, STAGE_LABEL } from "../lib/format";
import type { BuyerOrder, BuyerOrderDetail, BuyerProgress, RiskStatus } from "../lib/types";
import { useLoad } from "../lib/useLoad";

const PROGRESS: Record<BuyerProgress, { status: RiskStatus; label: string }> = {
  // Neutral on purpose: an unconfirmed problem may exist, so this must not read as "all clear".
  IN_PROGRESS: { status: "NOT_STARTED", label: "In progress" },
  SLIGHT_DELAY: { status: "AMBER", label: "Slight delay" },
  DELAYED: { status: "RED", label: "Delayed" },
  SHIPPED: { status: "DONE", label: "Shipped" },
};

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

function countdown(order: BuyerOrder, today: string): string {
  if (order.progress === "SHIPPED") return "Shipped";
  const left = daysBetween(today, order.exFactoryDate);
  if (left > 1) return `in ${left} days`;
  if (left === 1) return "tomorrow";
  if (left === 0) return "today";
  return "date has passed";
}

function History({ orderId, token }: { orderId: string; token: string }) {
  const detail = useLoad(
    () => api<BuyerOrderDetail>(`/buyer/orders/${orderId}`, { headers: { "x-buyer-token": token } }),
    orderId,
  );
  if (detail.error) return <p className="form-error">{errorMessage(detail.error)}</p>;
  if (!detail.data) return <SkeletonRows rows={1} height={32} />;
  if (detail.data.dateHistory.length === 0) return <p className="muted small">No planned dates have changed.</p>;
  return (
    <ol className="history">
      {detail.data.dateHistory.map((entry) => (
        <li key={`${entry.at}-${entry.stage}`} className="small">
          <div>
            <strong>{STAGE_LABEL[entry.stage]}</strong>: {entry.from && shortDate(entry.from)} to{" "}
            {entry.to && shortDate(entry.to)}
          </div>
          <div>{entry.reason}</div>
          <div className="muted">{dateTime(entry.at)}</div>
        </li>
      ))}
    </ol>
  );
}

function OrderCard({ order, token, today }: { order: BuyerOrder; token: string; today: string }) {
  const [showHistory, setShowHistory] = useState(false);
  const progress = PROGRESS[order.progress];
  const open = order.milestones.filter((milestone) => !milestone.completedOn);
  // The stage in hand is the first one with work done on it, else the first one still to come.
  const now = open.find((milestone) => (milestone.percentDone ?? 0) > 0) ?? open[0];
  const next = now ? open[open.indexOf(now) + 1] : undefined;
  const late = order.progress === "DELAYED" || order.progress === "SLIGHT_DELAY";

  return (
    <article className="panel buyer-order">
      <header className="buyer-order-head">
        <div className="stack" style={{ gap: "var(--s1)" }}>
          <div className="row">
            <h2 className="woven">{order.poNumber}</h2>
            <StatusTag status={progress.status} label={progress.label} />
          </div>
          <p className="muted">
            {order.style}, {order.colour}. {pieces(order.totalQty)} pieces
          </p>
        </div>
        <div className={late ? "buyer-ship buyer-ship-late" : "buyer-ship"}>
          <span className="small">Ex-factory</span>
          <strong>{fullDate(order.exFactoryDate)}</strong>
          <span className="buyer-countdown">{countdown(order, today)}</span>
        </div>
      </header>

      {order.reason && (
        <p className={order.progress === "DELAYED" ? "notice notice-error" : "notice notice-warn"}>
          Reason: {order.reason}
        </p>
      )}

      {now && (
        <dl className="buyer-now">
          <div>
            <dt>Now</dt>
            <dd>
              <strong>{STAGE_LABEL[now.stage]}</strong>
              {now.percentDone !== null && <span className="buyer-percent">{now.percentDone}%</span>}
            </dd>
          </div>
          {next && (
            <div>
              <dt>Next</dt>
              <dd>
                <strong>{STAGE_LABEL[next.stage]}</strong>
                <span className="muted"> planned {shortDate(next.plannedDate)}</span>
              </dd>
            </div>
          )}
        </dl>
      )}

      <Seam
        today={order.progress === "SHIPPED" ? undefined : today}
        stages={order.milestones.map((milestone) => ({
          key: milestone.stage,
          label: STAGE_LABEL[milestone.stage],
          date: milestone.plannedDate,
          caption: milestone.completedOn
            ? `Finished ${shortDate(milestone.completedOn)}`
            : `Planned ${shortDate(milestone.plannedDate)}`,
          percent: milestone.percentDone,
          done: milestone.completedOn !== null,
        }))}
      />

      {order.photos.length > 0 && (
        <div className="buyer-photos">
          {order.photos.map((photo) => (
            <a key={photo.url} href={photo.url} target="_blank" rel="noreferrer">
              <img
                src={photo.url}
                alt={`${STAGE_LABEL[photo.stage]}, ${shortDate(photo.date)}`}
                loading="lazy"
                width={96}
                height={96}
              />
            </a>
          ))}
        </div>
      )}

      <div className="buyer-order-foot">
        <button
          type="button"
          className="linklike small"
          aria-expanded={showHistory}
          onClick={() => setShowHistory(!showHistory)}
        >
          {showHistory ? "Hide date changes" : "Show date changes"}
        </button>
      </div>
      {showHistory && <History orderId={order.id} token={token} />}
    </article>
  );
}

/**
 * Downloads this week's Excel report. The link's token goes in a header, as for every buyer
 * request, so the file is fetched here and handed to the browser rather than opened as a URL.
 */
function ReportButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  async function download() {
    setState("busy");
    try {
      const res = await fetch("/api/buyer/report.xlsx", { headers: { "x-buyer-token": token } });
      if (!res.ok) throw new Error(String(res.status));
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "Nool-weekly-report.xlsx";
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="buyer-report">
      <button type="button" className="btn buyer-report-btn" disabled={state === "busy"} onClick={() => void download()}>
        <FileSpreadsheet size={18} aria-hidden="true" />
        {state === "busy" ? "Preparing the report…" : "Download this week's report"}
      </button>
      <span className="buyer-report-note" role={state === "failed" ? "alert" : undefined}>
        {state === "failed" ? "The report could not be prepared. Please try again." : "Excel, with every order, stage and date change"}
      </span>
    </div>
  );
}

function summary(orders: readonly BuyerOrder[]): string {
  const open = orders.filter((order) => order.progress !== "SHIPPED").length;
  const delayed = orders.filter((order) => order.progress === "DELAYED" || order.progress === "SLIGHT_DELAY").length;
  const parts = [`${open} ${open === 1 ? "order" : "orders"} in production`];
  if (delayed > 0) parts.push(`${delayed} with a delay`);
  return parts.join(", ");
}

export default function BuyerView() {
  // The token stays after the #, so it never reaches a server log or a Referer header.
  const token = window.location.hash.slice(1);
  const orders = useLoad(
    () =>
      api<{ today: string; buyer: { name: string } | null; orders: BuyerOrder[] }>("/buyer/orders", {
        headers: { "x-buyer-token": token },
      }),
    token,
  );

  // A different link in this tab starts clean, so one buyer's orders are never left on screen for another.
  useEffect(() => {
    const onChange = () => window.location.reload();
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const invalid = !token || (orders.error instanceof ApiError && orders.error.status === 401);
  const data = orders.data;

  return (
    <div className="buyer">
      <header className="buyer-band">
        <picture>
          <source media="(min-width: 861px)" srcSet="/img/signin-hands-1672.webp" />
          <img className="buyer-band-photo" src="/img/signin-hands-900.webp" alt="" width={900} height={507} />
        </picture>
        <div className="buyer-band-inner">
          <span className="brand">
            <Brand />
          </span>
          <div className="stack" style={{ gap: "var(--s1)" }}>
            <h1>{data?.buyer?.name ?? "Order progress"}</h1>
            {data && !invalid && (
              <p>
                {summary(data.orders)}. Updated {fullDate(data.today)}.
              </p>
            )}
            {data && !invalid && data.orders.length > 0 && <ReportButton token={token} />}
          </div>
        </div>
      </header>

      <main className="buyer-main stack">
        {invalid ? (
          <p className="notice notice-error" role="alert">
            This link is not valid. Please ask your merchandiser for a new one.
          </p>
        ) : orders.error && !data ? (
          <div className="notice notice-error row" role="alert">
            <span style={{ flex: 1 }}>Could not load your orders. Please try again.</span>
            <button type="button" className="btn btn-small" onClick={() => void orders.reload()}>
              Try again
            </button>
          </div>
        ) : !data ? (
          <SkeletonRows rows={2} height={260} />
        ) : data.orders.length === 0 ? (
          <p className="notice">There are no orders to show yet.</p>
        ) : (
          data.orders.map((order) => <OrderCard key={order.id} order={order} token={token} today={data.today} />)
        )}
        {!invalid && <p className="buyer-footnote small">Read-only. Figures come from the factory floor's daily reports.</p>}
      </main>
    </div>
  );
}
