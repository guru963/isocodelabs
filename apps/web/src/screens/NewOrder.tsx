import { useEffect, useState, type FormEvent } from "react";
import { Select } from "../components/Picker";
import { Link, useNavigate } from "react-router-dom";
import { LoadError, SkeletonRows } from "../components/States";
import { api, errorMessage } from "../lib/api";
import { fullDate, pieces, STAGE_LABEL } from "../lib/format";
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

function Plan({
  templateId,
  exFactoryDate,
  unitId,
  reference,
  stageUnits,
  setStageUnit,
}: {
  templateId: string;
  exFactoryDate: string;
  unitId: string;
  reference: Reference;
  stageUnits: Record<string, string>;
  setStageUnit(stage: Stage, unitId: string): void;
}) {
  const ready = Boolean(templateId && exFactoryDate && unitId);
  const key = `${templateId}|${exFactoryDate}|${unitId}`;
  const plan = useLoad<{ milestones: PlanStep[] } | null>(
    () =>
      ready
        ? api(`/templates/${templateId}/plan?exFactoryDate=${exFactoryDate}&unitId=${unitId}`)
        : Promise.resolve(null),
    key,
  );

  if (!ready) {
    return <p className="muted">Choose a unit, a template and an ex-factory date to see the planned dates.</p>;
  }
  if (plan.error) return <LoadError error={plan.error} onRetry={() => void plan.reload()} />;
  if (!plan.data) return <SkeletonRows rows={3} height={32} />;

  return (
    <table className="plan">
      <thead>
        <tr>
          <th>Stage</th>
          <th>Planned date</th>
          <th>Done by</th>
        </tr>
      </thead>
      <tbody>
        {plan.data.milestones.map((step) => (
          <tr key={step.stage}>
            <td>{STAGE_LABEL[step.stage]}</td>
            <td className="nowrap">{fullDate(step.plannedDate)}</td>
            <td>
              {OUTSOURCEABLE.has(step.stage) ? (
                <Select
                  ariaLabel={`Who does ${STAGE_LABEL[step.stage].toLowerCase()}`}
                  value={stageUnits[step.stage] ?? unitId}
                  options={reference.units.map((unit) => ({ value: unit.id, label: unit.name }))}
                  onChange={(value) => setStageUnit(step.stage, value)}
                />
              ) : (
                <span className="muted">{reference.units.find((unit) => unit.id === unitId)?.name}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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

  const filled = sizes.filter((row) => row.size.trim() && Number(row.qty) > 0);
  const total = filled.reduce((sum, row) => sum + Number(row.qty), 0);

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
      navigate(`/orders/${id}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  if (reference.error && !reference.data) {
    return (
      <main className="page page-narrow">
        <LoadError error={reference.error} onRetry={() => void reference.reload()} />
      </main>
    );
  }
  if (!reference.data) {
    return (
      <main className="page page-narrow">
        <SkeletonRows rows={6} />
      </main>
    );
  }

  const data = reference.data;
  const ownUnits = data.units.filter((unit) => unit.type === "OWN");

  return (
    <main className="page page-narrow">
      <p className="small" style={{ marginBottom: "var(--s3)" }}>
        <Link to="/board">Order board</Link>
      </p>
      <h1 style={{ marginBottom: "var(--s4)" }}>New order</h1>
      <form className="stack form-sections" onSubmit={(event) => void submit(event)}>
        <section className="panel panel-body form-grid">
          <div className="field">
            <label htmlFor="po">PO number</label>
            <input id="po" className="input" required maxLength={40} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="buyer">Buyer</label>
            <Select
              id="buyer"
              required
              placeholder="Choose a buyer"
              value={buyerId}
              options={data.buyers.map((buyer) => ({ value: buyer.id, label: `${buyer.name} (${buyer.country})` }))}
              onChange={setBuyerId}
            />
          </div>
          <div className="field">
            <label htmlFor="style">Style</label>
            <input id="style" className="input" required maxLength={120} value={style} onChange={(e) => setStyle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="colour">Colour</label>
            <input id="colour" className="input" required maxLength={60} value={colour} onChange={(e) => setColour(e.target.value)} />
          </div>
        </section>

        <section className="panel panel-body stack" aria-labelledby="sizes-heading">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 id="sizes-heading">Sizes</h2>
            <span className="small muted">Total {pieces(total)} pieces</span>
          </div>
          <div className="sizes">
            {sizes.map((row, index) => (
              <div key={index} className="size-row">
                <input
                  className="input"
                  aria-label={`Size ${index + 1} name`}
                  maxLength={20}
                  value={row.size}
                  onChange={(e) => setSizes(sizes.map((r, i) => (i === index ? { ...r, size: e.target.value } : r)))}
                />
                <input
                  className="input"
                  aria-label={`Size ${index + 1} quantity`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000000}
                  placeholder="Pieces"
                  value={row.qty}
                  onChange={(e) => setSizes(sizes.map((r, i) => (i === index ? { ...r, qty: e.target.value } : r)))}
                />
                <button
                  type="button"
                  className="btn btn-small"
                  aria-label={`Remove size ${row.size || index + 1}`}
                  disabled={sizes.length === 1}
                  onClick={() => setSizes(sizes.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div>
            <button type="button" className="btn btn-small" onClick={() => setSizes([...sizes, { size: "", qty: "" }])}>
              Add size
            </button>
          </div>
        </section>

        <section className="panel panel-body stack" aria-labelledby="plan-heading">
          <h2 id="plan-heading">TNA plan</h2>
          <div className="form-grid form-grid-3">
            <div className="field">
              <label htmlFor="unit">Unit</label>
              <Select
                id="unit"
                required
                placeholder="Choose a unit"
                value={unitId}
                options={ownUnits.map((unit) => ({ value: unit.id, label: unit.name }))}
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
                options={data.templates.map((template) => ({ value: template.id, label: template.name }))}
                onChange={setTemplateId}
              />
            </div>
            <div className="field">
              <label htmlFor="ex-factory">Ex-factory date</label>
              <input id="ex-factory" type="date" className="input" required value={exFactoryDate} onChange={(e) => setExFactoryDate(e.target.value)} />
            </div>
          </div>
          <Plan
            templateId={templateId}
            exFactoryDate={exFactoryDate}
            unitId={unitId}
            reference={data}
            stageUnits={stageUnits}
            setStageUnit={(stage, value) => setStageUnits({ ...stageUnits, [stage]: value })}
          />
          <p className="small muted">You can move any planned date after saving. Each change is kept in the date history.</p>
        </section>

        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save order"}
          </button>
          <Link to="/board" className="btn">
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
