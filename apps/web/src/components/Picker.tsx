import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/** Closes on a click outside or Escape, and hands focus back to the trigger. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  return { open, setOpen, close, wrapRef, triggerRef };
}

type TriggerProps = {
  id: string;
  label: string;
  active: boolean;
  open: boolean;
  popupId: string;
  popupRole: "listbox" | "dialog";
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onClear: () => void;
  clearLabel: string;
  icon?: ReactNode;
  children: ReactNode;
};

function Trigger(props: TriggerProps) {
  return (
    <div className="picker-trigger-row">
      <button
        ref={props.triggerRef}
        id={props.id}
        type="button"
        className="picker-trigger"
        data-active={props.active}
        aria-haspopup={props.popupRole}
        aria-expanded={props.open}
        aria-controls={props.open ? props.popupId : undefined}
        onClick={props.onToggle}
        onKeyDown={props.onKeyDown}
      >
        {props.icon}
        <span className="picker-value">{props.children}</span>
        {!props.active && <ChevronDown className="picker-chevron" size={16} aria-hidden="true" />}
      </button>
      {props.active && (
        <button type="button" className="picker-clear" aria-label={props.clearLabel} onClick={props.onClear}>
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export type Option = { value: string; label: string };

/** A dropdown drawn in the app's own style; the empty value is the "all" choice. */
export function Select({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const pop = usePopover();
  const listId = useId();
  const all: Option[] = [{ value: "", label: allLabel }, ...options];
  const selectedIndex = Math.max(0, all.findIndex((option) => option.value === value));
  const [cursor, setCursor] = useState(selectedIndex);
  const listRef = useRef<HTMLUListElement>(null);
  const current = all[selectedIndex];

  useEffect(() => {
    if (pop.open) listRef.current?.focus();
  }, [pop.open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function openAt(index: number) {
    setCursor(index);
    pop.setOpen(true);
  }

  function choose(index: number) {
    onChange(all[index]?.value ?? "");
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
      pop.close();
    } else if (event.key === "Tab") {
      pop.close(false);
    } else if (event.key.length === 1) {
      // Type a letter to jump to the next name starting with it.
      const letter = event.key.toLowerCase();
      const order = [...all.keys()].map((i) => (cursor + 1 + i) % all.length);
      const hit = order.find((i) => all[i]?.label.toLowerCase().startsWith(letter));
      if (hit !== undefined) setCursor(hit);
    }
  }

  return (
    <div className="picker" ref={pop.wrapRef}>
      <Trigger
        id={id}
        label={label}
        active={value !== ""}
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
        onClear={() => {
          onChange("");
          pop.triggerRef.current?.focus();
        }}
        clearLabel={`Show ${allLabel.toLowerCase()}`}
      >
        {current?.label ?? allLabel}
      </Trigger>
      {pop.open && (
        <ul
          ref={listRef}
          id={listId}
          className="picker-pop picker-list"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={id}
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
        </ul>
      )}
    </div>
  );
}

const CALENDAR_WIDTH = 292;

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
  label,
  value,
  today,
  onChange,
}: {
  id: string;
  label: string;
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
    gridRef.current?.querySelector<HTMLElement>(`[data-week="${focusWeek}"]`)?.focus();
  }, [pop.open, focusWeek, month]);

  const [alignEnd, setAlignEnd] = useState(false);

  function open() {
    // Open leftwards when the calendar would run off the right edge of the screen.
    const box = pop.wrapRef.current?.getBoundingClientRect();
    setAlignEnd(box ? box.left + CALENDAR_WIDTH > window.innerWidth - 16 : false);
    const start = selected || thisWeek;
    setMonth(selected || today);
    setFocusWeek(start);
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
      Escape: () => pop.close(),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      move();
    }
  }

  const monthKey = month.slice(0, 7);

  return (
    <div className="picker" ref={pop.wrapRef}>
      <Trigger
        id={id}
        label={label}
        active={selected !== ""}
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
      {pop.open && (
        <div
          id={dialogId}
          className="picker-pop calendar"
          data-align={alignEnd ? "end" : "start"}
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
        </div>
      )}
    </div>
  );
}
