import { STATUS_LABEL } from "../lib/format";
import type { RiskStatus } from "../lib/types";

export function StatusTag({ status, label }: { status: RiskStatus; label?: string }) {
  return <span className={`status status-${status}`}>{label ?? STATUS_LABEL[status]}</span>;
}
