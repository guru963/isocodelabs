import { Droplets, SearchCheck, Scissors, Shirt, Spool, Stamp, Truck, type LucideIcon } from "lucide-react";
import type { Stage } from "../lib/types";

const ICONS: Record<Stage, LucideIcon> = {
  CUTTING: Scissors,
  PRINTING: Stamp,
  WASHING: Droplets,
  STITCHING: Spool,
  FINISHING: Shirt,
  INSPECTION: SearchCheck,
  EX_FACTORY: Truck,
};

/** A picture for each stage, so a supervisor can find their line before reading a word. */
export function StageIcon({ stage, size = 22 }: { stage: Stage; size?: number }) {
  const Icon = ICONS[stage];
  return (
    <span className="stage-icon" aria-hidden="true">
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}
