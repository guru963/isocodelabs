import { Plus } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PaceGap } from "../components/PaceGap";
import { Runway } from "../components/Runway";
import { LoadError, SkeletonRows } from "../components/States";
import { StatusTag } from "../components/Status";
import { api } from "../lib/api";
import { CATEGORY_LABEL, days, fullDate, pieces, shortDate, STAGE_LABEL, STATUS_LABEL } from "../lib/format";
import type { Board as BoardData, BoardOrder, Reference, RiskStatus } from "../lib/types";
import { useLoad } from "../lib/useLoad";

const STATUS_ORDER: RiskStatus[] = ["RED", "AMBER", "NO_DATA", "GREEN", "NOT_STARTED", "DONE"];

/** The page's title is the state of the factory, because that is what the page is for. */
function headline(counts: BoardData["counts"]): string {
  const orderWord = (count: number) => (count === 1 ? "order" : "orders");
  const parts = [
    counts.RED > 0 && `${counts.RED} delayed`,
    counts.AMBER > 0 && `${counts.AMBER} at risk`,
    counts.NO_DATA > 0 && `${counts.NO_DATA} not reporting`,
  ].filter(Boolean);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return "No open orders";
  if (parts.length === 0) return `All ${total} open ${orderWord(total)} on track`;
  const first = counts.RED || counts.AMBER || counts.NO_DATA;
  return `${first} ${orderWord(first)} ${parts.join(", ").replace(/^\d+ /, "")}`.replace(/, (\d+ [^,]+)$/, " and $1");
}

function ExFactory({ order }: { order: BoardOrder }) {
  const slip = order.exFactorySlipDays;
  return (
    <>
      <div className="nowrap">{shortDate(order.exFactoryDate)}</div>
      {order.exFactoryOverdue ? (
        <div className={`small slip slip-${order.status}`}>Date passed</div>
      ) : slip !== null && slip > 0 && order.projectedExFactory ? (
        <div className={`small slip nowrap slip-${order.status}`}>
          Heading for {shortDate(order.projectedExFactory)}, {days(slip)} late
        </div>
      ) : null}
    </>
  );
}

function OrderRow({ order }: { order: BoardOrder }) {
  const navigate = useNavigate();
  const stage = order.focusStage;
  return (
    <tr className="board-row" onClick={() => navigate(`/orders/${order.id}`)}>
      <td data-label="Status">
        <StatusTag status={order.status} />
      </td>
      <td data-label="Order">
        <Link to={`/orders/${order.id}`} className="po" onClick={(event) => event.stopPropagation()}>
          {order.poNumber}
        </Link>
        <div className="small muted">
          {order.style}, {order.colour}
        </div>
      </td>
      <td data-label="Buyer / unit">
        <div className="nowrap">{order.buyer}</div>
        <div className="small muted">{order.unit}</div>
      </td>
      <td data-label="Qty" className="num">
        {pieces(order.totalQty)}
      </td>
      <td data-label="Stage" className="pace-cell">
        {stage ? (
          <>
            <div className="pace-stage">{STAGE_LABEL[stage.stage]}</div>
            <PaceGap actualPerDay={stage.actualPerDay} neededPerDay={stage.neededPerDay} status={stage.status} />
          </>
        ) : (
          <span className="muted">None open</span>
        )}
      </td>
      <td data-label="Ex-factory">
        <ExFactory order={order} />
      </td>
      <td data-label="Reason">
        {order.issue?.category ? (
          <>
            <div>{CATEGORY_LABEL[order.issue.category]}</div>
            {order.issue.status === "PENDING" && <div className="small muted">Not reviewed yet</div>}
          </>
        ) : (
          <span className="muted">None</span>
        )}
      </td>
    </tr>
  );
}

export default function Board() {
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const board = useLoad(() => api<BoardData>(`/orders/board${query ? `?${query}` : ""}`), query);
  const reference = useLoad(() => api<Reference>("/reference"), "reference");

  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  }

  const activeStatus = params.get("status") ?? "";
  const data = board.data;
  const hasFilters = query.length > 0;

  return (
    <main className="page">
      <div className="page-head board-head">
        <div className="stack" style={{ gap: "var(--s1)" }}>
          <h1>{data ? headline(data.counts) : "Order board"}</h1>
          {data && <p className="muted small">Figures as of {fullDate(data.today)}, most urgent first</p>}
        </div>
        <Link to="/orders/new" className="btn btn-primary">
          <Plus size={18} aria-hidden="true" />
          New order
        </Link>
      </div>

      {data && data.orders.length > 0 && <Runway orders={data.orders} today={data.today} />}

      <div className="filters">
        <div className="status-filter" role="group" aria-label="Filter by status">
          <button type="button" className="swatch swatch-ALL" aria-pressed={!activeStatus} onClick={() => setFilter("status", "")}>
            <span className="swatch-count">{data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : "–"}</span>
            <span className="swatch-label">All</span>
          </button>
          {STATUS_ORDER.filter((status) => status !== "DONE").map((status) => (
            <button
              key={status}
              type="button"
              className={`swatch swatch-${status}`}
              data-empty={data?.counts[status] === 0}
              aria-pressed={activeStatus === status}
              onClick={() => setFilter("status", activeStatus === status ? "" : status)}
            >
              <span className="swatch-count">{data ? data.counts[status] : "–"}</span>
              <span className="swatch-label">{STATUS_LABEL[status]}</span>
            </button>
          ))}
        </div>
        <div className="filter-fields">
          <div className="field">
            <label htmlFor="filter-buyer">Buyer</label>
            <select
              id="filter-buyer"
              className="input"
              value={params.get("buyerId") ?? ""}
              onChange={(event) => setFilter("buyerId", event.target.value)}
            >
              <option value="">All buyers</option>
              {reference.data?.buyers.map((buyer) => (
                <option key={buyer.id} value={buyer.id}>
                  {buyer.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-unit">Unit</label>
            <select
              id="filter-unit"
              className="input"
              value={params.get("unitId") ?? ""}
              onChange={(event) => setFilter("unitId", event.target.value)}
            >
              <option value="">All units</option>
              {reference.data?.units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-week">Ships in week of</label>
            <input
              id="filter-week"
              type="date"
              className="input"
              value={params.get("shipWeek") ?? ""}
              onChange={(event) => setFilter("shipWeek", event.target.value)}
            />
          </div>
        </div>
      </div>

      {board.error && !data ? (
        <LoadError error={board.error} onRetry={() => void board.reload()} />
      ) : !data ? (
        <SkeletonRows />
      ) : data.orders.length === 0 ? (
        <div className="notice stack" style={{ alignItems: "flex-start" }}>
          {hasFilters ? (
            <>
              <p>No orders match these filters.</p>
              <button type="button" className="btn btn-small" onClick={() => setParams({}, { replace: true })}>
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p>No open orders. Set up an order and its TNA dates to start tracking it.</p>
              <Link to="/orders/new" className="btn btn-small">
                New order
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="panel table-wrap" aria-busy={board.loading}>
          <table className="board">
            <thead>
              <tr>
                <th>Status</th>
                <th>Order</th>
                <th>Buyer / unit</th>
                <th className="num">Qty</th>
                <th>Stage and pace</th>
                <th>Ex-factory</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
