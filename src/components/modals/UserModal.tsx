"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select-native";
import { toast } from "sonner";
import { clientFetch } from "@/lib/client-fetch";
import { passwordIssues } from "@/lib/password-policy";

const baseSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Valid email is required"),
  password: z.string(),
  role: z.enum(["ADMIN", "PM", "CONTRIBUTOR", "VIEWER"]),
  isActive: z.enum(["true", "false"]).optional(),
});

type BaseForm = z.infer<typeof baseSchema>;

interface User {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "PM" | "CONTRIBUTOR" | "VIEWER";
  avatarUrl?: string | null;
  isActive: boolean;
  mfaEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onSaved: () => void;
}

export function UserModal({ open, onOpenChange, user, onSaved }: UserModalProps) {
  const isEditing = !!user;

  const form = useForm<BaseForm>({
    resolver: zodResolver(baseSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "CONTRIBUTOR",
      isActive: "true",
    },
  });

  useEffect(() => {
    if (open && user) {
      form.reset({
        name: user.name,
        email: user.email,
        password: "",
        role: user.role,
        isActive: user.isActive ? "true" : "false",
      });
    } else if (open && !user) {
      form.reset({ name: "", email: "", password: "", role: "CONTRIBUTOR", isActive: "true" });
    }
  }, [open, user, form]);

  const [resetReason, setResetReason] = useState("");
  const [resetting, setResetting] = useState(false);

  async function resetMfa() {
    if (!user) return;
    setResetting(true);
    try {
      const res = await clientFetch(`/api/users/${user.id}/mfa/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: resetReason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Could not reset two-factor sign-in");
        return;
      }
      toast.success("Two-factor sign-in reset. They can sign in with their password and set it up again.");
      setResetReason("");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Network error — please check your connection");
    } finally {
      setResetting(false);
    }
  }

  async function onSubmit(data: BaseForm) {
    if (!isEditing) {
      const issues = passwordIssues(data.password, { email: data.email, name: data.name });
      if (issues.length > 0) {
        form.setError("password", { message: issues[0] });
        return;
      }

      try {
        const res = await clientFetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.name,
            email: data.email,
            password: data.password,
            role: data.role,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(body.error || "Failed to create user");
          return;
        }

        toast.success("User created successfully");
        onOpenChange(false);
        onSaved();
      } catch {
        toast.error("Network error — please check your connection");
      }
      return;
    }

    const payload: Record<string, unknown> = {
      name: data.name,
      email: data.email,
      role: data.role,
      isActive: data.isActive === "true",
    };
    if (data.password && data.password.length > 0) {
      const issues = passwordIssues(data.password, { email: data.email, name: data.name });
      if (issues.length > 0) {
        form.setError("password", { message: issues[0] });
        return;
      }
      payload.password = data.password;
    }

    try {
      const res = await clientFetch(`/api/users/${user!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Failed to update user");
        return;
      }

      toast.success("User updated successfully");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Network error — please check your connection");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit User" : "Add User"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-xs text-red-500 mt-1">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...form.register("email")} />
            {form.formState.errors.email && (
              <p className="text-xs text-red-500 mt-1">{form.formState.errors.email.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="role">Role</Label>
            <Select id="role" {...form.register("role")}>
              <option value="ADMIN">ADMIN</option>
              <option value="PM">PM</option>
              <option value="CONTRIBUTOR">CONTRIBUTOR</option>
              <option value="VIEWER">VIEWER</option>
            </Select>
          </div>

          {isEditing && (
            <div>
              <Label htmlFor="isActive">Status</Label>
              <Select id="isActive" {...form.register("isActive")}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="password">
              {isEditing ? "New Password (leave blank to keep current)" : "Password"}
            </Label>
            <Input id="password" type="password" {...form.register("password")} />
            {form.formState.errors.password && (
              <p className="text-xs text-red-500 mt-1">{form.formState.errors.password.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create User"}
            </Button>
          </DialogFooter>
        </form>

        {isEditing && user?.mfaEnabled && (
          <div className="mt-2 space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Two-factor sign-in</p>
            <p className="text-xs text-muted-foreground">
              Use this if they have lost or replaced their phone. It switches off their authenticator and recovery
              codes and signs them out everywhere; they can then sign in with their password and set it up again.
              The reason is recorded.
            </p>
            <Input
              aria-label="Reason for resetting two-factor sign-in"
              placeholder="Why? e.g. lost phone"
              value={resetReason}
              onChange={(e) => setResetReason(e.target.value)}
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={resetting || resetReason.trim().length < 3}
              onClick={resetMfa}
            >
              {resetting ? "Resetting…" : "Reset two-factor sign-in"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
