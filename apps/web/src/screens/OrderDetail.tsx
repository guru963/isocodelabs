import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { PaceGap } from "../components/PaceGap";
import { Seam } from "../components/Seam";
import { LoadError, SkeletonRows } from "../components/States";
import { StatusTag } from "../components/Status";
import { api, ApiError, errorMessage } from "../lib/api";
import {
  CATEGORY_LABEL,
  dateTime,
  days,
  fullDate,
  pieces,
  shortDate,
  STAGE_LABEL,
} from "../lib/format";
import type { OrderDetail as Order, RiskFlag, Stage, StageRisk } from "../lib/types";
import { useLoad } from "../lib/useLoad";

const FLAG_TEXT: Record<RiskFlag, string> = {
  LOW_CONFIDENCE: "Pace is from fewer than 3 reported days",
  NO_OUTPUT: "Nothing made across the last reported days",
  MILESTONE_PASSED: "Milestone date has passed",
  STALE_DATA: "No report for 3 or more working days",
};

/** Says in words what the status colour means for this order. */
function summary(order: Order): string {
  const { risk } = order;
  if (order.shipped) return "This order has shipped.";
  if (risk.exFactoryOverdue) return `The ex-factory date, ${fullDate(order.exFactoryDate)}, has passed and the order has not shipped.`;
  if (risk.projectedExFactory && risk.exFactorySlipDays !== null && risk.exFactorySlipDays > 0) {
    return `At the current pace this order reaches ex-factory on ${fullDate(risk.projectedExFactory)}, ${days(risk.exFactorySlipDays)} after the agreed ${fullDate(order.exFactoryDate)}.`;
  }
  if (risk.status === "NO_DATA") {
    return order.updates.length === 0
      ? "No daily reports yet, so the pace cannot be worked out."
      : "Supervisors have stopped reporting, so the pace cannot be worked out.";
  }
  if (risk.status === "NOT_STARTED") return "Production has not started yet.";
  return `At the current pace this order meets its ex-factory date of ${fullDate(order.exFactoryDate)}.`;
}

function DateForm({
  label,
  initial,
  submit,
  onDone,
}: {
  label: string;
  initial: string;
  submit(body: { date: string; reason: string }): Promise<unknown>;
  onDone(saved: boolean): void;
}) {
  const [date, setDate] = useState(initial);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submit({ date, reason: reason.trim() });
      onDone(true);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <form className="date-form" onSubmit={(event) => void save(event)}>
      <div className="field">
        <label htmlFor={`${label}-date`}>{label}</label>
        <input
          id={`${label}-date`}
          type="date"
          className="input"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>
      <div className="field date-form-reason">
        <label htmlFor={`${label}-reason`}>Reason, kept in the date history</label>
        <input
          id={`${label}-reason`}
          className="input"
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div className="row">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
          {busy ? "Saving…" : "Save date"}
        </button>
        <button type="button" className="btn btn-small" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="form-error date-form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function StageFacts({ risk }: { risk: StageRisk }) {
  return (
    <>
      <PaceGap actualPerDay={risk.actualPerDay} neededPerDay={risk.neededPerDay} status={risk.status} />
      {risk.flags.map((flag) => (
        <div key={flag} className="small muted">
          {FLAG_TEXT[flag]}
        </div>
      ))}
    </>
  );
}

