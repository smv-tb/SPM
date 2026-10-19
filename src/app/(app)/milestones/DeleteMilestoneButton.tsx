"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { clientFetch } from "@/lib/client-fetch";

export function DeleteMilestoneButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();

  async function handleDelete() {
    if (!await confirmDialog(`Delete "${title}"? This will also remove all tasks under this milestone.`)) return;
    try {
      const res = await clientFetch(`/api/milestones/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to delete milestone");
        return;
      }
      toast.success("Milestone deleted");
      router.push("/milestones");
      router.refresh();
    } catch {
      toast.error("Failed to delete milestone");
    }
  }

  return (
    <button
      onClick={handleDelete}
      className="p-2 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
      title="Delete milestone"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
