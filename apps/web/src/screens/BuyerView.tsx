import { useEffect, useState } from "react";
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

function OrderCard({ order, token }: { order: BuyerOrder; token: string }) {
  const [showHistory, setShowHistory] = useState(false);
  const progress = PROGRESS[order.progress];

  return (
    <article className="panel panel-body stack">
      <div className="buyer-head">
        <div>
          <div className="row">
            <h2>{order.poNumber}</h2>
            <StatusTag status={progress.status} label={progress.label} />
          </div>
          <p className="muted">
            {order.style}, {order.colour}. {pieces(order.totalQty)} pieces
          </p>
        </div>
        <div className="buyer-date">
          <span className="small muted">Ex-factory</span>
          <strong>{fullDate(order.exFactoryDate)}</strong>
        </div>
      </div>

      {order.reason && (
        <p className={order.progress === "DELAYED" ? "notice notice-error" : "notice notice-warn"}>
          Reason: {order.reason}
        </p>
      )}

      <ul className="buyer-stages">
        {order.milestones.map((milestone) => (
          <li key={milestone.stage}>
            <span className="buyer-stage-name">{STAGE_LABEL[milestone.stage]}</span>
            <span className="buyer-stage-bar" aria-hidden={milestone.percentDone === null}>
              {milestone.percentDone !== null && (
                <span className="floor-progress">
                  <span style={{ width: `${milestone.percentDone}%` }} />
                </span>
              )}
            </span>
            <span className="small buyer-stage-figure">
              {milestone.percentDone !== null ? `${milestone.percentDone}%` : milestone.completedOn ? "Done" : ""}
            </span>
            <span className="small muted buyer-stage-date">
              {milestone.completedOn
                ? `Finished ${shortDate(milestone.completedOn)}`
                : `Planned ${shortDate(milestone.plannedDate)}`}
            </span>
          </li>
        ))}
      </ul>

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

      <div>
        <button
          type="button"
          className="btn btn-small"
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

export default function BuyerView() {
  // The token stays after the #, so it never reaches a server log or a Referer header.
  const token = window.location.hash.slice(1);
  const orders = useLoad(
    () => api<{ buyer: { name: string } | null; orders: BuyerOrder[] }>("/buyer/orders", { headers: { "x-buyer-token": token } }),
    token,
  );

  // A different link in this tab starts clean, so one buyer's orders are never left on screen for another.
  useEffect(() => {
    const onChange = () => window.location.reload();
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const invalid = !token || (orders.error instanceof ApiError && orders.error.status === 401);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">{orders.data?.buyer?.name ?? "Order progress"}</span>
          <span className="user">Read-only view</span>
        </div>
      </header>
      <main className="page page-medium stack">
        {invalid ? (
          <p className="notice notice-error" role="alert">
            This link is not valid. Please ask your merchandiser for a new one.
          </p>
        ) : orders.error && !orders.data ? (
          <div className="notice notice-error row" role="alert">
            <span style={{ flex: 1 }}>Could not load your orders. Please try again.</span>
            <button type="button" className="btn btn-small" onClick={() => void orders.reload()}>
              Try again
            </button>
          </div>
        ) : !orders.data ? (
          <SkeletonRows rows={2} height={200} />
        ) : orders.data.orders.length === 0 ? (
          <p className="notice">There are no orders to show yet.</p>
        ) : (
          <>
            <h1>Your orders</h1>
            {orders.data.orders.map((order) => (
              <OrderCard key={order.id} order={order} token={token} />
            ))}
          </>
        )}
      </main>
    </>
  );
}
