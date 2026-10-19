"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientFetch } from "@/lib/client-fetch";
import { passwordIssues, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

interface ChangePasswordFormProps {
  email: string;
  name: string;
}

/**
 * Changing your own password ends every session, this one included, so on
 * success we sign out and send the person to sign in with the new one.
 */
export function ChangePasswordForm({ email, name }: ChangePasswordFormProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // The server enforces all of this; checking here only saves a round trip.
    const issues = passwordIssues(next, { email, name });
    if (issues.length > 0) return setError(issues[0]);
    if (next !== confirm) return setError("The new passwords don't match");
    if (next === current) return setError("Choose a password different from your current one");

    setSaving(true);
    try {
      const res = await clientFetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Could not change the password");
        setSaving(false);
        return;
      }
      toast.success("Password changed — sign in again with the new one");
      await signOut({ callbackUrl: "/login" });
    } catch {
      setError("Network error — please try again");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="current-password">Current password</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          At least {PASSWORD_MIN_LENGTH} characters. A few ordinary words strung together works well.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <Button type="submit" disabled={saving || !current || !next || !confirm}>
        {saving ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
