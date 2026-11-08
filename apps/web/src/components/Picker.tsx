import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const EDGE = 12;
const GAP = 6;

/**
 * Opens a popup in a layer above the page, so a table or card that clips its content never cuts it off.
 * It sits under the trigger, flips above when there is no room below, and slides left at the right edge.
 * A click outside or Escape closes it and hands focus back to the trigger.
 */
function usePopover() {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ style: CSSProperties; side: "below" | "above" }>({ style: {}, side: "below" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!trigger || !pop) return;
      const width = Math.max(pop.offsetWidth, trigger.width);
      const height = pop.offsetHeight;
      const roomBelow = window.innerHeight - trigger.bottom - GAP - EDGE;
      const side = height > roomBelow && trigger.top - GAP - EDGE > roomBelow ? "above" : "below";
      const left = Math.max(EDGE, Math.min(trigger.left, window.innerWidth - EDGE - width));
      setPlace({
        side,
        style: {
          left,
          minWidth: trigger.width,
          ...(side === "below"
            ? { top: trigger.bottom + GAP, "--room": `${roomBelow}px` }
            : { bottom: window.innerHeight - trigger.top + GAP, "--room": `${trigger.top - GAP - EDGE}px` }),
        } as CSSProperties,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popRef.current?.contains(target) && !triggerRef.current?.parentElement?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  const popProps = {
    ref: (node: HTMLElement | null) => {
      popRef.current = node;
    },
    style: place.style,
    "data-side": place.side,
  };

  return { open, setOpen, close, triggerRef, popProps };
}

type TriggerProps = {
  id: string;
  ariaLabel?: string;
  active: boolean;
  placeholder: boolean;
  invalid?: boolean;
  open: boolean;
  popupId: string;
  popupRole: "listbox" | "dialog";
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onClear?: () => void;
  clearLabel?: string;
  children: ReactNode;
  extra?: ReactNode;
};

function Trigger(props: TriggerProps) {
  const clearable = props.active && props.onClear;
  return (
    <div className="picker-trigger-row">
      <button
        ref={props.triggerRef}
        id={props.id}
        type="button"
        className="picker-trigger"
        data-active={props.active}
        data-placeholder={props.placeholder}
        aria-invalid={props.invalid || undefined}
        aria-label={props.ariaLabel}
        aria-haspopup={props.popupRole}
        aria-expanded={props.open}
        aria-controls={props.open ? props.popupId : undefined}
        onClick={props.onToggle}
        onKeyDown={props.onKeyDown}
      >
        <span className="picker-value">{props.children}</span>
        {!clearable && <ChevronDown className="picker-chevron" size={16} aria-hidden="true" />}
      </button>
      {clearable && (
        <button type="button" className="picker-clear" aria-label={props.clearLabel} onClick={props.onClear}>
          <X size={15} aria-hidden="true" />
        </button>
      )}
      {props.extra}
    </div>
  );
}

/**
 * Keeps the form's own "fill this in" check for a required choice: a hidden field carries the value,
 * and when the form flags it the focus goes to the visible button instead.
 */
function RequiredProxy({ value, trigger }: { value: string; trigger: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <input
      className="picker-proxy"
      tabIndex={-1}
      aria-hidden="true"
      required
      value={value}
      onChange={() => undefined}
      onFocus={() => trigger.current?.focus()}
    />
  );
}

export type Option = { value: string; label: string };

/**
 * A dropdown drawn in the app's own style.
 * - With `allLabel` it is a filter: the empty value is the "all" choice, and a choice in use turns peacock with a clear button.
 * - With `placeholder` it is a form field: the placeholder shows until something is chosen, and `required` blocks the form until then.
 */
export function Select({
  id,
  ariaLabel,
  allLabel,
  placeholder,
  required,
  value,
  options,
  onChange,
  className,
}: {
  id?: string;
  ariaLabel?: string;
  allLabel?: string;
  placeholder?: string;
  required?: boolean;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const pop = usePopover();
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const listId = `${autoId}-list`;
  const all: Option[] = allLabel !== undefined ? [{ value: "", label: allLabel }, ...options] : options;
  const selectedIndex = all.findIndex((option) => option.value === value);
  const [cursor, setCursor] = useState(Math.max(0, selectedIndex));
  const listRef = useRef<HTMLUListElement | null>(null);
  const current = all[selectedIndex];
  const isFilter = allLabel !== undefined;

  useEffect(() => {
    if (pop.open) listRef.current?.focus({ preventScroll: true });
  }, [pop.open]);

  useEffect(() => {
    if (!pop.open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, pop.open]);

  function openAt(index: number) {
    setCursor(Math.max(0, index));
    pop.setOpen(true);
  }

  function choose(index: number) {
    const option = all[index];
    if (option) onChange(option.value);
    pop.close();
  }

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    const last = all.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, cursor + 1),
      ArrowUp: Math.max(0, cursor - 1),
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      setCursor(moves[event.key] ?? cursor);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(cursor);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      pop.close();
    } else if (event.key === "Tab") {
      pop.close(false);
    } else if (event.key.length === 1) {
      // Type a letter to jump to the next choice starting with it.
      const letter = event.key.toLowerCase();
      const order = [...all.keys()].map((i) => (cursor + 1 + i) % all.length);
      const hit = order.find((i) => all[i]?.label.toLowerCase().startsWith(letter));
      if (hit !== undefined) setCursor(hit);
    }
  }

  return (
    <div className={`picker${className ? ` ${className}` : ""}`}>
      <Trigger
        id={triggerId}
        ariaLabel={ariaLabel}
        active={isFilter && value !== ""}
        placeholder={!current}
        open={pop.open}
        popupId={listId}
        popupRole="listbox"
        triggerRef={pop.triggerRef}
        onToggle={() => (pop.open ? pop.close() : openAt(selectedIndex))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openAt(selectedIndex);
          }
        }}
        onClear={
          isFilter
            ? () => {
                onChange("");
                pop.triggerRef.current?.focus();
              }
            : undefined
        }
        clearLabel={allLabel ? `Show ${allLabel.toLowerCase()}` : undefined}
        extra={required ? <RequiredProxy value={value} trigger={pop.triggerRef} /> : null}
      >
        {current?.label ?? placeholder ?? ""}
      </Trigger>
      {pop.open &&
        createPortal(
          <ul
            {...pop.popProps}
            ref={(node) => {
              pop.popProps.ref(node);
              listRef.current = node;
            }}
            id={listId}
            className="picker-pop picker-list"
            data-has-all={isFilter}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={ariaLabel ? undefined : triggerId}
            aria-label={ariaLabel}
            aria-activedescendant={`${listId}-${cursor}`}
            onKeyDown={onListKey}
          >
            {all.map((option, index) => (
              <li
                key={option.value || "all"}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                className="picker-option"
                aria-selected={index === selectedIndex}
                data-cursor={index === cursor}
                onPointerMove={() => setCursor(index)}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {index === selectedIndex && <Check size={16} aria-hidden="true" />}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}

// Calendar days are plain ISO dates read in UTC, the same way the API reads them.
const DAY = 86_400_000;
const toIso = (date: Date) => date.toISOString().slice(0, 10);
const fromIso = (iso: string) => new Date(`${iso}T00:00:00Z`);
const mondayOf = (iso: string) => {
  const day = fromIso(iso);
  return toIso(new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY));
};
const addDays = (iso: string, count: number) => toIso(new Date(fromIso(iso).getTime() + count * DAY));
const monthTitle = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const weekTitle = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The Monday-start weeks that cover a month, as each week's Monday. */
function weeksOf(monthIso: string): string[] {
  const first = monthIso.slice(0, 8) + "01";
  const weeks: string[] = [];
  for (let monday = mondayOf(first); monday.slice(0, 7) <= monthIso.slice(0, 7); monday = addDays(monday, 7)) {
    weeks.push(monday);
  }
  return weeks;
}

function shiftMonth(monthIso: string, by: number): string {
  const date = fromIso(monthIso.slice(0, 8) + "01");
  date.setUTCMonth(date.getUTCMonth() + by);
  return toIso(date);
}

/** Picks a whole Monday-to-Sunday week, because the board filters ship dates by week. */
export function WeekPicker({
  id,
  value,
  today,
  onChange,
}: {
  id: string;
  value: string;
  today: string;
  onChange: (monday: string) => void;
}) {
  const pop = usePopover();
  const dialogId = useId();
  const selected = value ? mondayOf(value) : "";
  const [month, setMonth] = useState(selected || today);
  const [focusWeek, setFocusWeek] = useState(selected || mondayOf(today));
  const gridRef = useRef<HTMLDivElement>(null);
  const weeks = weeksOf(month);
  const thisWeek = mondayOf(today);

  useEffect(() => {
    if (!pop.open) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-week="${focusWeek}"]`)?.focus({ preventScroll: true });
  }, [pop.open, focusWeek, month]);

  function open() {
    setMonth(selected || today);
    setFocusWeek(selected || thisWeek);
    pop.setOpen(true);
  }

  function choose(monday: string) {
    onChange(monday);
    pop.close();
  }

  function moveFocus(to: string) {
    setFocusWeek(to);
    // Stepping past the month edge turns the page, like a wall calendar.
    if (!weeksOf(month).includes(to)) setMonth(addDays(to, 3));
  }

  function onWeekKey(event: KeyboardEvent<HTMLButtonElement>, monday: string) {
    const moves: Record<string, () => void> = {
      ArrowDown: () => moveFocus(addDays(monday, 7)),
      ArrowUp: () => moveFocus(addDays(monday, -7)),
      PageDown: () => {
        setMonth(shiftMonth(month, 1));
        setFocusWeek(weeksOf(shiftMonth(month, 1))[0] ?? monday);
      },
      PageUp: () => {
        setMonth(shiftMonth(month, -1));
        setFocusWeek(weeksOf(shiftMonth(month, -1))[0] ?? monday);
      },
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      move();
    }
  }

  const monthKey = month.slice(0, 7);

  return (
    <div className="picker">
      <Trigger
        id={id}
        active={selected !== ""}
        placeholder={false}
        open={pop.open}
        popupId={dialogId}
        popupRole="dialog"
        triggerRef={pop.triggerRef}
        onToggle={() => (pop.open ? pop.close() : open())}
        onClear={() => {
          onChange("");
          pop.triggerRef.current?.focus();
        }}
        clearLabel="Show any week"
      >
        {selected ? `${shortDay.format(fromIso(selected))} – ${shortDay.format(fromIso(addDays(selected, 6)))}` : "Any week"}
      </Trigger>
      {pop.open &&
        createPortal(
          <div
            {...pop.popProps}
            id={dialogId}
            className="picker-pop calendar"
            role="dialog"
            aria-label="Choose a ship week"
            onKeyDown={(event) => {
              if (event.key === "Escape") pop.close();
            }}
          >
            <div className="calendar-head">
              <button
                type="button"
                className="calendar-nav"
                aria-label="Previous month"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <span className="calendar-month" aria-live="polite">
                {monthTitle.format(fromIso(month.slice(0, 8) + "01"))}
              </span>
              <button
                type="button"
                className="calendar-nav"
                aria-label="Next month"
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="calendar-days" aria-hidden="true">
              {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                <span key={index} data-weekend={index > 4}>
                  {day}
                </span>
              ))}
            </div>

            <div className="calendar-weeks" ref={gridRef}>
              {weeks.map((monday) => (
                <button
                  key={monday}
                  type="button"
                  className="calendar-week"
                  data-week={monday}
                  aria-pressed={monday === selected}
                  aria-label={`Week of ${weekTitle.format(fromIso(monday))}${monday === thisWeek ? ", this week" : ""}`}
                  tabIndex={monday === focusWeek ? 0 : -1}
                  onClick={() => choose(monday)}
                  onKeyDown={(event) => onWeekKey(event, monday)}
                >
                  {Array.from({ length: 7 }, (_, index) => {
                    const day = addDays(monday, index);
                    return (
                      <span
                        key={day}
                        className="calendar-day"
                        data-outside={day.slice(0, 7) !== monthKey}
                        data-today={day === today}
                      >
                        {Number(day.slice(8))}
                      </span>
                    );
                  })}
                </button>
              ))}
            </div>

            <div className="calendar-foot">
              <button type="button" className="calendar-link" onClick={() => choose(thisWeek)}>
                This week
              </button>
              <button type="button" className="calendar-link" onClick={() => choose(addDays(thisWeek, 7))}>
                Next week
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
