import { pieces } from "../lib/format";
import type { RiskStatus } from "../lib/types";

interface Props {
  actualPerDay: number | null;
  neededPerDay: number | null;
  status: RiskStatus;
}

/**
 * The product's one idea drawn as a bar: its full length is the pace the plan needs, the
 * fill is the pace the floor is making, and the hatched remainder is the shortfall.
 */
export function PaceGap({ actualPerDay, neededPerDay, status }: Props) {
  if (actualPerDay === null || neededPerDay === null) {
    const message =
      neededPerDay !== null
        ? `Needs ${pieces(neededPerDay)}/day, no output reported`
        : actualPerDay !== null
          ? `${pieces(actualPerDay)}/day, milestone date has passed`
          : "No pace yet";
    return <span className="small muted">{message}</span>;
  }

  const ratio = neededPerDay === 0 ? 1 : Math.min(actualPerDay / neededPerDay, 1);
  const short = Math.max(neededPerDay - actualPerDay, 0);

  return (
    <div className="pace">
      <div
        className={`pace-track pace-${status}`}
        role="img"
        aria-label={`Making ${actualPerDay} pieces a day, ${neededPerDay} a day needed`}
      >
        <span className="pace-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="pace-text small">
        <span>
          <strong>{pieces(actualPerDay)}</strong>
          <span className="muted"> /day, needs {pieces(neededPerDay)}</span>
        </span>
        {short > 0 && <span className="pace-short nowrap">−{pieces(short)}</span>}
      </div>
    </div>
  );
}
