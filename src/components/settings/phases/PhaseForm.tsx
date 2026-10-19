"use client";

import { useEffect } from "react";
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
import type { Phase } from "./types";

export const phaseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  color: z.string().optional(),
  orderIndex: z.number(),
  startDate: z.string().optional().or(z.literal("")),
  endDate: z.string().optional().or(z.literal("")),
});

export type PhaseFormValues = z.infer<typeof phaseSchema>;

export function PhaseForm({
  open,
  onOpenChange,
  initialData,
  projectId,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: Phase;
  projectId: string;
  onSave: (data: PhaseFormValues) => Promise<string | void>;
}) {
  const customFields = useCustomFieldsForm({ open, projectId, module: "PHASE", entityId: initialData?.id });
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<PhaseFormValues>({
    resolver: zodResolver(phaseSchema),
    defaultValues: {
      name: "",
      color: "",
      orderIndex: 0,
    },
  });

  // The parent opens this dialog by setting `open`, which Radix does not report
  // through onOpenChange, so the fields must be reset here or an edit starts blank.
  useEffect(() => {
    if (open) {
      reset({
        name: initialData?.name || "",
        color: initialData?.color || "",
        orderIndex: initialData?.orderIndex || 0,
      });
    }
  }, [open, initialData, reset]);

  const onSubmit = async (data: PhaseFormValues) => {
    const missing = customFields.validate();
    if (missing) {
      toast.error(missing);
      return;
    }
    try {
      const savedId = (await onSave(data)) || initialData?.id;
      const fieldError = savedId ? await customFields.save(savedId) : null;
      if (fieldError) {
        toast.error(`Saved, but the custom fields were not: ${fieldError}`);
        return;
      }
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error("Failed to save phase");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{initialData ? "Edit Phase" : "Add Phase"}</DialogTitle>
            <DialogDescription>Manage your project phases.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Phase Name</Label>
              <Input id="name" {...register("name")} placeholder="e.g. Planning" />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="color">Color (Hex)</Label>
              <Input id="color" {...register("color")} placeholder="#6366f1" />
            </div>
            {customFields.section}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Phase"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
