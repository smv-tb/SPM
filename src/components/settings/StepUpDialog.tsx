"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientFetch, registerStepUpHandler } from "@/lib/client-fetch";

/**
 * The "confirm it's you" prompt behind sensitive actions. Mounted once in the
 * app layout; `clientFetch` calls it when the server answers `step_up_required`.
 * Requests that need it at the same moment share one prompt.
 */
export function StepUpDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (ok: boolean) => void } | null>(null);

  const ask = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current.promise; // already asking
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => { resolve = r; });
    pending.current = { promise, resolve };
    setCode("");
    setError("");
    setNeedsSignIn(false);
    setOpen(true);
    return promise;
  }, []);

  useEffect(() => registerStepUpHandler(ask), [ask]);

  function finish(ok: boolean) {
    pending.current?.resolve(ok);
    pending.current = null;
    setOpen(false);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await clientFetch("/api/account/step-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return finish(true);
      if (body.code === "signin_required") setNeedsSignIn(true);
      setError(body.error || "That code isn't right");
      setCode("");
    } catch {
      setError("Network error — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) finish(false); }}>
      <DialogContent>
        <form onSubmit={confirm} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" /> Confirm it&rsquo;s you
            </DialogTitle>
            <DialogDescription>
              This action needs a fresh code from your authenticator app. You won&rsquo;t be asked again for a few minutes.
            </DialogDescription>
          </DialogHeader>

          {!needsSignIn && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="step-up-code">6-digit code</Label>
              <Input
                id="step-up-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="max-w-[10rem] tracking-widest"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(false)}>Cancel</Button>
            {!needsSignIn && (
              <Button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6}>
                {busy ? "Checking…" : "Confirm"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