function Stages({ order, reload }: { order: Order; reload(): Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const [confirmingEvent, setConfirmingEvent] = useState<string | null>(null);

  async function complete(id: string) {
    setBusyEvent(id);
    setConfirmingEvent(null);
    setEventError(null);
    try {
      await api(`/milestones/${id}/complete`, { method: "POST" });
      await reload();
    } catch (error) {
      if (error instanceof ApiError && error.code === "STAGES_UNFINISHED") {
        const { stages } = error.details as { stages: Stage[] };
        setEventError(`${stages.map((stage) => STAGE_LABEL[stage]).join(" and ")} still have pieces left.`);
      } else {
        setEventError(errorMessage(error));
      }
    } finally {
      setBusyEvent(null);
    }
  }

  return (
    <section className="panel" aria-labelledby="stages-heading">
      <div className="panel-body">
        <h2 id="stages-heading">TNA stages</h2>
        <Seam
          today={order.shipped ? undefined : order.today}
          stages={order.milestones.map((milestone) => ({
            key: milestone.id,
            label: STAGE_LABEL[milestone.stage],
            date: milestone.plannedDate,
            caption: milestone.completedAt
              ? `Finished ${shortDate(milestone.completedAt)}`
              : shortDate(milestone.plannedDate),
            percent:
              milestone.plannedQty === null || milestone.plannedQty === 0
                ? null
                : Math.floor((milestone.doneQty / milestone.plannedQty) * 100),
            done: milestone.completedAt !== null,
            status: milestone.risk?.status,
          }))}
        />
      </div>
      {eventError && (
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <p className="notice notice-error" role="alert">
            {eventError}
          </p>
        </div>
      )}
      <div className="table-wrap">
        <table className="stages">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Planned</th>
              <th className="num">Done</th>
              <th>Pace</th>
              <th>Heading for</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {order.milestones.map((milestone) => {
              const isEvent = milestone.plannedQty === null;
              const isExFactory = milestone.stage === "EX_FACTORY";
              const status = milestone.completedAt ? "DONE" : milestone.risk?.status;
              return [
                <tr key={milestone.id}>
                  <td data-label="Stage">
                    <div className="stage-name">
                      {STAGE_LABEL[milestone.stage]}
                      {status && status !== "NOT_STARTED" && <StatusTag status={status} />}
                    </div>
                  </td>
                  <td data-label="Planned" className="nowrap">
                    {shortDate(milestone.plannedDate)}
                  </td>
                  <td data-label="Done" className="num nowrap">
                    {milestone.plannedQty === null ? (
                      milestone.completedAt ? (
                        shortDate(milestone.completedAt)
                      ) : (
                        <span className="muted">Not yet</span>
                      )
                    ) : (
                      <>
                        {pieces(milestone.doneQty)}
                        <span className="muted"> / {pieces(milestone.plannedQty)}</span>
                      </>
                    )}
                  </td>
                  <td data-label="Pace" className="pace-cell">
                    {milestone.risk && !milestone.completedAt && milestone.risk.status !== "NOT_STARTED" ? (
                      <StageFacts risk={milestone.risk} />
                    ) : null}
                  </td>
                  <td data-label="Heading for" className="nowrap">
                    {milestone.risk?.projectedDate && !milestone.completedAt ? (
                      <>
                        {shortDate(milestone.risk.projectedDate)}
                        {milestone.risk.slipDays !== null && milestone.risk.slipDays > 0 && (
                          <div className={`small slip slip-${milestone.risk.status}`}>{days(milestone.risk.slipDays)} late</div>
                        )}
                      </>
                    ) : null}
                  </td>
                  <td className="stage-actions">
                    {isEvent &&
                      !milestone.completedAt &&
                      (confirmingEvent === milestone.id ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-small btn-primary"
                            disabled={busyEvent === milestone.id}
                            onClick={() => void complete(milestone.id)}
                          >
                            {isExFactory ? "Yes, mark shipped" : "Yes, mark passed"}
                          </button>
                          <button type="button" className="btn btn-small" onClick={() => setConfirmingEvent(null)}>
                            Keep open
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busyEvent === milestone.id}
                          onClick={() => setConfirmingEvent(milestone.id)}
                        >
                          {isExFactory ? "Mark shipped" : "Mark passed"}
                        </button>
                      ))}
                    {!isExFactory && !milestone.completedAt && (
                      <button type="button" className="btn btn-small" onClick={() => setEditing(milestone.id)}>
                        Change date
                      </button>
                    )}
                  </td>
                </tr>,
                editing === milestone.id && (
                  <tr key={`${milestone.id}-edit`} className="edit-row">
                    <td colSpan={6}>
                      <DateForm
                        label={`New ${STAGE_LABEL[milestone.stage].toLowerCase()} date`}
                        initial={milestone.plannedDate}
                        submit={(body) => api(`/milestones/${milestone.id}/date`, { method: "PATCH", body })}
                        onDone={(saved) => {
                          setEditing(null);
                          if (saved) void reload();
                        }}
                      />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Notes({ order }: { order: Order }) {
  return (
    <section className="panel" aria-labelledby="notes-heading">
      <div className="panel-body stack">
        <div>
          <h2 id="notes-heading">Supervisor notes</h2>
          <p className="small muted">A warning reaches the buyer only after you confirm a note.</p>
        </div>
        {order.issues.length === 0 ? (
          <p className="muted">No notes on this order.</p>
        ) : (
          order.issues.map((issue) => {
            const category = issue.finalCategory ?? issue.aiCategory;
            return (
              <article key={issue.id} className="note-line">
                <div className="row small muted">
                  <span>
                    {STAGE_LABEL[issue.stage]}, {shortDate(issue.workDate)}
                  </span>
                  {category && <span>{CATEGORY_LABEL[category]}</span>}
                  <span className={issue.status === "PENDING" ? "note-pending" : ""}>
                    {issue.status === "PENDING"
                      ? "Waiting for review"
                      : issue.status === "CONFIRMED"
                        ? "Confirmed"
                        : "Dismissed"}
                  </span>
                </div>
                {issue.originalText ? <p lang="ta">{issue.originalText}</p> : <p className="muted">Voice note</p>}
                {issue.translatedText && <p className="muted">{issue.translatedText}</p>}
                {issue.status === "PENDING" && (
                  <Link to="/notes" className="small">
                    Review this note
                  </Link>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function Reports({ order }: { order: Order }) {
  return (
    <section className="panel" aria-labelledby="reports-heading">
      <div className="panel-body">
        <h2 id="reports-heading">Daily reports</h2>
      </div>
      {order.updates.length === 0 ? (
        <p className="panel-body muted" style={{ paddingTop: 0 }}>
          Nothing reported yet. Reports appear here when supervisors send their daily count.
        </p>
      ) : (
        <div className="table-wrap report-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Stage</th>
                <th className="num">Pieces</th>
                <th>By</th>
                <th>Attached</th>
              </tr>
            </thead>
            <tbody>
              {order.updates.map((update) => (
                <tr key={update.id}>
                  <td className="nowrap">{shortDate(update.workDate)}</td>
                  <td>{STAGE_LABEL[update.stage]}</td>
                  <td className="num">{pieces(update.qty)}</td>
                  <td>{update.supervisor}</td>
                  <td className="row">
                    {update.photoUrl && (
                      <a href={update.photoUrl} target="_blank" rel="noreferrer">
                        Photo
                      </a>
                    )}
                    {update.voiceUrl && (
                      <a href={update.voiceUrl} target="_blank" rel="noreferrer">
                        Voice note
                      </a>
                    )}
                    {update.note && <span className="muted">Note</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DateHistory({ order }: { order: Order }) {
  return (
    <section className="panel" aria-labelledby="history-heading">
      <div className="panel-body stack">
        <h2 id="history-heading">Date history</h2>
        {order.dateHistory.length === 0 ? (
          <p className="muted">No dates have changed since this order was set up.</p>
        ) : (
          <ol className="history">
            {order.dateHistory.map((entry) => (
              <li key={`${entry.at}-${entry.field}-${entry.stage}`}>
                <div>
                  <strong>{entry.stage === "ORDER" ? "Ex-factory" : STAGE_LABEL[entry.stage]}</strong>:{" "}
                  {entry.from && shortDate(entry.from)} to {entry.to && shortDate(entry.to)}
                </div>
                <div className="small">{entry.reason}</div>
                <div className="small muted">
                  {entry.by}, {dateTime(entry.at)}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export default function OrderDetail() {
  const { id = "" } = useParams();
  const { data: order, error, reload } = useLoad(() => api<Order>(`/orders/${id}`), id);
  const [changingDate, setChangingDate] = useState(false);

  if (error && !order) {
    return (
      <main className="page">
        {error instanceof ApiError && (error.status === 404 || error.status === 400) ? (
          <div className="notice stack" style={{ alignItems: "flex-start" }}>
            <p>This order does not exist.</p>
            <Link to="/board" className="btn btn-small">
              Back to the board
            </Link>
          </div>
        ) : (
          <LoadError error={error} onRetry={() => void reload()} />
        )}
      </main>
    );
  }

  if (!order) {
    return (
      <main className="page">
        <SkeletonRows rows={5} height={64} />
      </main>
    );
  }

  return (
    <main className="page stack">
      <p className="small">
        <Link to="/board">Order board</Link>
      </p>
      <header className="order-head">
        <div className="stack" style={{ gap: "var(--s2)" }}>
          <div className="row">
            <h1>{order.poNumber}</h1>
            <StatusTag status={order.risk.status} />
          </div>
          <p>
            {order.style}, {order.colour}. {pieces(order.totalQty)} pieces for {order.buyer.name}, {order.unit}.
          </p>
          <p className={order.risk.status === "RED" ? "summary summary-late" : "summary"}>{summary(order)}</p>
        </div>
        <dl className="order-facts">
          <div>
            <dt>Ex-factory</dt>
            <dd>
              {fullDate(order.exFactoryDate)}
              {!order.shipped && (
                <>
                  {" "}
                  <button type="button" className="linklike small action-link" onClick={() => setChangingDate(true)}>
                    Change
                  </button>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Sizes</dt>
            <dd>{order.sizes.map((size) => `${size.size} ${pieces(size.qty)}`).join(", ")}</dd>
          </div>
          <div>
            <dt>Merchandiser</dt>
            <dd>{order.merchandiser}</dd>
          </div>
        </dl>
      </header>

      {changingDate && (
        <div className="panel panel-body">
          <DateForm
            label="New ex-factory date"
            initial={order.exFactoryDate}
            submit={(body) => api(`/orders/${order.id}/ex-factory`, { method: "PATCH", body })}
            onDone={(saved) => {
              setChangingDate(false);
              if (saved) void reload();
            }}
          />
        </div>
      )}

      <Stages order={order} reload={reload} />
      <div className="detail-columns">
        <Notes order={order} />
        <DateHistory order={order} />
      </div>
      <Reports order={order} />
    </main>
  );
}
