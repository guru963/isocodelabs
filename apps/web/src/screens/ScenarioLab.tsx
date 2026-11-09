import { Check, FlaskConical, X } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { notify } from "../lib/toast";
import { runPhoneScenarios, type ScenarioResult } from "../scenarios/phoneScenarios";

interface ServerRun {
  results: ScenarioResult[];
  ms: number;
}

const GROUP_NOTE: Record<string, string> = {
  "Delay projection": "How the board decides a stage will be late.",
  "Catch-up planner": "What the order page offers when a stage is behind.",
  "Order setup": "Dates checked when a new order is made.",
  "AI on notes": "What happens when the AI answers badly, or not at all.",
  "Buyer safety": "What a buyer's link can and cannot see. Read only.",
  "Floor updates": "Real counts sent to the server, on a throwaway order deleted straight after.",
  "Phone queue": "The supervisor's phone, offline and online, run in this browser.",
};

const CI_URL = "https://github.com/guru963/isocodelabs/actions/workflows/ci.yml";

function groupBy(results: ScenarioResult[]): [string, ScenarioResult[]][] {
  const groups = new Map<string, ScenarioResult[]>();
  for (const r of results) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  return [...groups];
}

function Row({ result }: { result: ScenarioResult }) {
  return (
    <tr className={result.pass ? undefined : "scn-failed"}>
      <td>
        <span className="cell-main">{result.title}</span>
        <span className="small muted">{result.setup}</span>
      </td>
      <td data-label="Should">{result.expected}</td>
      <td data-label="Happened">{result.actual}</td>
      <td className="scn-mark">
        {result.pass ? (
          <span className="scn-pass" aria-label="Passed">
            <Check size={16} aria-hidden="true" />
          </span>
        ) : (
          <span className="scn-fail" aria-label="Failed">
            <X size={16} aria-hidden="true" />
          </span>
        )}
      </td>
    </tr>
  );
}

/** Runs every edge case through the real code, live, and shows what happened. */
export default function ScenarioLab() {
  const [results, setResults] = useState<ScenarioResult[] | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyFailed, setOnlyFailed] = useState(false);

  async function runAll() {
    setRunning(true);
    setError(null);
    const started = performance.now();
    try {
      const [server, phone] = await Promise.all([
        api<ServerRun>("/scenarios/run", { method: "POST" }),
        runPhoneScenarios(),
      ]);
      const all = [...server.results, ...phone];
      setResults(all);
      setSeconds((performance.now() - started) / 1000);
      const failed = all.filter((r) => !r.pass).length;
      if (failed === 0) notify.success("Every scenario passed", `${all.length} edge cases checked against the live code.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRunning(false);
    }
  }

  const failed = results?.filter((r) => !r.pass) ?? [];
  const shown = results ? (onlyFailed ? failed : results) : [];

  return (
    <main className="page page-medium">
      <div className="page-head">
        <div>
          <h1>Scenario lab</h1>
          <p className="muted">
            Runs the awkward cases through the same code the app uses: a silent supervisor, a holiday in the way, a phone that
            loses signal, an AI that makes things up. Nothing on your real orders changes.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void runAll()} disabled={running}>
          <FlaskConical size={16} aria-hidden="true" />
          {running ? "Running…" : results ? "Run again" : "Run all scenarios"}
        </button>
      </div>

      {error && (
        <p className="panel panel-body scn-error" role="alert">
          The run could not finish: {error}
        </p>
      )}

      {!results && !error && (
        <section className="panel panel-body scn-empty">
          <p>
            About 40 scenarios in seven groups. The server ones use the live database, on a throwaway order that is deleted as
            soon as they finish. The phone ones run here in your browser.
          </p>
          <ul className="scn-groups">
            {Object.entries(GROUP_NOTE).map(([group, note]) => (
              <li key={group}>
                <strong>{group}</strong>
                <span className="muted">{note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results && (
        <>
          <div className={`scn-summary ${failed.length ? "is-bad" : "is-good"}`} aria-live="polite">
            <span className="scn-score">
              {results.length - failed.length} of {results.length} passed
            </span>
            <span className="muted">in {seconds.toFixed(1)} s</span>
            <span className="scn-summary-end">
              <label className="scn-toggle">
                <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} />
                Only failures
              </label>
              <a href={CI_URL} target="_blank" rel="noreferrer" className="small">
                The full test suite on GitHub
              </a>
            </span>
          </div>

          {shown.length === 0 && <p className="panel panel-body muted">Nothing failed.</p>}

          {groupBy(shown).map(([group, rows]) => {
            const groupPassed = rows.filter((r) => r.pass).length;
            return (
              <section key={group} className="panel scn-group">
                <div className="panel-head">
                  <div>
                    <h2>{group}</h2>
                    <p className="small muted">{GROUP_NOTE[group]}</p>
                  </div>
                  <span className="small muted">
                    {groupPassed} of {rows.length}
                  </span>
                </div>
                <div className="scn-scroll">
                  <table className="data-table scn-table">
                    <colgroup>
                      <col className="scn-col-case" />
                      <col />
                      <col />
                      <col className="scn-col-mark" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Situation</th>
                        <th scope="col">What should happen</th>
                        <th scope="col">What happened</th>
                        <th scope="col">
                          <span className="visually-hidden">Result</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <Row key={r.title} result={r} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
