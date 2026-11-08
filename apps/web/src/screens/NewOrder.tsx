import { Check, Circle, Plus, TriangleAlert, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DatePicker, Select } from "../components/Picker";
import { StageIcon } from "../components/StageIcon";
import { LoadError, SkeletonRows } from "../components/States";
import { api, errorMessage } from "../lib/api";
import { days, fullDate, pieces, shortDate, STAGE_LABEL } from "../lib/format";
import { notify } from "../lib/toast";
import type { Reference, Stage } from "../lib/types";
import { useLoad } from "../lib/useLoad";

interface PlanStep {
  stage: Stage;
  sequence: number;
  plannedDate: string;
}

/** Stages commonly sent out. Other stages stay at the order's own unit. */
const OUTSOURCEABLE: ReadonlySet<Stage> = new Set<Stage>(["PRINTING", "WASHING"]);

const STARTING_SIZES = ["S", "M", "L", "XL"].map((size) => ({ size, qty: "" }));

/** Sizes a merchandiser often adds after the usual four, offered as one-tap chips. */
const EXTRA_SIZES = ["XS", "XXL", "3XL"];

/** One shade per size in the size split, from the order's own palette. */
const SIZE_SHADES = ["#0a3a45", "#0f6472", "#3f8f99", "#8fc2c6", "#b9dadb", "#f0b429", "#c2116f", "#7b8a8d"];

