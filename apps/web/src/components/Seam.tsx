import { Check } from "lucide-react";
import type { RiskStatus } from "../lib/types";

export interface SeamStage {
  key: string;
  label: string;
  /** The planned date, used to place today along the seam. */
  date: string;
  caption: string;
  /** Null for stages with no piece count, such as inspection. */
  percent: number | null;
  done: boolean;
  status?: RiskStatus;
}

const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Where today falls on the segment of work leading up to this stage's date. */
function todayPosition(stages: readonly SeamStage[], index: number, today: string): number {
  const end = stages[index]!.date;
  const start = stages[index - 1]?.date;
  if (!start || utc(end) === utc(start)) return 0;
  return ((utc(today) - utc(start)) / (utc(end) - utc(start))) * 100;
}

/**
 * Every stage of an order as one seam. Stages are evenly spaced so close dates stay readable,
 * so the marker for today shows progress between milestones rather than a true time scale.
 */
export function Seam({ stages, today }: { stages: readonly SeamStage[]; today?: string }) {
  const todayIndex = today ? stages.findIndex((stage) => stage.date >= today) : -1;

  return (
    <ol className="seam">
      {stages.map((stage, index) => {
        const filled = stage.done ? 100 : (stage.percent ?? 0);
        // Without a risk status, as on the buyer's page, work under way is simply the brand's thread.
        const tone = stage.done ? "DONE" : (stage.status ?? (filled > 0 ? "DONE" : undefined));
        return (
          <li key={stage.key} className={`seam-stage${tone ? ` seam-${tone}` : ""}`} data-done={stage.done}>
            <div className="seam-track" aria-hidden="true">
              <div className="seam-line">
                {filled > 0 && <span className="seam-fill" style={{ "--done": `${filled}%` } as React.CSSProperties} />}
                {today && index === todayIndex && (
                  <span
                    className="seam-today"
                    style={{ "--at": `${todayPosition(stages, index, today)}%` } as React.CSSProperties}
                  >
                    <span>Today</span>
                  </span>
                )}
              </div>
              <span className="seam-node">{stage.done && <Check size={13} strokeWidth={3.5} />}</span>
            </div>
            <div className="seam-text">
              <span className="seam-name">{stage.label}</span>
              <span className="small muted">
                {stage.percent !== null && !stage.done && <strong>{stage.percent}% · </strong>}
                {stage.caption}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
