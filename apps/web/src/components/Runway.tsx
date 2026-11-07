import { Link } from "react-router-dom";
import { days, shortDate } from "../lib/format";
import type { BoardOrder } from "../lib/types";
import { useSewIn } from "../lib/useSewIn";

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Mondays in range, so the scale reads the way factories plan: in weeks. */
function weekTicks(start: number, end: number): number[] {
  const ticks: number[] = [];
  const first = new Date(start);
  const toMonday = (8 - first.getUTCDay()) % 7 || 7;
  for (let time = start + toMonday * DAY_MS; time < end; time += 7 * DAY_MS) ticks.push(time);
  return ticks;
}

/**
 * Every open order against its ship date, on one true time scale. Thread runs from today to the
 * agreed date. When the pace says an order will miss it, stitches carry on to where it will land.
 */
export function Runway({ orders, today }: { orders: readonly BoardOrder[]; today: string }) {
  const sewIn = useSewIn<HTMLElement>();
  const start = utc(today);
  const lastDate = Math.max(
    ...orders.flatMap((order) => [
      utc(order.exFactoryDate),
      order.projectedExFactory ? utc(order.projectedExFactory) : 0,
    ]),
  );
  const end = Math.max(lastDate, start + 7 * DAY_MS) + 3 * DAY_MS;
  const at = (time: number) => `${Math.max(((time - start) / (end - start)) * 100, 0)}%`;

  return (
    <section ref={sewIn} className="runway on-dark" aria-label="Open orders against their ship dates">
      <div className="runway-head">
        <p className="small runway-legend">
          <span className="runway-key-item">
            <span className="runway-key runway-key-thread" /> Time left to the agreed date
          </span>
          <span className="runway-key-item">
            <span className="runway-key runway-key-stitch" /> Where the pace will land it
          </span>
        </p>
      </div>

      <div className="runway-grid">
        <div className="runway-scale" aria-hidden="true">
          <span className="runway-tick runway-tick-today" style={{ left: "0%" }}>
            Today
          </span>
          {weekTicks(start, end).map((time) => (
            <span key={time} className="runway-tick" style={{ left: at(time) }}>
              {shortDate(new Date(time).toISOString().slice(0, 10))}
            </span>
          ))}
        </div>

        <ol className="runway-rows">
          {orders.map((order, index) => {
            const agreed = utc(order.exFactoryDate);
            const projected = order.projectedExFactory ? utc(order.projectedExFactory) : null;
            const late = projected !== null && projected > agreed;
            return (
              <li key={order.id}>
                <Link
                  to={`/orders/${order.id}`}
                  className={`runway-row runway-${order.status}`}
                  style={{ "--i": index } as React.CSSProperties}
                >
                  <span className="runway-label">
                    <strong>{order.poNumber}</strong>
                    <span className="small">{order.buyer}</span>
                  </span>
                  <span className="runway-track">
                    <span className="runway-thread" style={{ width: at(agreed) }} />
                    {late && (
                      <span
                        className="runway-stitches"
                        style={{ left: at(agreed), width: `calc(${at(projected)} - ${at(agreed)})` }}
                      />
                    )}
                    <span className="runway-pin" style={{ left: at(agreed) }} />
                    <span className="runway-date small" style={{ left: at(late ? projected : agreed) }}>
                      {late ? `+${days(order.exFactorySlipDays ?? 0)}` : shortDate(order.exFactoryDate)}
                    </span>
                  </span>
                  <span className="visually-hidden">
                    Agreed {shortDate(order.exFactoryDate)}
                    {late && order.projectedExFactory ? `, heading for ${shortDate(order.projectedExFactory)}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
