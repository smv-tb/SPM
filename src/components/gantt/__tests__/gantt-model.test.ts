import { describe, it, expect } from "vitest";
import {
  applyDrag, buildColumns, buildRows, computeDateRange, dateToX, dayDeltaFor, groupByMilestone, parseDate,
  type DragState, type GanttTask,
} from "../gantt-model";

const task = (id: string, start: string, end: string, milestone = "M1"): GanttTask => ({
  id, name: id, code: id, start, end, progress: 0, milestone, tag: null, isRequired: false,
});

const drag = (mode: DragState["mode"], t: GanttTask): DragState => ({
  taskId: t.id, mode, startX: 0, initialStart: parseDate(t.start), initialEnd: parseDate(t.end),
});

describe("applyDrag", () => {
  const t = task("a", "2026-01-10", "2026-01-15");
  it("moves both ends and keeps the duration", () => {
    expect(applyDrag(t, drag("move", t), 3)).toMatchObject({ start: "2026-01-13", end: "2026-01-18" });
  });
  it("resizes one end at a time", () => {
    expect(applyDrag(t, drag("resize-left", t), -2)).toMatchObject({ start: "2026-01-08", end: "2026-01-15" });
    expect(applyDrag(t, drag("resize-right", t), 4)).toMatchObject({ start: "2026-01-10", end: "2026-01-19" });
  });
  it("refuses a resize that would invert the bar", () => {
    expect(applyDrag(t, drag("resize-left", t), 5)).toBe(t);
    expect(applyDrag(t, drag("resize-right", t), -5)).toBe(t);
  });
  it("leaves dates unchanged for a zero move", () => {
    expect(applyDrag(t, drag("move", t), 0)).toMatchObject({ start: t.start, end: t.end });
  });
});

describe("range and columns", () => {
  const tasks = [task("a", "2026-03-10", "2026-03-20"), task("b", "2026-05-01", "2026-06-15")];
  it("pads the monthly range by a month before and two after", () => {
    const { minDate, maxDate } = computeDateRange(tasks, "monthly");
    expect(minDate).toEqual(new Date(2026, 1, 1));
    expect(maxDate).toEqual(new Date(2026, 7, 0));
  });
  it("builds one column per month, and weekly columns starting on a Monday", () => {
    const { minDate, maxDate } = computeDateRange(tasks, "monthly");
    expect(buildColumns(minDate, maxDate, "monthly")).toHaveLength(6);
    const w = computeDateRange(tasks, "weekly");
    expect(w.minDate.getDay()).toBe(1);
    expect(buildColumns(w.minDate, w.maxDate, "weekly")[0].start.getDay()).toBe(1);
  });
  it("maps dates linearly onto the timeline", () => {
    const min = new Date(2026, 0, 1), max = new Date(2026, 0, 11);
    expect(dateToX(new Date(2026, 0, 6), min, max, 1000)).toBe(500);
    expect(dayDeltaFor(300, min, max, 1000)).toBe(3);
  });
});

describe("rows", () => {
  const tasks = [task("a", "2026-01-01", "2026-01-02", "M1"), task("b", "2026-01-01", "2026-01-02", "M2"), task("c", "2026-01-01", "2026-01-02", "M1")];
  it("groups by milestone and hides collapsed groups' tasks", () => {
    const grouped = groupByMilestone(tasks);
    expect(grouped.map(([c, ts]) => [c, ts.length])).toEqual([["M1", 2], ["M2", 1]]);
    expect(buildRows(grouped, new Set()).map(r => r.type)).toEqual(["milestone", "task", "task", "milestone", "task"]);
    expect(buildRows(grouped, new Set(["M1"])).map(r => r.type)).toEqual(["milestone", "milestone", "task"]);
  });
});

describe("applyDrag in summer time", () => {
  // Local midnight in BST is the previous day in UTC; the saved date must still be the calendar day shown.
  const t = task("s", "2026-06-10", "2026-06-15");
  it("does not shift dates by a day", () => {
    expect(applyDrag(t, drag("move", t), 0)).toMatchObject({ start: "2026-06-10", end: "2026-06-15" });
    expect(applyDrag(t, drag("move", t), 2)).toMatchObject({ start: "2026-06-12", end: "2026-06-17" });
  });
});

describe("applyDrag across the autumn clock change", () => {
  it("keeps whole calendar days when a bar spans 25 October 2026", () => {
    const t = task("d", "2026-10-20", "2026-10-30");
    expect(applyDrag(t, drag("move", t), 7)).toMatchObject({ start: "2026-10-27", end: "2026-11-06" });
    expect(applyDrag(t, drag("resize-right", t), 1)).toMatchObject({ start: "2026-10-20", end: "2026-10-31" });
  });
});
