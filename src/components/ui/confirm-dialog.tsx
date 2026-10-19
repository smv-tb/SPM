"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmOptions {
  /** What will happen, in a sentence. Shown as the dialog description. */
  message: string;
  title?: string;
  /** Label for the confirming button; say the action ("Delete task"), not "OK". */
  confirmLabel?: string;
  /** Destructive actions get the danger button. Defaults to true. */
  destructive?: boolean;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let show: ((p: Pending) => void) | null = null;

/**
 * Styled replacement for await confirmDialog(). Resolves true on confirm and false on
 * cancel, Escape or outside click. Needs <ConfirmDialogHost /> mounted once.
 */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  return new Promise((resolve) => {
    if (!show) {
      // Host not mounted (should not happen in the app); fall back rather than silently proceeding.
      resolve(typeof window !== "undefined" && window.confirm(opts.message));
      return;
    }
    show({ ...opts, resolve });
  });
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    show = (p) => setPending(p);
    return () => {
      show = null;
    };
  }, []);

  function close(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  const destructive = pending?.destructive ?? true;
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) close(false); }}>
      <DialogContent className="max-w-md" role="alertdialog">
        <div className="flex items-start gap-3">
          {destructive && <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-0.5" aria-hidden />}
          <div>
            <DialogTitle>{pending?.title ?? (destructive ? "Are you sure?" : "Please confirm")}</DialogTitle>
            <DialogDescription className="mt-2 text-base text-foreground">{pending?.message}</DialogDescription>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={() => close(true)}>
            {pending?.confirmLabel ?? (destructive ? "Delete" : "Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
