import { describe, it, expect } from "vitest";
import {
  filterTasks,
  groupTasksByMilestone,
  taskBudgetTotals,
  normaliseTaskMoney,
  ownerOf,
  toTaskCsvRows,
} from "../tasks-helpers";

const none = { search: "", status: "", milestone: "", priority: "", tag: "" };
const m1 = { id: "m1", code: "M1", title: "First" };
const m2 = { id: "m2", code: "M2", title: "Second" };
const tasks = [
  { id: "a", code: "T-1", title: "Build rig", status: "DONE", priority: "HIGH", milestone: m1, estBudget: 100, actualSpend: 40, taskTags: [{ tag: { name: "#Ops" } }] },
  { id: "b", code: "T-2", title: "Write report", status: "BACKLOG", priority: "LOW", milestone: m2, estBudget: 50, actualSpend: 80, taskTags: [] },
  { id: "c", code: "T-3", title: "Test rig", status: "BACKLOG", priority: "LOW", milestone: m1, estBudget: null, actualSpend: null },
];

describe("filterTasks", () => {
  it("matches title or code, case-insensitively", () => {
    expect(filterTasks(tasks, { ...none, search: "RIG" }).map(t => t.id)).toEqual(["a", "c"]);
    expect(filterTasks(tasks, { ...none, search: "t-2" }).map(t => t.id)).toEqual(["b"]);
  });
  it("combines status, milestone, priority and tag", () => {
    expect(filterTasks(tasks, { ...none, status: "BACKLOG", milestone: "m1" }).map(t => t.id)).toEqual(["c"]);
    expect(filterTasks(tasks, { ...none, priority: "HIGH" }).map(t => t.id)).toEqual(["a"]);
    expect(filterTasks(tasks, { ...none, tag: "#Ops" }).map(t => t.id)).toEqual(["a"]);
  });
});

describe("groupTasksByMilestone", () => {
  it("groups in first-seen order and keeps task order", () => {
    const groups = groupTasksByMilestone(tasks);
    expect(groups.map(g => [g.id, g.tasks.map(t => t.id)])).toEqual([["m1", ["a", "c"]], ["m2", ["b"]]]);
  });
  it("collects tasks without a milestone under a placeholder", () => {
    expect(groupTasksByMilestone([{ id: "x" }])[0]).toMatchObject({ id: "unknown", code: "?", title: "Unknown" });
  });
});

describe("taskBudgetTotals", () => {
  it("treats missing amounts as zero and keeps overspend negative", () => {
    expect(taskBudgetTotals(tasks)).toEqual({ est: 150, spent: 120, remaining: 30 });
    expect(taskBudgetTotals([tasks[1]]).remaining).toBe(-30);
  });
});

describe("normaliseTaskMoney", () => {
  it("converts decimal strings to numbers and zero/empty to null", () => {
    expect(normaliseTaskMoney({ estBudget: "12.50", actualSpend: 0, extCosts: undefined, title: "x" }))
      .toEqual({ estBudget: 12.5, actualSpend: null, extCosts: null, title: "x" });
  });
});

describe("ownerOf / CSV", () => {
  it("prefers the resource, then the OWNER assignment, then any assignee", () => {
    expect(ownerOf({ resource: { name: "Res" } })).toBe("Res");
    expect(ownerOf({ taskAssignments: [{ role: "MEMBER", user: { name: "B" } }, { role: "OWNER", user: { name: "A" } }] })).toBe("A");
    expect(ownerOf({ taskAssignments: [{ role: "MEMBER", user: { name: "B" } }] })).toBe("B");
    expect(ownerOf({})).toBe("—");
  });
  it("exports remaining and a date-only due date", () => {
    const [row] = toTaskCsvRows([{ ...tasks[0], dueDate: "2026-03-05T00:00:00.000Z" }]);
    expect(row).toMatchObject({ remaining: 60, due_date: "2026-03-05", owner: "" });
  });
});
