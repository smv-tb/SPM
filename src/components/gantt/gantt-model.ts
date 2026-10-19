/** Pure model for the Gantt chart: types, geometry and drag maths (no React). */

export interface GanttTask {
  id: string;
  name: string;
  code: string;
  start: string;
  end: string;
  progress: number;
  milestone: string;
  tag: string | null;
  isRequired: boolean;
}

export type ViewMode = "yearly" | "monthly" | "weekly";
export type DragMode = "move" | "resize-left" | "resize-right";

export interface DragState {
  taskId: string;
  mode: DragMode;
  startX: number;
  initialStart: Date;
  initialEnd: Date;
}

export interface GanttColumn {
  start: Date;
  end: Date;
  label: string;
  year?: number;
}

export type GanttRow =
  | { type: "milestone"; code: string; taskCount: number }
  | { type: "task"; task: GanttTask };

export const hsl = (name: string) => `hsl(var(--gantt-${name}))`;

/** Colours come from theme variables (globals.css) so the chart follows the selected theme. */
export const TAG_COLORS: Record<string, { bar: string; progress: string }> = {
  "#Mori-Infra":  { bar: hsl("infra"), progress: hsl("infra-fill") },
  "#Veda-Science": { bar: hsl("science"), progress: hsl("science-fill") },
  "#Ops-Sales":    { bar: hsl("ops"), progress: hsl("ops-fill") },
};

export const DEFAULT_COLOR = { bar: hsl("other"), progress: hsl("other-fill") };

export const ROW_HEIGHT = 32;
export const BAR_HEIGHT = 20;
export const BAR_Y_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;
export const LABEL_COL_WIDTH = 240;
export const HEADER_HEIGHT = 50;
export const RESIZE_HIT = 8;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function parseDate(s: string) { return new Date(s + "T00:00:00"); }

export function monthsBetween(a: Date, b: Date) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function getMonday(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

export function columnWidthFor(viewMode: ViewMode) {
  return viewMode === "yearly" ? 60 : viewMode === "monthly" ? 100 : 30;
}

/** Min/max across all tasks, padded according to the view mode. */
export function computeDateRange(tasks: GanttTask[], viewMode: ViewMode) {
  if (tasks.length === 0) return { minDate: new Date(), maxDate: new Date() };

  let min = parseDate(tasks[0].start);
  let max = parseDate(tasks[0].end);
  for (const t of tasks) {
    const s = parseDate(t.start);
    const e = parseDate(t.end);
    if (s < min) min = s;
    if (e > max) max = e;
  }

  if (viewMode === "yearly") {
    min = new Date(min.getFullYear(), min.getMonth() - 3, 1);
    max = new Date(max.getFullYear(), max.getMonth() + 4, 0);
  } else if (viewMode === "monthly") {
    min = new Date(min.getFullYear(), min.getMonth() - 1, 1);
    max = new Date(max.getFullYear(), max.getMonth() + 2, 0);
  } else {
    const minMonday = getMonday(min);
    minMonday.setDate(minMonday.getDate() - 14);
    min = minMonday;
    const maxMonday = getMonday(max);
    maxMonday.setDate(maxMonday.getDate() + 21);
    max = maxMonday;
  }

  return { minDate: min, maxDate: max };
}

export function buildColumns(minDate: Date, maxDate: Date, viewMode: ViewMode): GanttColumn[] {
  const cols: GanttColumn[] = [];
  if (viewMode === "yearly" || viewMode === "monthly") {
    const count = monthsBetween(minDate, maxDate) + 1;
    for (let i = 0; i < count; i++) {
      const d = new Date(minDate.getFullYear(), minDate.getMonth() + i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      cols.push({
        start: d,
        end,
        label: d.toLocaleDateString("en-GB", {
          month: "short",
          year: viewMode === "yearly" ? "2-digit" : undefined,
        }),
        year: d.getFullYear(),
      });
    }
  } else {
    const current = new Date(minDate);
    while (current <= maxDate) {
      const monday = new Date(current);
      const sunday = new Date(current);
      sunday.setDate(sunday.getDate() + 6);
      cols.push({ start: monday, end: sunday, label: `${monday.getDate()}` });
      current.setDate(current.getDate() + 7);
    }
  }
  return cols;
}

/** Converts a date to an x position within the timeline (label column excluded). */
export function dateToX(d: Date, minDate: Date, maxDate: Date, totalTimeWidth: number) {
  const totalDays = (maxDate.getTime() - minDate.getTime()) / MS_PER_DAY;
  const dayOffset = (d.getTime() - minDate.getTime()) / MS_PER_DAY;
  return (dayOffset / totalDays) * totalTimeWidth;
}

/** Whole days a horizontal pointer movement of `dx` pixels represents. */
export function dayDeltaFor(dx: number, minDate: Date, maxDate: Date, totalTimeWidth: number) {
  const daysPerPx = (maxDate.getTime() - minDate.getTime()) / MS_PER_DAY / totalTimeWidth;
  return Math.round(dx * daysPerPx);
}

/** The calendar day a local date shows on screen, as YYYY-MM-DD (never the UTC day). */
export function toDateKey(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Calendar-day arithmetic; unlike adding 24h blocks it survives clock changes. */
function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Applies a drag to one task; returns the same task when the result would be invalid. */
export function applyDrag(task: GanttTask, state: DragState, dayDelta: number): GanttTask {
  const start = state.initialStart;
  const end = state.initialEnd;
  const durationDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);

  let newStart = new Date(start);
  let newEnd = new Date(end);

  if (state.mode === "move") {
    newStart = addDays(start, dayDelta);
    newEnd = addDays(newStart, durationDays);
  } else if (state.mode === "resize-left") {
    newStart = addDays(start, dayDelta);
    if (newStart >= newEnd) return task;
  } else if (state.mode === "resize-right") {
    newEnd = addDays(end, dayDelta);
    if (newEnd <= newStart) return task;
  }

  return { ...task, start: toDateKey(newStart), end: toDateKey(newEnd) };
}

export function groupByMilestone(tasks: GanttTask[]): [string, GanttTask[]][] {
  const map = new Map<string, GanttTask[]>();
  for (const t of tasks) {
    const arr = map.get(t.milestone) || [];
    arr.push(t);
    map.set(t.milestone, arr);
  }
  return Array.from(map.entries());
}

export function buildRows(grouped: [string, GanttTask[]][], collapsed: Set<string>): GanttRow[] {
  const result: GanttRow[] = [];
  for (const [code, mTasks] of grouped) {
    result.push({ type: "milestone", code, taskCount: mTasks.length });
    if (!collapsed.has(code)) {
      for (const t of mTasks) result.push({ type: "task", task: t });
    }
  }
  return result;
}
