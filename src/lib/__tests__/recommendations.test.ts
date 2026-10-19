import { describe, it, expect } from 'vitest';
import { buildRecommendations, type MilestoneSummary, type KpiSummary } from '../recommendations';

function milestone(overrides: Partial<MilestoneSummary> = {}): MilestoneSummary {
  return {
    id: 'm1',
    code: 'M1',
    title: 'Test Milestone',
    status: 'IN_PROGRESS',
    dueDate: new Date('2030-01-01'),
    percentComplete: 50,
    taskCount: 4,
    doneTasks: 2,
    actualSpend: 0,
    estBudget: 1000,
    ...overrides,
  };
}

function kpis(overrides: Partial<KpiSummary> = {}): KpiSummary {
  return { blocked: 0, overdue: 0, totalTasks: 10, done: 5, ...overrides };
}

describe('buildRecommendations', () => {
  it('flags a lagging milestone under 30% with open tasks', () => {
    const recs = buildRecommendations([milestone({ percentComplete: 10, taskCount: 4, doneTasks: 1 })], kpis());
    expect(recs.some(r => r.id === 'lagging-m1')).toBe(true);
  });

  it('does not flag a lagging milestone that has no tasks', () => {
    const recs = buildRecommendations([milestone({ percentComplete: 10, taskCount: 0 })], kpis());
    expect(recs.some(r => r.id === 'lagging-m1')).toBe(false);
  });

  it('does not flag a COMPLETE milestone as lagging even if percentComplete is low', () => {
    const recs = buildRecommendations(
      [milestone({ status: 'COMPLETE', percentComplete: 10, taskCount: 4, doneTasks: 1 })],
      kpis()
    );
    expect(recs.some(r => r.id === 'lagging-m1')).toBe(false);
  });

  it('flags a milestone that is over its estimated budget', () => {
    const recs = buildRecommendations([milestone({ estBudget: 1000, actualSpend: 1500 })], kpis());
    expect(recs.some(r => r.id === 'overbudget-m1')).toBe(true);
  });

  it('does not flag over-budget when no estimate is set', () => {
    const recs = buildRecommendations([milestone({ estBudget: 0, actualSpend: 1500 })], kpis());
    expect(recs.some(r => r.id === 'overbudget-m1')).toBe(false);
  });

  it('flags an overdue, incomplete milestone', () => {
    const recs = buildRecommendations([milestone({ dueDate: new Date('2020-01-01'), percentComplete: 50 })], kpis());
    expect(recs.some(r => r.id === 'overdue-m1')).toBe(true);
  });

  it('does not flag an overdue milestone once marked COMPLETE', () => {
    const recs = buildRecommendations(
      [milestone({ status: 'COMPLETE', dueDate: new Date('2020-01-01'), percentComplete: 80 })],
      kpis()
    );
    expect(recs.some(r => r.id === 'overdue-m1')).toBe(false);
  });

  it('flags blocked tasks project-wide', () => {
    const recs = buildRecommendations([], kpis({ blocked: 2 }));
    expect(recs.some(r => r.id === 'blocked-tasks')).toBe(true);
  });

  it('flags overdue tasks project-wide', () => {
    const recs = buildRecommendations([], kpis({ overdue: 3 }));
    expect(recs.some(r => r.id === 'overdue-tasks')).toBe(true);
  });

  it('flags early-stage progress under 25% completion', () => {
    const recs = buildRecommendations([], kpis({ totalTasks: 10, done: 1 }));
    expect(recs.some(r => r.id === 'early-progress')).toBe(true);
  });

  it('does not flag early-stage progress when there are no tasks yet', () => {
    const recs = buildRecommendations([], kpis({ totalTasks: 0, done: 0 }));
    expect(recs.some(r => r.id === 'early-progress')).toBe(false);
  });

  it('returns no recommendations for a healthy project', () => {
    const recs = buildRecommendations(
      [milestone({ percentComplete: 80, taskCount: 4, doneTasks: 3, actualSpend: 500, estBudget: 1000 })],
      kpis({ blocked: 0, overdue: 0, totalTasks: 10, done: 8 })
    );
    expect(recs).toHaveLength(0);
  });
});
