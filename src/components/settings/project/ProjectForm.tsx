"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useCustomFieldsForm } from "@/components/ui/custom-fields-form";
import type { Project } from "./types";

export const projectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  startDate: z.string().optional().or(z.literal("")),
  endDate: z.string().optional().or(z.literal("")),
  logoUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

export type ProjectFormValues = z.infer<typeof projectSchema>;

export function ProjectForm({
  open,
  onOpenChange,
  initialData,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData: Project;
  onSave: (data: ProjectFormValues) => Promise<void>;
}) {
  const customFields = useCustomFieldsForm({ open, projectId: initialData.id, module: "PROJECT", entityId: initialData.id });
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: initialData.name,
      description: initialData.description || "",
      startDate: initialData.startDate ? initialData.startDate.toISOString().split('T')[0] : "",
      endDate: initialData.endDate ? initialData.endDate.toISOString().split('T')[0] : "",
      logoUrl: initialData.logoUrl || "",
    },
  });

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
    if (open) {
      reset({
        name: initialData.name,
        description: initialData.description || "",
        startDate: initialData.startDate ? initialData.startDate.toISOString().split('T')[0] : "",
        endDate: initialData.endDate ? initialData.endDate.toISOString().split('T')[0] : "",
        logoUrl: initialData.logoUrl || "",
      });
    }
  };

  const onSubmit = async (data: ProjectFormValues) => {
    const missing = customFields.validate();
    if (missing) {
      toast.error(missing);
      return;
    }
    try {
      await onSave(data);
      const fieldError = await customFields.save(initialData.id);
      if (fieldError) {
        toast.error(`Saved, but the custom fields were not: ${fieldError}`);
        return;
      }
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error("Failed to save project");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update your project details and logo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name</Label>
              <Input id="name" {...register("name")} placeholder="Project Name" />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                {...register("description")}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Project description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start date</Label>
                <Input id="startDate" type="date" {...register("startDate")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End date</Label>
                <Input id="endDate" type="date" {...register("endDate")} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logoUrl">Logo URL</Label>
              <Input id="logoUrl" {...register("logoUrl")} placeholder="https://example.com/logo.png" />
              {errors.logoUrl && <p className="text-xs text-red-500">{errors.logoUrl.message}</p>}
            </div>
            {customFields.section}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
