"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import {
  TAG_COLORS, DEFAULT_COLOR, ROW_HEIGHT, BAR_HEIGHT, BAR_Y_OFFSET, LABEL_COL_WIDTH, HEADER_HEIGHT, RESIZE_HIT,
  hsl, parseDate, columnWidthFor, computeDateRange, buildColumns, dateToX as toX, groupByMilestone, buildRows,
  type GanttTask, type ViewMode,
} from "./gantt-model";
import { useGanttDrag } from "./use-gantt-drag";

const COLLAPSED_KEY = "gantt:collapsedMilestones";
const VIEW_KEY = "gantt:viewMode";

export function GanttChart({ tasks, onTaskClick, onTaskUpdate }: { tasks: GanttTask[]; onTaskClick?: (task: GanttTask) => void; onTaskUpdate?: (taskId: string, start: string, end: string) => void }) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  const [collapsedMilestones, setCollapsedMilestones] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      if (stored) setCollapsedMilestones(new Set(JSON.parse(stored)));
      const storedView = localStorage.getItem(VIEW_KEY) as ViewMode | null;
      if (storedView && ["yearly", "monthly", "weekly"].includes(storedView)) {
        setViewMode(storedView);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedMilestones])); } catch { /* storage unavailable */ }
  }, [collapsedMilestones]);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch { /* storage unavailable */ }
  }, [viewMode]);

  const toggleMilestone = (code: string) => {
    setCollapsedMilestones(prev => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const columnWidth = columnWidthFor(viewMode);
  const { minDate, maxDate } = useMemo(() => computeDateRange(tasks, viewMode), [tasks, viewMode]);
  const columns = useMemo(
    () => (tasks.length === 0 ? [] : buildColumns(minDate, maxDate, viewMode)),
    [minDate, maxDate, viewMode, tasks.length]
  );
  const totalTimeWidth = columns.length * columnWidth;

  const { displayTasks, dragState, startDrag } = useGanttDrag({
    tasks, minDate, maxDate, totalTimeWidth, onTaskClick, onTaskUpdate,
  });

  const grouped = useMemo(() => groupByMilestone(displayTasks), [displayTasks]);
  const rows = useMemo(() => buildRows(grouped, collapsedMilestones), [grouped, collapsedMilestones]);
  const bodyHeight = rows.length * ROW_HEIGHT;

  const dateToX = useCallback(
    (d: Date) => toX(d, minDate, maxDate, totalTimeWidth),
    [minDate, maxDate, totalTimeWidth]
  );

  // Today marker — client-only to avoid hydration mismatch from Date.now()
  const [todayX, setTodayX] = useState<number | null>(null);
  const [hoveredTask, setHoveredTask] = useState<string | null>(null);

  const scrollInitialized = useRef(false);

  useEffect(() => {
    scrollInitialized.current = false;
  }, [viewMode]);

  useEffect(() => {
    const today = new Date();
    if (today >= minDate && today <= maxDate) {
      setTodayX(dateToX(today));
      if (!scrollInitialized.current && timelineRef.current) {
        timelineRef.current.scrollLeft = Math.max(0, dateToX(today) - 300);
        scrollInitialized.current = true;
      }
    }
  }, [minDate, maxDate, dateToX]);

  // Sync vertical scroll between labels and timeline
  useEffect(() => {
    const timeline = timelineRef.current;
    const labels = labelsRef.current;
    if (!timeline || !labels) return;

    const syncFromTimeline = () => { labels.scrollTop = timeline.scrollTop; };
    const syncFromLabels = () => { timeline.scrollTop = labels.scrollTop; };

    timeline.addEventListener("scroll", syncFromTimeline);
    labels.addEventListener("scroll", syncFromLabels);
    return () => {
      timeline.removeEventListener("scroll", syncFromTimeline);
      labels.removeEventListener("scroll", syncFromLabels);
    };
  }, []);

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No tasks with dates found. Add tasks with start/end dates to see the Gantt chart.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {Object.entries(TAG_COLORS).map(([tag, colors]) => (
          <div key={tag} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: colors.bar }} />
            {tag}
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: DEFAULT_COLOR.bar }} />
          Other
        </div>
      </div>

      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        {(["yearly", "monthly", "weekly"] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
              viewMode === mode
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-input"
            }`}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      {/* Gantt — split into frozen labels + scrollable timeline */}
      <div className="rounded-xl border border-border bg-card overflow-hidden flex" style={{ maxHeight: "75vh" }}>
        {/* Frozen label column */}
        <div className="shrink-0 border-r border-border" style={{ width: LABEL_COL_WIDTH }}>
          {/* Label header */}
          <div className="bg-surface-container-low border-b border-border px-3 flex items-center" style={{ height: HEADER_HEIGHT }}>
            <span className="text-xs font-semibold text-muted-foreground">Task</span>
          </div>
          {/* Label rows */}
          <div ref={labelsRef} className="overflow-hidden" style={{ maxHeight: `calc(75vh - ${HEADER_HEIGHT}px)` }}>
            {rows.map((row, i) => {
              const isMilestone = row.type === "milestone";
              return (
                <div
                  key={row.type === "milestone" ? `ms-${row.code}` : `task-${row.task.id}`}
                  className={`flex items-center px-3 border-b border-border ${isMilestone ? "bg-surface-container-low" : i % 2 === 0 ? "bg-card" : "bg-surface-container-low/40"}`}
                  style={{ height: ROW_HEIGHT }}
                >
                  {isMilestone ? (
                    <button
                      onClick={() => toggleMilestone(row.code)}
                      className="flex items-center gap-2 text-xs font-bold text-foreground truncate w-full hover:bg-muted rounded px-1 -mx-1"
                      aria-expanded={!collapsedMilestones.has(row.code)}
                    >
                      <svg className={`w-3 h-3 shrink-0 transition-transform ${collapsedMilestones.has(row.code) ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="truncate">{row.code}</span>
                      <span className="text-xs text-muted-foreground font-normal ml-auto">({row.taskCount})</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 min-w-0 pl-5">
                      <span className="text-xs font-mono text-muted-foreground shrink-0">{row.task.code}</span>
                      <span className="text-xs text-muted-foreground truncate">{row.task.name}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable timeline */}
        <div ref={timelineRef} className="flex-1 overflow-auto" style={{ maxHeight: "75vh" }}>
          <svg width={totalTimeWidth} height={HEADER_HEIGHT + bodyHeight} className="select-none">
            {/* Column headers */}
            {columns.map((c, i) => {
              const x = i * columnWidth;
              const isYearBoundary = viewMode === "yearly" && i > 0 && c.year !== columns[i - 1].year;
              return (
                <g key={i}>
                  <rect x={x} y={0} width={columnWidth} height={HEADER_HEIGHT} style={{ fill: hsl("head"), stroke: hsl("line") }} strokeWidth={0.5} />
                  {isYearBoundary && (
                    <line x1={x} y1={0} x2={x} y2={HEADER_HEIGHT + bodyHeight} style={{ stroke: hsl("line-strong") }} strokeWidth={1.5} />
                  )}
                  <text x={x + columnWidth / 2} y={30} textAnchor="middle" fontSize={viewMode === "weekly" ? 9 : 11} style={{ fill: hsl("text") }} fontWeight={500}>
                    {c.label}
                  </text>
                </g>
              );
            })}

            {/* Grid rows */}
            {rows.map((row, i) => {
              const y = HEADER_HEIGHT + i * ROW_HEIGHT;
              const isMilestone = row.type === "milestone";
              return (
                <rect key={row.type === "milestone" ? `grid-${row.code}` : `grid-task-${row.task.id}`} x={0} y={y} width={totalTimeWidth} height={ROW_HEIGHT}
                  style={{ fill: hsl(isMilestone ? "row-ms" : i % 2 === 0 ? "row" : "row-alt"), stroke: hsl("line") }} strokeWidth={0.5} />
              );
            })}

            {/* Vertical column grid lines */}
            {columns.map((_, i) => {
              const x = i * columnWidth;
              return <line key={i} x1={x} y1={HEADER_HEIGHT} x2={x} y2={HEADER_HEIGHT + bodyHeight} style={{ stroke: hsl("line") }} strokeWidth={1} />;
            })}

            {/* Today line */}
            {todayX && (
              <>
                <line x1={todayX} y1={HEADER_HEIGHT} x2={todayX} y2={HEADER_HEIGHT + bodyHeight} style={{ stroke: hsl("today") }} strokeWidth={1.5} strokeDasharray="4 3" />
                <rect x={todayX - 22} y={HEADER_HEIGHT - 14} width={44} height={14} rx={3} style={{ fill: hsl("today") }} />
                <text x={todayX} y={HEADER_HEIGHT - 4} textAnchor="middle" fontSize={9} style={{ fill: hsl("today-fg") }} fontWeight={600}>TODAY</text>
              </>
            )}

            {/* Task bars */}
            {rows.map((row, i) => {
              if (row.type === "milestone") return null;

              const y = HEADER_HEIGHT + i * ROW_HEIGHT;
              const task = row.task;
              const colors = TAG_COLORS[task.tag ?? ""] ?? DEFAULT_COLOR;
              const startX = dateToX(parseDate(task.start));
              const endX = dateToX(parseDate(task.end));
              const barWidth = Math.max(endX - startX, 4);
              const progressWidth = barWidth * (task.progress / 100);
              const isHovered = hoveredTask === task.id;
              const isDragging = dragState?.taskId === task.id;
              return (
                <g
                  key={row.task.id}
                  onMouseEnter={() => setHoveredTask(task.id)}
                  onMouseLeave={() => setHoveredTask(null)}
                >
                  {/* Bar background */}
                  <rect x={startX} y={y + BAR_Y_OFFSET} width={barWidth} height={BAR_HEIGHT} rx={4} style={{ fill: colors.bar }} opacity={isDragging ? 0.7 : 0.85} />
                  {/* Progress fill */}
                  {task.progress > 0 && (
                    <rect x={startX} y={y + BAR_Y_OFFSET} width={progressWidth} height={BAR_HEIGHT} rx={4} style={{ fill: colors.progress }} />
                  )}
                  {/* % label on bar if wide enough */}
                  {barWidth > 40 && (
                    <text x={startX + barWidth / 2} y={y + ROW_HEIGHT / 2 + 4} textAnchor="middle" fontSize={9} style={{ fill: hsl("bar-text") }} fontWeight={600}>
                      {task.progress}%
                    </text>
                  )}
                  {/* Invisible wider hit area for move — rendered on top so it captures events */}
                  <rect
                    x={startX} y={y + BAR_Y_OFFSET} width={barWidth} height={BAR_HEIGHT}
                    fill="transparent"
                    className="cursor-move"
                    onMouseDown={(e) => startDrag(e, task, "move")}
                  />
                  {/* Left resize handle */}
                  <rect
                    x={startX} y={y + BAR_Y_OFFSET} width={Math.min(RESIZE_HIT, barWidth)} height={BAR_HEIGHT}
                    style={{ fill: isHovered || isDragging ? "hsl(var(--foreground) / 0.18)" : "transparent" }}
                    className="cursor-ew-resize"
                    onMouseDown={(e) => startDrag(e, task, "resize-left")}
                  />
                  {/* Right resize handle */}
                  <rect
                    x={endX - Math.min(RESIZE_HIT, barWidth)} y={y + BAR_Y_OFFSET} width={Math.min(RESIZE_HIT, barWidth)} height={BAR_HEIGHT}
                    style={{ fill: isHovered || isDragging ? "hsl(var(--foreground) / 0.18)" : "transparent" }}
                    className="cursor-ew-resize"
                    onMouseDown={(e) => startDrag(e, task, "resize-right")}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

