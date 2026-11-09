import {
  CalendarClock,
  CalendarPlus,
  Check,
  CircleCheck,
  Copy,
  Gauge,
  Image,
  LifeBuoy,
  Mail,
  MessageSquareText,
  Mic,
  Sparkles,
  Truck,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { DatePicker } from "../components/Picker";
import { Pager } from "../components/Pager";
import { PaceGap } from "../components/PaceGap";
import { Seam } from "../components/Seam";
import { StageIcon } from "../components/StageIcon";
import { LoadError, SkeletonRows } from "../components/States";
import { StatusTag } from "../components/Status";
import { api, ApiError, errorMessage } from "../lib/api";
import { CATEGORY_LABEL, dateTime, days, fullDate, pieces, shortDate, STAGE_LABEL } from "../lib/format";
import type { BuyerMessageDraft, CatchUpPlan, OrderDetail as Order, RiskFlag, Stage, StageRisk } from "../lib/types";
import { useLoad } from "../lib/useLoad";
import { notify } from "../lib/toast";

const FLAG_TEXT: Record<RiskFlag, string> = {
  LOW_CONFIDENCE: "Pace is from fewer than 3 reported days",
  NO_OUTPUT: "Nothing made across the last reported days",
  MILESTONE_PASSED: "Milestone date has passed",
  STALE_DATA: "No report for 3 or more working days",
};

/** Whole days from one ISO date to another; negative when the second is earlier. */
function dayGap(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Says in words what the status colour means for this order. */
function summary(order: Order): string {
  const { risk } = order;
  if (order.shipped) return "This order has shipped.";
  if (risk.exFactoryOverdue)
    return `The ex-factory date, ${fullDate(order.exFactoryDate)}, has passed and the order has not shipped.`;
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
  savedTitle,
  today,
  startDate,
  startReason,
}: {
  label: string;
  savedTitle: string;
  /** A suggested date and reason, such as from a catch-up plan. The person can still change both. */
  startDate?: string;
  startReason?: string;
  /** The app's today, so the calendar agrees with the rest of the order page. */
  today: string;
  initial: string;
  submit(body: { date: string; reason: string }): Promise<unknown>;
  onDone(saved: boolean): void;
}) {
  const [date, setDate] = useState(startDate ?? initial);
  const [reason, setReason] = useState(startReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submit({ date, reason: reason.trim() });
      onDone(true);
      notify.success(savedTitle, `Moved from ${fullDate(initial)} to ${fullDate(date)}. Kept in the date history.`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <form className="date-form" onSubmit={(event) => void save(event)}>
      <div className="field">
        <label htmlFor={`${label}-date`}>{label}</label>
        <DatePicker
          id={`${label}-date`}
          required
          value={date}
          onChange={setDate}
          marked={initial}
          markedLabel="Current date"
          today={today}
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

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const dayName = (iso: string) => weekday.format(new Date(`${iso}T00:00:00Z`));
const listOf = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * Turns a delay warning into a decision: three ways to bring the stage back on plan, each
 * worked out by the API from the same figures as the warning. The date move can be applied
 * in one step; the other two are instructions for the floor.
 */
/**
 * When no single option recovers the stage: every lever together, and if even that is late, the
 * earliest realistic ex-factory date, with a draft message asking the buyer to agree it.
 */
function LastResort({
  plan,
  orderId,
  onExFactory,
}: {
  plan: CatchUpPlan;
  orderId: string;
  onExFactory(date: string, reason: string): void;
}) {
  const last = plan.lastResort!;
  const { combined } = last;
  const stage = STAGE_LABEL[plan.stage].toLowerCase();
  const [draft, setDraft] = useState<BuyerMessageDraft | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const [copied, setCopied] = useState(false);

  async function writeDraft() {
    setState("busy");
    setCopied(false);
    try {
      setDraft(await api<BuyerMessageDraft>(`/orders/${orderId}/buyer-message`, { method: "POST", body: { stage: plan.stage } }));
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setCopied(true);
      notify.success("Message copied", "Paste it into your email to the buyer.");
    } catch {
      setState("failed");
    }
  }

  const sundays = listOf(combined.dates.map(dayName));
  const days = combined.dates.length > 0 ? ` and work ${sundays}` : "";
  const working = combined.dates.length > 0 ? ` and working ${sundays}` : "";

  return (
    <div className="lastresort">
      <h4>No single option recovers it</h4>
      {combined.recovers ? (
        <p>
          Together they do: make <strong>{pieces(combined.perDay)} a day</strong> (+{combined.increasePercent}%){days}, and {stage} ends
          on time.
        </p>
      ) : (
        <>
          <p>
            Even together they fall short. At <strong>{pieces(combined.perDay)} a day</strong> (+{combined.increasePercent}%, the most a line
            can usually stretch){working}, {stage} ends on {fullDate(combined.finishes)},{" "}
            {combined.slipDays === 1 ? "1 day" : `${combined.slipDays} days`} late.
          </p>
          {last.newExFactory && last.exFactoryDate ? (
            <>
              <p className="lastresort-date">
                The earliest realistic ex-factory date is <strong>{fullDate(last.newExFactory)}</strong>, instead of the agreed{" "}
                {fullDate(last.exFactoryDate)}.
              </p>
              <div className="row">
                <button type="button" className="btn btn-small btn-primary" disabled={state === "busy"} onClick={() => void writeDraft()}>
                  <Sparkles size={15} aria-hidden="true" />
                  {state === "busy" ? "Writing the draft…" : draft ? "Write it again" : "Draft a message to the buyer"}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() =>
                    onExFactory(
                      last.newExFactory!,
                      `${STAGE_LABEL[plan.stage]} cannot recover even at ${pieces(combined.perDay)} a day; earliest realistic date agreed with the buyer`,
                    )
                  }
                >
                  <CalendarClock size={15} aria-hidden="true" />
                  Change ex-factory to {shortDate(last.newExFactory)}
                </button>
              </div>
              {state === "failed" && (
                <p className="form-error" role="alert">
                  The draft could not be written. Please try again.
                </p>
              )}
              {draft && (
                <div className="draft">
                  <p className="draft-source small">
                    <Mail size={14} aria-hidden="true" />
                    {draft.source === "ai"
                      ? "Drafted by AI from the figures above. Check it before you send it."
                      : "Written from a template with the figures above."}{" "}
                    Nothing has been sent.
                  </p>
                  <input
                    className="input"
                    aria-label="Subject"
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  />
                  <textarea
                    className="input draft-body"
                    aria-label="Message"
                    rows={10}
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  />
                  <div>
                    <button type="button" className="btn btn-small" onClick={() => void copy()}>
                      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                      {copied ? "Copied" : "Copy message"}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p>The ex-factory date can still be met, because the later stages have time to absorb it.</p>
          )}
        </>
      )}
    </div>
  );
}

function CatchUp({
  plan,
  orderId,
  onMove,
  onExFactory,
}: {
  plan: CatchUpPlan;
  orderId: string;
  onMove(date: string, reason: string): void;
  onExFactory(date: string, reason: string): void;
}) {
  const stage = STAGE_LABEL[plan.stage];
  const { raiseOutput, extraDays, moveDeadline } = plan;
  const next = moveDeadline ? STAGE_LABEL[moveDeadline.nextStage] : null;

  return (
    <div className="catchup">
      <p className="catchup-lead">
        <strong>{stage}</strong> is heading for {fullDate(plan.projectedDate)},{" "}
        {plan.slipDays === 1 ? "1 day" : `${plan.slipDays} days`} after its {shortDate(plan.milestoneDate)} milestone. Three ways
        to recover it:
      </p>
      <div className="catchup-options">
        <section className="catchup-option" data-ok={raiseOutput?.realistic ?? false}>
          <h4>
            <Gauge size={16} aria-hidden="true" />
            Make more each day
          </h4>
          {raiseOutput?.realistic ? (
            <p>
              Make <strong>{pieces(raiseOutput.perDay)} a day</strong> from tomorrow, instead of {pieces(raiseOutput.currentPerDay)} now
              <span className="catchup-figure"> +{raiseOutput.increasePercent}%</span>
            </p>
          ) : raiseOutput ? (
            <p>
              It would take {pieces(raiseOutput.perDay)} a day, +{raiseOutput.increasePercent}% on today's {pieces(raiseOutput.currentPerDay)}: far
              beyond the 25% a line can usually stretch.
            </p>
          ) : (
            <p>No working day is left before the milestone, so a higher daily output cannot meet it.</p>
          )}
        </section>

        <section className="catchup-option" data-ok={extraDays.enough && extraDays.dates.length > 0}>
          <h4>
            <CalendarPlus size={16} aria-hidden="true" />
            Work days normally off
          </h4>
          {extraDays.enough && extraDays.dates.length > 0 ? (
            <p>
              Work <strong>{listOf(extraDays.dates.map(dayName))}</strong> at today's pace, and {stage.toLowerCase()} ends on time.
            </p>
          ) : extraDays.dates.length === 0 ? (
            <p>No Sunday or holiday is left before the milestone to work.</p>
          ) : (
            <p>
              Even working {listOf(extraDays.dates.map(dayName))} leaves it{" "}
              {extraDays.shortByDays === 1 ? "1 day" : `${extraDays.shortByDays} days`} short. Combine it with more each day.
            </p>
          )}
        </section>

        <section className="catchup-option" data-ok={moveDeadline?.feasible ?? false}>
          <h4>
            <CalendarClock size={16} aria-hidden="true" />
            Move the deadline
          </h4>
          {!moveDeadline || !next ? (
            <p>This is the last stage, so its time cannot come from a later one.</p>
          ) : moveDeadline.feasible ? (
            <>
              <p>
                Let {stage.toLowerCase()} end on <strong>{shortDate(moveDeadline.to)}</strong>. {next} then has{" "}
                {moveDeadline.nextKeepsWorkingDays} of its {moveDeadline.nextHadWorkingDays} working days before{" "}
                {shortDate(moveDeadline.nextDate)}.
              </p>
              <button
                type="button"
                className="btn btn-small"
                onClick={() =>
                  onMove(
                    moveDeadline.to,
                    `Catch-up plan: ${stage.toLowerCase()} runs to ${shortDate(moveDeadline.to)}, ${next.toLowerCase()} keeps ${moveDeadline.nextKeepsWorkingDays} of its ${moveDeadline.nextHadWorkingDays} working days`,
                  )
                }
              >
                Move {stage.toLowerCase()} to {shortDate(moveDeadline.to)}
              </button>
            </>
          ) : (
            <p>
              Not on its own: {next.toLowerCase()}, planned for {shortDate(moveDeadline.nextDate)}, would have no working day left.
            </p>
          )}
        </section>
      </div>
      {plan.lastResort && <LastResort plan={plan} orderId={orderId} onExFactory={onExFactory} />}
    </div>
  );
}

function Stages({
  order,
  reload,
  onExFactory,
}: {
  order: Order;
  reload(): Promise<void>;
  onExFactory(date: string, reason: string): void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<{ date: string; reason: string } | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const [confirmingEvent, setConfirmingEvent] = useState<string | null>(null);

  async function complete(id: string, stage: Stage) {
    setBusyEvent(id);
    setConfirmingEvent(null);
    setEventError(null);
    try {
      await api(`/milestones/${id}/complete`, { method: "POST" });
      await reload();
      notify.success(
        stage === "EX_FACTORY" ? `${order.poNumber} marked shipped` : `${STAGE_LABEL[stage]} marked passed`,
        stage === "EX_FACTORY" ? "It leaves the order board now that it has shipped." : undefined,
      );
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

  const finished = order.milestones.filter((milestone) => milestone.completedAt).length;

  return (
    <section className="panel" aria-labelledby="stages-heading">
      <div className="panel-head">
        <h2 id="stages-heading">TNA stages</h2>
        <p className="small muted">
          {finished} of {order.milestones.length} finished
        </p>
      </div>
      {eventError && (
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <p className="notice notice-error" role="alert">
            {eventError}
          </p>
        </div>
      )}
      <div className="table-wrap">
        <table className="stages data-table">
          <colgroup>
            <col className="col-stage" />
            <col className="col-date" />
            <col className="col-progress" />
            <col className="col-pace" />
            <col className="col-date" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Planned</th>
              <th>Progress</th>
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
              const done = milestone.completedAt !== null;
              const status = done ? "DONE" : milestone.risk?.status;
              const active = !done && !!milestone.risk && milestone.risk.status !== "NOT_STARTED";
              const percent = milestone.plannedQty
                ? Math.min(100, Math.floor((milestone.doneQty / milestone.plannedQty) * 100))
                : 0;
              const daysAway = dayGap(order.today, milestone.plannedDate);
              return [
                <tr key={milestone.id} className="stage-row" data-state={done ? "done" : active ? "active" : "waiting"}>
                  <td data-label="Stage">
                    <div className="stage-cell">
                      <span className={`stage-chip stage-chip-${status ?? "NOT_STARTED"}`}>
                        {done ? (
                          <Check size={16} strokeWidth={2.6} aria-hidden="true" />
                        ) : (
                          <StageIcon stage={milestone.stage} size={16} />
                        )}
                      </span>
                      <div className="stage-cell-text">
                        <span className="stage-title">{STAGE_LABEL[milestone.stage]}</span>
                        <span className="stage-sub">
                          {milestone.completedAt ? (
                            `Finished ${shortDate(milestone.completedAt)}`
                          ) : status && status !== "NOT_STARTED" ? (
                            <StatusTag status={status} />
                          ) : (
                            "Not started"
                          )}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td data-label="Planned" className="nowrap">
                    <div className="cell-main">{shortDate(milestone.plannedDate)}</div>
                    {!done && (
                      <div className={`cell-sub${daysAway < 0 ? " cell-sub-late" : ""}`}>
                        {daysAway === 0 ? "Today" : daysAway > 0 ? `in ${days(daysAway)}` : `${days(-daysAway)} ago`}
                      </div>
                    )}
                  </td>
                  <td data-label="Progress">
                    {isEvent ? (
                      <span className={done ? "cell-main" : "muted"}>
                        {done ? (isExFactory ? "Shipped" : "Passed") : "Not yet"}
                      </span>
                    ) : (
                      <div className="progress">
                        <div className="progress-figures">
                          <span className="cell-main">
                            {pieces(milestone.doneQty)}
                            <span className="muted"> / {pieces(milestone.plannedQty ?? 0)}</span>
                          </span>
                          <span className="progress-percent">{percent}%</span>
                        </div>
                        <div className="progress-track" aria-hidden="true">
                          <span
                            className={`progress-fill progress-fill-${status ?? "NOT_STARTED"}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </td>
                  <td data-label="Pace" className={`pace-cell${active ? "" : " is-blank"}`}>
                    {active && milestone.risk ? (
                      <StageFacts risk={milestone.risk} />
                    ) : (
                      <span className="cell-empty">–</span>
                    )}
                  </td>
                  <td
                    data-label="Heading for"
                    className={`nowrap${milestone.risk?.projectedDate && !done ? "" : " is-blank"}`}
                  >
                    {milestone.risk?.projectedDate && !done ? (
                      <>
                        <div className="cell-main">{shortDate(milestone.risk.projectedDate)}</div>
                        {milestone.risk.slipDays !== null && milestone.risk.slipDays > 0 ? (
                          <div className={`cell-sub slip slip-${milestone.risk.status}`}>
                            {days(milestone.risk.slipDays)} late
                          </div>
                        ) : (
                          <div className="cell-sub cell-sub-ok">On time</div>
                        )}
                      </>
                    ) : (
                      <span className="cell-empty">–</span>
                    )}
                  </td>
                  <td className="stage-actions">
                    {isEvent &&
                      !done &&
                      (confirmingEvent === milestone.id ? (
                        <span className="confirm-inline">
                          <button
                            type="button"
                            className="btn btn-small btn-primary"
                            disabled={busyEvent === milestone.id}
                            onClick={() => void complete(milestone.id, milestone.stage)}
                          >
                            {isExFactory ? "Yes, mark shipped" : "Yes, mark passed"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-small btn-ghost"
                            onClick={() => setConfirmingEvent(null)}
                          >
                            Keep open
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          disabled={busyEvent === milestone.id}
                          onClick={() => setConfirmingEvent(milestone.id)}
                        >
                          {isExFactory ? (
                            <Truck size={15} aria-hidden="true" />
                          ) : (
                            <CircleCheck size={15} aria-hidden="true" />
                          )}
                          {isExFactory ? "Mark shipped" : "Mark passed"}
                        </button>
                      ))}
                    {milestone.catchUp && (
                      <button
                        type="button"
                        className="btn btn-small btn-ghost catchup-toggle"
                        aria-expanded={planning === milestone.id}
                        onClick={() => setPlanning(planning === milestone.id ? null : milestone.id)}
                      >
                        <LifeBuoy size={15} aria-hidden="true" />
                        How to catch up
                      </button>
                    )}
                    {!isExFactory && !done && (
                      <button
                        type="button"
                        className="btn btn-small btn-ghost"
                        aria-label={`Change ${STAGE_LABEL[milestone.stage].toLowerCase()} date`}
                        onClick={() => {
                          setSuggested(null);
                          setEditing(milestone.id);
                        }}
                      >
                        <CalendarClock size={15} aria-hidden="true" />
                        Change date
                      </button>
                    )}
                  </td>
                </tr>,
                planning === milestone.id && milestone.catchUp && (
                  <tr key={`${milestone.id}-plan`} className="edit-row catchup-row">
                    <td colSpan={6}>
                      <CatchUp
                        plan={milestone.catchUp}
                        orderId={order.id}
                        onExFactory={onExFactory}
                        onMove={(date, reason) => {
                          setSuggested({ date, reason });
                          setPlanning(null);
                          setEditing(milestone.id);
                        }}
                      />
                    </td>
                  </tr>
                ),
                editing === milestone.id && (
                  <tr key={`${milestone.id}-edit`} className="edit-row">
                    <td colSpan={6}>
                      <DateForm
                        startDate={suggested?.date}
                        startReason={suggested?.reason}
                        label={`New ${STAGE_LABEL[milestone.stage].toLowerCase()} date`}
                        savedTitle={`${STAGE_LABEL[milestone.stage]} date changed`}
                        today={order.today}
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
                <div className="note-tags">
                  <span className="stage-inline small">
                    <StageIcon stage={issue.stage} size={14} />
                    {STAGE_LABEL[issue.stage]}, {shortDate(issue.workDate)}
                  </span>
                  {category && <span className="pill">{CATEGORY_LABEL[category]}</span>}
                  <span className={`pill pill-${issue.status}`}>
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

const REPORTS_PER_PAGE = 8;

function Reports({ order }: { order: Order }) {
  const total = order.updates.reduce((sum, update) => sum + update.qty, 0);
  const reportDays = new Set(order.updates.map((update) => update.workDate)).size;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(order.updates.length / REPORTS_PER_PAGE));
  // A reload can shorten the list, so never sit past the last page.
  const current = Math.min(page, pageCount);
  const shown = order.updates.slice((current - 1) * REPORTS_PER_PAGE, current * REPORTS_PER_PAGE);
  return (
    <section className="panel" aria-labelledby="reports-heading">
      <div className="panel-head">
        <h2 id="reports-heading">Daily reports</h2>
        {order.updates.length > 0 && (
          <p className="small muted">
            {pieces(total)} pieces over {days(reportDays)}
          </p>
        )}
      </div>
      {order.updates.length === 0 ? (
        <p className="panel-body muted" style={{ paddingTop: 0 }}>
          Nothing reported yet. Reports appear here when supervisors send their daily count.
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table reports">
              <colgroup>
                <col className="col-date" />
                <col className="col-stage-sm" />
                <col className="hide-sm" />
                <col className="col-pieces" />
                <col className="col-attached" />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Stage</th>
                  <th className="hide-sm">Reported by</th>
                  <th className="num">Pieces</th>
                  <th>Attached</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((update) => (
                  <tr key={update.id}>
                    <td className="nowrap cell-main">
                      {shortDate(update.workDate)}
                      {update.enteredLate && (
                        <span className="late-entry" title="Entered on a later day than the one it counts for">
                          Added late
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="stage-inline">
                        <StageIcon stage={update.stage} size={15} />
                        {STAGE_LABEL[update.stage]}
                      </span>
                    </td>
                    <td className="hide-sm">{update.supervisor}</td>
                    <td className="num cell-main">{pieces(update.qty)}</td>
                    <td>
                      <div className="attach-list">
                        {update.photoUrl && (
                          <a className="attach" href={update.photoUrl} target="_blank" rel="noreferrer">
                            <Image size={14} aria-hidden="true" />
                            Photo
                          </a>
                        )}
                        {update.voiceUrl && (
                          <a className="attach" href={update.voiceUrl} target="_blank" rel="noreferrer">
                            <Mic size={14} aria-hidden="true" />
                            Voice note
                          </a>
                        )}
                        {update.note && (
                          <span className="attach attach-static">
                            <MessageSquareText size={14} aria-hidden="true" />
                            Note
                          </span>
                        )}
                        {!update.photoUrl && !update.voiceUrl && !update.note && <span className="cell-empty">–</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={current}
            pageSize={REPORTS_PER_PAGE}
            total={order.updates.length}
            noun={order.updates.length === 1 ? "report" : "reports"}
            label="Daily reports pages"
            onPage={setPage}
          />
        </>
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
  const [exSuggested, setExSuggested] = useState<{ date: string; reason: string } | null>(null);

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
    <>
      <header className="order-band on-dark">
        <div className="order-band-inner">
          <p className="small">
            <Link to="/board">Order board</Link>
          </p>
          <div className="order-head">
            <div className="stack" style={{ gap: "var(--s2)" }}>
              <div className="row">
                <h1 className="woven">{order.poNumber}</h1>
                <StatusTag status={order.risk.status} />
              </div>
              <p>
                {order.style}, {order.colour}. {pieces(order.totalQty)} pieces for {order.buyer.name}, {order.unit}.
              </p>
              <p className={`summary summary-${order.risk.status}`}>{summary(order)}</p>
            </div>
            <dl className="order-facts">
              <div>
                <dt>Ex-factory</dt>
                <dd>
                  {fullDate(order.exFactoryDate)}
                  {!order.shipped && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="linklike small action-link"
                        onClick={() => setChangingDate(true)}
                      >
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
          </div>
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
      </header>
      <main className="page stack">
        {changingDate && (
          <div className="panel panel-body" id="ex-factory-form">
            <DateForm
              startDate={exSuggested?.date}
              startReason={exSuggested?.reason}
              label="New ex-factory date"
              savedTitle="Ex-factory date changed"
              today={order.today}
              initial={order.exFactoryDate}
              submit={(body) => api(`/orders/${order.id}/ex-factory`, { method: "PATCH", body })}
              onDone={(saved) => {
                setChangingDate(false);
                if (saved) void reload();
              }}
            />
          </div>
        )}

        <Stages
          order={order}
          reload={reload}
          onExFactory={(date, reason) => {
            setExSuggested({ date, reason });
            setChangingDate(true);
            // The form sits above the stages; bring it into view once it has rendered.
            window.setTimeout(() => document.getElementById("ex-factory-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
          }}
        />
        <div className="detail-columns">
          <Notes order={order} />
          <DateHistory order={order} />
        </div>
        <Reports order={order} />
      </main>
    </>
  );
}
