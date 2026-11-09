import { Link } from "react-router-dom";
import { Runway } from "../components/Runway";
import { LoadError, SkeletonRows } from "../components/States";
import { api } from "../lib/api";
import { fullDate, shortDate } from "../lib/format";
import type { Board } from "../lib/types";
import { useLoad } from "../lib/useLoad";

export default function RunwayPage() {
  const board = useLoad(() => api<Board>("/orders/board"), "runway", { liveMs: 20_000 });
  const data = board.data;
  // Date order here, not urgency: a timeline reads best as a run of ship dates.
  const orders = data ? [...data.orders].sort((a, b) => a.exFactoryDate.localeCompare(b.exFactoryDate)) : [];
  const next = orders[0];

  return (
    <main className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: "var(--s1)" }}>
          <h1>Ex-factory runway</h1>
          {data && (
            <p className="muted small">
              {next ? `Next to ship: ${next.poNumber}, ${shortDate(next.exFactoryDate)}. ` : ""}
              Figures as of {fullDate(data.today)}
            </p>
          )}
        </div>
      </div>

      {board.error && !data ? (
        <LoadError error={board.error} onRetry={() => void board.reload()} />
      ) : !data ? (
        <SkeletonRows rows={1} height={260} />
      ) : orders.length === 0 ? (
        <div className="notice stack" style={{ alignItems: "flex-start" }}>
          <p>No open orders. Each order appears here against its ship date once it is set up.</p>
          <Link to="/orders/new" className="btn btn-small">
            New order
          </Link>
        </div>
      ) : (
        <Runway orders={orders} today={data.today} />
      )}
    </main>
  );
}
