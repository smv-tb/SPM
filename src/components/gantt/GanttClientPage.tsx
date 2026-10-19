"use client";

import { useState, useMemo, useDeferredValue } from "react";
import { GanttChart } from "./GanttChart";
import { TaskModal } from "@/components/modals/TaskModal";
import { useRouter } from "next/navigation";
import { clientFetch } from "@/lib/client-fetch";

interface GanttClientPageProps {
  tasks: any[];
  milestones: { id: string; code: string; title: string }[];
  resources: { id: string; name: string }[];
  costCategories: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  projectId: string;
}

export function GanttClientPage({ tasks, milestones, resources, costCategories, tags, projectId }: GanttClientPageProps) {
  const [selectedTask, setSelectedTask] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showRequiredOnly, setShowRequiredOnly] = useState(false);
  const router = useRouter();

  const deferredTasks = useDeferredValue(tasks);

  const handleTaskUpdate = async (taskId: string, start: string, end: string) => {
    // Note: on success, GanttChart keeps its optimistic (dragged) position on screen
    // instead of reverting to this component's `tasks` prop. We deliberately don't call
    // router.refresh() here to avoid re-running 5+ server queries on every drag; the
    // dates already match the server thanks to the PUT below. If the request fails,
    // we rethrow so GanttChart knows to revert the bar to its last saved position.
    try {
      const res = await clientFetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: start, dueDate: end }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    } catch (err) {
      // TODO: Replace with a proper toast notification system
      console.error("Failed to update task dates — drag will revert:", err);
      throw err;
    }
  };

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    deferredTasks.forEach((t: any) => {
      const tag = t.taskTags?.[0]?.tag?.name;
      if (tag) tags.add(tag);
    });
    return Array.from(tags).sort();
  }, [deferredTasks]);

  const formattedTasks = useMemo(() => {
    return deferredTasks
      .filter((t: any) => {
        if (selectedMilestone && t.milestone?.code !== selectedMilestone) return false;
        if (selectedTags.length > 0) {
          const tag = t.taskTags?.[0]?.tag?.name;
          if (!tag || !selectedTags.includes(tag)) return false;
        }
        if (showRequiredOnly && !t.isRequired) return false;
        return true;
      })
      .map((t: any) => ({
        id: t.id,
        name: t.title,
        code: t.code,
        start: typeof t.startDate === "string" ? t.startDate.split("T")[0] : t.startDate.toISOString().split("T")[0],
        end: typeof t.dueDate === "string" ? t.dueDate.split("T")[0] : t.dueDate.toISOString().split("T")[0],
        progress: t.percentDone,
        milestone: t.milestone?.code ?? "",
        tag: t.taskTags?.[0]?.tag?.name ?? null,
        isRequired: t.isRequired ?? false,
      }));
  }, [deferredTasks, selectedMilestone, selectedTags, showRequiredOnly]);

  const handleTaskClick = (task: any) => {
    const fullTask = tasks.find((t) => t.id === task.id);
    if (fullTask) {
      setSelectedTask(fullTask);
      setIsModalOpen(true);
    }
  };

  const handleSaved = () => {
    setIsModalOpen(false);
    router.refresh();
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">Milestone:</label>
          <select
            value={selectedMilestone}
            onChange={(e) => setSelectedMilestone(e.target.value)}
            className="text-xs border border-border rounded-md px-2 py-1.5 bg-card"
          >
            <option value="">All Milestones</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.code}>{m.code}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">Tags:</label>
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                  selectedTags.includes(tag)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:border-input"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showRequiredOnly}
            onChange={(e) => setShowRequiredOnly(e.target.checked)}
            className="rounded border-border"
          />
          Required only
        </label>

        {(selectedMilestone || selectedTags.length > 0 || showRequiredOnly) && (
          <button
            onClick={() => {
              setSelectedMilestone("");
              setSelectedTags([]);
              setShowRequiredOnly(false);
            }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <GanttChart tasks={formattedTasks} onTaskClick={handleTaskClick} onTaskUpdate={handleTaskUpdate} />
      <TaskModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        task={selectedTask}
        milestones={milestones}
        resources={resources}
        costCategories={costCategories}
        tags={tags}
        projectId={projectId}
        onSaved={handleSaved}
      />
    </>
  );
}