function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function dayGap(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function fromNow(iso: string, today: string): string {
  const gap = dayGap(today, iso);
  if (gap === 0) return "today";
  return gap > 0 ? `in ${days(gap)}` : `${days(-gap)} ago`;
}

interface PlanResponse {
  today: string;
  earliestExFactory: string;
  milestones: PlanStep[] | null;
}

function Plan({
  ready,
  loading,
  error,
  reload,
  milestones,
  today,
  unitId,
  reference,
  stageUnits,
  setStageUnit,
}: {
  ready: boolean;
  loading: boolean;
  error: unknown;
  reload(): void;
  milestones: PlanStep[] | null;
  today: string;
  unitId: string;
  reference: Reference;
  stageUnits: Record<string, string>;
  setStageUnit(stage: Stage, unitId: string): void;
}) {
  if (!ready) {
    return (
      <div className="plan-empty">
        <p>The plan appears here, worked back from the ex-factory date.</p>
        <p className="small muted">Choose a unit, a template and an ex-factory date.</p>
      </div>
    );
  }
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (loading || !milestones) return <SkeletonRows rows={4} height={44} />;

  const ownUnit = reference.units.find((unit) => unit.id === unitId)?.name;

  return (
    <div className="table-wrap plan-wrap">
      <table className="data-table plan">
        <colgroup>
          <col className="col-plan-stage" />
          <col className="col-plan-date" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Planned date</th>
            <th>Done by</th>
          </tr>
        </thead>
        <tbody>
          {milestones.map((step) => {
            const late = dayGap(today, step.plannedDate) < 0;
            return (
              <tr key={step.stage} data-late={late}>
                <td>
                  <span className="stage-cell">
                    <span className={`stage-chip${late ? " stage-chip-AMBER" : ""}`}>
                      <StageIcon stage={step.stage} size={16} />
                    </span>
                    <span className="stage-title">{STAGE_LABEL[step.stage]}</span>
                  </span>
                </td>
                <td className="nowrap">
                  <div className="cell-main">{fullDate(step.plannedDate)}</div>
                  <div className={`cell-sub${late ? " cell-sub-late" : ""}`}>
                    {late ? `${days(-dayGap(today, step.plannedDate))} ago, already behind` : fromNow(step.plannedDate, today)}
                  </div>
                </td>
                <td>
                  {OUTSOURCEABLE.has(step.stage) ? (
                    <Select
                      className="plan-unit"
                      ariaLabel={`Who does ${STAGE_LABEL[step.stage].toLowerCase()}`}
                      value={stageUnits[step.stage] ?? unitId}
                      options={reference.units.map((unit) => ({
                        value: unit.id,
                        label: unit.type === "SUBCONTRACT" ? `${unit.name} (outside)` : unit.name,
                      }))}
                      onChange={(value) => setStageUnit(step.stage, value)}
                    />
                  ) : (
                    <span className="muted">{ownUnit}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Check3({ done, warn, children }: { done: boolean; warn?: string; children: string }) {
  const state = warn ? "warn" : done ? "done" : "todo";
  return (
    <li className="ready-item" data-state={state}>
      <span className="ready-mark" aria-hidden="true">
        {warn ? (
          <TriangleAlert size={12} strokeWidth={2.6} />
        ) : done ? (
          <Check size={13} strokeWidth={3} />
        ) : (
          <Circle size={13} />
        )}
      </span>
      <span>
        {children}
        {warn && <span className="ready-warn">{warn}</span>}
      </span>
      <span className="visually-hidden">{warn ? ", needs a look" : done ? ", done" : ", still to do"}</span>
    </li>
  );
}

export default function NewOrder() {
  const navigate = useNavigate();
  const reference = useLoad(() => api<Reference>("/reference"), "reference");
  const [poNumber, setPoNumber] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [style, setStyle] = useState("");
  const [colour, setColour] = useState("");
  const [unitId, setUnitId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [exFactoryDate, setExFactoryDate] = useState("");
  const [sizes, setSizes] = useState(STARTING_SIZES);
  const [stageUnits, setStageUnits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStageUnits({});
  }, [templateId]);

  // Loads as soon as a unit and template are chosen, so the earliest safe date is known before a date is picked.
  const planKey = templateId && unitId ? `${templateId}|${unitId}|${exFactoryDate}` : "none";
  const plan = useLoad<PlanResponse | null>(
    () =>
      templateId && unitId
        ? api(
            `/templates/${templateId}/plan?unitId=${unitId}${exFactoryDate ? `&exFactoryDate=${exFactoryDate}` : ""}`,
          )
        : Promise.resolve(null),
    planKey,
  );
  const planData = templateId && unitId && !plan.loading ? plan.data : null;
  const earliest = planData?.earliestExFactory ?? null;
  const tightBy = earliest && exFactoryDate && exFactoryDate < earliest ? dayGap(exFactoryDate, earliest) : 0;
  const firstStep = planData?.milestones?.[0];

  const filled = sizes.filter((row) => row.size.trim() && Number(row.qty) > 0);
  const total = filled.reduce((sum, row) => sum + Number(row.qty), 0);
  const present = new Set(sizes.map((row) => row.size.trim().toUpperCase()));
  const extras = EXTRA_SIZES.filter((size) => !present.has(size));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (filled.length === 0) {
      setError("Enter a quantity for at least one size.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/orders", {
        method: "POST",
        body: {
          poNumber: poNumber.trim(),
          buyerId,
          style: style.trim(),
          colour: colour.trim(),
          unitId,
          templateId,
          exFactoryDate,
          sizes: filled.map((row) => ({ size: row.size.trim(), qty: Number(row.qty) })),
          stageUnits: Object.entries(stageUnits).map(([stage, stageUnitId]) => ({ stage, unitId: stageUnitId })),
        },
      });
      notify.success(`Order ${poNumber.trim()} saved`, "Its TNA plan is set and supervisors can start reporting.");
      navigate(`/orders/${id}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  if (reference.error && !reference.data) {
    return (
      <main className="page">
        <LoadError error={reference.error} onRetry={() => void reference.reload()} />
      </main>
    );
  }
  if (!reference.data) {
    return (
      <main className="page">
        <SkeletonRows rows={6} />
      </main>
    );
  }

  const data = reference.data;
  const ownUnits = data.units.filter((unit) => unit.type === "OWN");
  const buyer = data.buyers.find((item) => item.id === buyerId);
  const unit = data.units.find((item) => item.id === unitId);
  const template = data.templates.find((item) => item.id === templateId);
  const today = planData?.today ?? localToday();
  const detailsDone = Boolean(poNumber.trim() && buyerId && style.trim() && colour.trim());
  const planDone = Boolean(unitId && templateId && exFactoryDate);

  function setSize(index: number, change: Partial<{ size: string; qty: string }>) {
    setSizes(sizes.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }

  return (
    <main className="page new-order">
      <div className="new-order-head">
        <p className="small">
          <Link to="/board">Order board</Link>
        </p>
        <h1>New order</h1>
        <p className="muted">Set up the order and its TNA plan. Supervisors see it on their phones as soon as it is saved.</p>
      </div>

      <form className="new-order-layout" onSubmit={(event) => void submit(event)}>
        <div className="new-order-form">
          <section className="panel" aria-labelledby="details-heading">
            <div className="panel-head">
              <div>
                <h2 id="details-heading">Order details</h2>
                <p className="small muted">As written on the buyer's purchase order.</p>
              </div>
            </div>
            <div className="panel-body form-grid">
              <div className="field">
                <label htmlFor="po">PO number</label>
                <input
                  id="po"
                  className="input"
                  required
                  maxLength={40}
                  placeholder="e.g. B-PO-88300"
                  autoComplete="off"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="buyer">Buyer</label>
                <Select
                  id="buyer"
                  required
                  placeholder="Choose a buyer"
                  value={buyerId}
                  options={data.buyers.map((item) => ({ value: item.id, label: `${item.name} (${item.country})` }))}
                  onChange={setBuyerId}
                />
              </div>
              <div className="field">
                <label htmlFor="style">Style</label>
                <input
                  id="style"
                  className="input"
                  required
                  maxLength={120}
                  placeholder="e.g. Men's crew neck tee"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="colour">Colour</label>
                <input
                  id="colour"
                  className="input"
                  required
                  maxLength={60}
                  placeholder="e.g. Navy"
                  value={colour}
                  onChange={(e) => setColour(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="panel" aria-labelledby="sizes-heading">
            <div className="panel-head">
              <div>
                <h2 id="sizes-heading">Sizes</h2>
                <p className="small muted">Pieces for each size. Leave a size blank to skip it.</p>
              </div>
              <p className="size-total">
                <span className="size-total-figure">{pieces(total)}</span> pieces
              </p>
            </div>
            <div className="panel-body size-body">
              <div className="size-grid" role="group" aria-label="Sizes and pieces">
                <span className="size-grid-head">Size</span>
                <span className="size-grid-head">Pieces</span>
                <span className="size-grid-head size-grid-share">Share</span>
                <span />
                {sizes.map((row, index) => {
                  const qty = Number(row.qty) > 0 ? Number(row.qty) : 0;
                  const share = total > 0 ? Math.round((qty / total) * 100) : 0;
                  return [
                    <input
                      key={`size-${index}`}
                      className="input size-name"
                      aria-label={`Size ${index + 1} name`}
                      maxLength={20}
                      value={row.size}
                      onChange={(e) => setSize(index, { size: e.target.value })}
                    />,
                    <input
                      key={`qty-${index}`}
                      className="input size-qty"
                      aria-label={`Pieces in size ${row.size || index + 1}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={1000000}
                      placeholder="0"
                      value={row.qty}
                      onChange={(e) => setSize(index, { qty: e.target.value })}
                    />,
                    <span key={`share-${index}`} className="size-share" aria-hidden="true">
                      <span className="size-share-track">
                        <span
                          className="size-share-fill"
                          style={{ width: `${share}%`, background: SIZE_SHADES[index % SIZE_SHADES.length] }}
                        />
                      </span>
                      <span className="size-share-figure">{qty ? `${share}%` : "–"}</span>
                    </span>,
                    <button
                      key={`remove-${index}`}
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove size ${row.size || index + 1}`}
                      disabled={sizes.length === 1}
                      onClick={() => setSizes(sizes.filter((_, i) => i !== index))}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>,
                  ];
                })}
              </div>
              <div className="size-add">
                <button
                  type="button"
                  className="btn btn-small btn-ghost"
                  onClick={() => setSizes([...sizes, { size: "", qty: "" }])}
                >
                  <Plus size={15} aria-hidden="true" />
                  Add size
                </button>
                {extras.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className="size-chip"
                    aria-label={`Add size ${size}`}
                    onClick={() => setSizes([...sizes, { size, qty: "" }])}
                  >
                    <Plus size={12} aria-hidden="true" />
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="panel" aria-labelledby="plan-heading">
            <div className="panel-head">
              <div>
                <h2 id="plan-heading">TNA plan</h2>
                <p className="small muted">Every stage date is worked back from the ex-factory date. You can move any of them after saving.</p>
              </div>
            </div>
            <div className="panel-body stack">
              <div className="form-grid form-grid-3">
                <div className="field">
                  <label htmlFor="unit">Unit</label>
                  <Select
                    id="unit"
                    required
                    placeholder="Choose a unit"
                    value={unitId}
                    options={ownUnits.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={setUnitId}
                  />
                </div>
                <div className="field">
                  <label htmlFor="template">Template</label>
                  <Select
                    id="template"
                    required
                    placeholder="Choose a template"
                    value={templateId}
                    options={data.templates.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={setTemplateId}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ex-factory">Ex-factory date</label>
                  <DatePicker
                    id="ex-factory"
                    required
                    value={exFactoryDate}
                    onChange={setExFactoryDate}
                    marked={earliest ?? undefined}
                    markedLabel={earliest ? "Earliest with full lead time" : undefined}
                    softMin={earliest ?? undefined}
                    today={planData?.today}
                  />
                  {earliest && !exFactoryDate && (
                    <p className="field-hint">Earliest with the full lead time: {fullDate(earliest)}</p>
                  )}
                </div>
              </div>
            </div>
            {tightBy > 0 && earliest && template && (
              <div className="tight-warning" role="alert">
                <span className="tight-icon" aria-hidden="true">
                  <TriangleAlert size={18} />
                </span>
                <div className="tight-text">
                  <p className="tight-title">
                    {fullDate(exFactoryDate)} is too close for {template.name}
                  </p>
                  <p>
                    {firstStep
                      ? `${STAGE_LABEL[firstStep.stage]} would have to start on ${fullDate(firstStep.plannedDate)}, ${
                          dayGap(firstStep.plannedDate, today) > 0
                            ? `${days(dayGap(firstStep.plannedDate, today))} ago`
                            : "today"
                        }, so this order would start behind its plan. `
                      : "This order would start behind its plan. "}
                    The earliest ex-factory date with the full lead time is <strong>{fullDate(earliest)}</strong>,{" "}
                    {days(tightBy)} later.
                  </p>
                  <p className="small muted">You can still save it if the buyer needs this date.</p>
                </div>
                <button type="button" className="btn btn-small" onClick={() => setExFactoryDate(earliest)}>
                  Use {shortDate(earliest)}
                </button>
              </div>
            )}
            <Plan
              ready={Boolean(templateId && unitId && exFactoryDate)}
              loading={plan.loading}
              error={plan.error}
              reload={() => void plan.reload()}
              milestones={planData?.milestones ?? null}
              today={today}
              unitId={unitId}
              reference={data}
              stageUnits={stageUnits}
              setStageUnit={(stage, value) => setStageUnits({ ...stageUnits, [stage]: value })}
            />
          </section>
        </div>

        <aside className="new-order-summary" aria-label="Order summary">
          <div className="panel summary-card">
            <div className="summary-top">
              <p className={`woven summary-po${poNumber.trim() ? "" : " is-empty"}`}>{poNumber.trim() || "PO number"}</p>
              <p className="summary-style">
                {style.trim() || <span className="muted">Style</span>}
                {colour.trim() && <span className="muted">, {colour.trim()}</span>}
              </p>
            </div>

            <dl className="summary-facts">
              <div>
                <dt>Buyer</dt>
                <dd>{buyer ? buyer.name : <span className="muted">Not chosen</span>}</dd>
              </div>
              <div>
                <dt>Pieces</dt>
                <dd>
                  <strong>{pieces(total)}</strong>
                  {filled.length > 0 && <span className="muted"> in {filled.length} sizes</span>}
                </dd>
              </div>
              {total > 0 && (
                <div className="summary-split" aria-hidden="true">
                  <span className="split-bar">
                    {sizes.map((row, index) =>
                      Number(row.qty) > 0 && row.size.trim() ? (
                        <span
                          key={index}
                          style={{
                            width: `${(Number(row.qty) / total) * 100}%`,
                            background: SIZE_SHADES[index % SIZE_SHADES.length],
                          }}
                        />
                      ) : null,
                    )}
                  </span>
                  <span className="split-legend">
                    {sizes.map((row, index) =>
                      Number(row.qty) > 0 && row.size.trim() ? (
                        <span key={index}>
                          <i style={{ background: SIZE_SHADES[index % SIZE_SHADES.length] }} />
                          {row.size.trim()}
                        </span>
                      ) : null,
                    )}
                  </span>
                </div>
              )}
              <div>
                <dt>Unit</dt>
                <dd>{unit ? unit.name : <span className="muted">Not chosen</span>}</dd>
              </div>
              <div>
                <dt>Template</dt>
                <dd>
                  {template ? template.name : <span className="muted">Not chosen</span>}
                  {planData?.milestones && <span className="muted">, {planData.milestones.length} stages</span>}
                </dd>
              </div>
              <div>
                <dt>Ex-factory</dt>
                <dd>
                  {exFactoryDate ? (
                    <>
                      {fullDate(exFactoryDate)}
                      <span className="muted">, {fromNow(exFactoryDate, today)}</span>
                      {tightBy > 0 && <span className="summary-tight">Too close</span>}
                    </>
                  ) : (
                    <span className="muted">Not set</span>
                  )}
                </dd>
              </div>
            </dl>

            <ul className="ready-list">
              <Check3 done={detailsDone}>Order details</Check3>
              <Check3 done={total > 0}>Pieces for at least one size</Check3>
              <Check3
                done={planDone}
                warn={tightBy > 0 && earliest ? `${days(tightBy)} short of the lead time; earliest is ${shortDate(earliest)}` : undefined}
              >
                Unit, template and ex-factory date
              </Check3>
            </ul>

            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            <div className="summary-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Save order"}
              </button>
              <Link to="/board" className="btn btn-ghost">
                Cancel
              </Link>
            </div>
          </div>
        </aside>
      </form>
    </main>
  );
}
