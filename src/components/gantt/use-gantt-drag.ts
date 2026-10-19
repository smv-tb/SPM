"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyDrag, dayDeltaFor, parseDate,
  type DragMode, type DragState, type GanttTask,
} from "./gantt-model";

interface Options {
  tasks: GanttTask[];
  minDate: Date;
  maxDate: Date;
  totalTimeWidth: number;
  onTaskClick?: (task: GanttTask) => void;
  onTaskUpdate?: (taskId: string, start: string, end: string) => void;
}

/**
 * Drag-to-move / drag-to-resize for Gantt bars.
 *
 * `localTasks` holds the optimistic positions while (and after) a drag; it is
 * `null` when the chart should show the `tasks` prop as-is. On a successful
 * save the optimistic position stays on screen: the parent deliberately skips
 * router.refresh() on every drag (too expensive), so reverting to the stale
 * prop would make a successful drag look like it did nothing. It reverts only
 * when there is nothing to persist or the save fails.
 */
export function useGanttDrag({ tasks, minDate, maxDate, totalTimeWidth, onTaskClick, onTaskUpdate }: Options) {
  const [localTasks, setLocalTasks] = useState<GanttTask[] | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const dragStateRef = useRef<DragState | null>(null);
  const hasDraggedRef = useRef(false);
  const localTasksRef = useRef<GanttTask[] | null>(null);

  // Window listeners are registered once per drag; they read the latest props
  // and state through this ref instead of the values captured at drag start.
  const latest = useRef({ tasks, minDate, maxDate, totalTimeWidth, onTaskClick, onTaskUpdate, localTasks });
  useEffect(() => {
    latest.current = { tasks, minDate, maxDate, totalTimeWidth, onTaskClick, onTaskUpdate, localTasks };
  });

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    localTasksRef.current = localTasks;
  }, [localTasks]);

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      const cur = latest.current;

      const dx = e.clientX - state.startX;
      if (Math.abs(dx) > 3) hasDraggedRef.current = true;
      const dayDelta = dayDeltaFor(dx, cur.minDate, cur.maxDate, cur.totalTimeWidth);

      setLocalTasks(prev => (prev ?? cur.tasks).map(t => (t.id === state.taskId ? applyDrag(t, state, dayDelta) : t)));
    };

    const handleMouseUp = async () => {
      const state = dragStateRef.current;
      if (!state) {
        hasDraggedRef.current = false;
        return;
      }
      const cur = latest.current;
      const dragged = hasDraggedRef.current;
      let shouldRevert = true;

      if (!dragged && state.mode === "move") {
        const task = (cur.localTasks ?? cur.tasks).find(t => t.id === state.taskId);
        if (task) cur.onTaskClick?.(task);
      } else if (cur.onTaskUpdate) {
        const finalTask = (localTasksRef.current ?? cur.tasks).find(t => t.id === state.taskId);
        if (finalTask) {
          try {
            await cur.onTaskUpdate(state.taskId, finalTask.start, finalTask.end);
            shouldRevert = false;
          } catch {
            shouldRevert = true;
          }
        }
      }

      setDragState(null);
      if (shouldRevert) setLocalTasks(null);
      hasDraggedRef.current = false;
      dragStateRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState]);

  const startDrag = (e: React.MouseEvent, task: GanttTask, mode: DragMode) => {
    e.stopPropagation();
    setDragState({
      taskId: task.id,
      mode,
      startX: e.clientX,
      initialStart: parseDate(task.start),
      initialEnd: parseDate(task.end),
    });
  };

  return { displayTasks: localTasks ?? tasks, dragState, startDrag };
}
