"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { clientFetch } from "@/lib/client-fetch";

interface Retention {
  anonymisedAt: string | null;
  retainUntil: string | null;
  hasOpenDocuments: boolean;
  verdict: { canAnonymise: boolean; reason: string | null; until?: string };
}

function day(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Shown to people who may handle privacy requests: what is held, until when, and the two actions. */
export function ContactPrivacyPanel({ contactId, name, onDone }: { contactId: string; name: string; onDone: () => void }) {
  const router = useRouter();
  const [info, setInfo] = useState<Retention | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    clientFetch(`/api/books/contacts/${contactId}/privacy`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => live && setInfo(data))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [contactId]);

  async function anonymise() {
    if (!(await confirmDialog(`Permanently remove ${name}'s personal details from the contact and its documents? This cannot be undone.`))) return;
    setBusy(true);
    setError("");
    const res = await clientFetch(`/api/books/contacts/${contactId}/anonymise`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? `Request failed (${res.status})`);
      return;
    }
    router.refresh();
    onDone();
  }

  if (!info) return null;
  const { verdict } = info;

  let status: string;
  if (info.anonymisedAt) status = "Personal details have been removed.";
  else if (verdict.reason === "OPEN_DOCUMENTS") status = "Has draft, unpaid or part-paid documents, so nothing can be removed yet.";
  else if (verdict.reason === "WITHIN_RETENTION" && info.retainUntil) status = `Its documents must be kept until ${day(info.retainUntil)}.`;
  else if (info.retainUntil) status = `Retention ended on ${day(info.retainUntil)}. Personal details can be removed.`;
  else status = "No documents are held for this contact. Personal details can be removed.";

  return (
    <div className="rounded-md border border-border p-3 space-y-2" data-testid="contact-privacy">
      <p className="text-sm font-medium">Privacy and retention</p>
      <p className="text-sm text-muted-foreground">{status}</p>
      <div className="flex flex-wrap items-start gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={`/api/books/contacts/${contactId}/export`} download>
            <Download className="h-4 w-4 mr-1" /> Export their data
          </a>
        </Button>
      </div>
      {verdict.canAnonymise && (
        <div className="space-y-2">
          <Textarea
            rows={2}
            placeholder="Why (recorded in the audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason for anonymising"
          />
          <Button variant="outline" size="sm" disabled={busy || reason.trim().length === 0} onClick={anonymise}>
            <ShieldOff className="h-4 w-4 mr-1" /> Remove personal details
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
