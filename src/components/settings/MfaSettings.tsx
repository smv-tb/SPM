"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientFetch } from "@/lib/client-fetch";
import { QrCode } from "@/components/settings/QrCode";

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

type Step =
  | { kind: "idle" }
  | { kind: "scan"; secret: string; uri: string }
  | { kind: "codes"; codes: string[]; context: "setup" | "regenerate" }
  | { kind: "regenerate" };

const group = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/**
 * `forced` is the version shown to a user whose role requires two-factor and
 * who has not set it up: same steps, but finishing leads into the app.
 */
export function MfaSettings({ initial, email, forced = false }: { initial: MfaStatus; email: string; forced?: boolean }) {
  const [status, setStatus] = useState(initial);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function post(url: string, payload?: object) {
    const res = await clientFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
  }

  async function refresh() {
    const res = await clientFetch("/api/account/mfa");
    if (res.ok) setStatus(await res.json());
  }

  async function start() {
    setBusy(true);
    setError("");
    const { ok, body } = await post("/api/account/mfa/begin");
    setBusy(false);
    if (!ok) return setError(body.error || "Could not start setup");
    setCode("");
    setStep({ kind: "scan", secret: body.secret, uri: body.uri });
  }

  async function confirm() {
    setBusy(true);
    setError("");
    const { ok, body } = await post("/api/account/mfa/confirm", { code });
    setBusy(false);
    if (!ok) return setError(body.error || "That code isn't right");
    setCode("");
    setSaved(false);
    setStep({ kind: "codes", codes: body.recoveryCodes, context: "setup" });
    void refresh();
  }

  async function regenerate() {
    setBusy(true);
    setError("");
    const { ok, body } = await post("/api/account/mfa/recovery-codes", { code });
    setBusy(false);
    if (!ok) return setError(body.error || "That code isn't right");
    setCode("");
    setSaved(false);
    setStep({ kind: "codes", codes: body.recoveryCodes, context: "regenerate" });
    void refresh();
  }

  function download(codes: string[]) {
    const text = `Smartvie PM recovery codes for ${email}\nEach works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "smartvie-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const codeInput = (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="mfa-code">6-digit code from your authenticator app</Label>
      <Input
        id="mfa-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="max-w-[10rem] tracking-widest"
      />
    </div>
  );

  const errorLine = error && (
    <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
  );

  if (step.kind === "scan") {
    return (
      <div className="space-y-4">
        <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
          <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
          <li>Scan this code, or choose &ldquo;enter a setup key&rdquo; and type the key below it.</li>
          <li>Enter the 6-digit code the app shows to finish.</li>
        </ol>
        <div className="flex flex-col sm:flex-row gap-5 items-start">
          <QrCode value={step.uri} label="Authenticator setup QR code" className="w-44 h-44 rounded-lg border shrink-0" />
          <div className="space-y-1 max-w-[15rem]">
            <p className="text-xs text-muted-foreground">Setup key (if you can&rsquo;t scan)</p>
            <code data-testid="mfa-secret" className="block text-sm font-mono tracking-wider break-all">{group(step.secret)}</code>
          </div>
        </div>
        {codeInput}
        {errorLine}
        <div className="flex gap-2">
          <Button onClick={confirm} disabled={busy || code.replace(/\s/g, "").length !== 6}>
            {busy ? "Checking…" : "Turn on two-factor sign-in"}
          </Button>
          <Button variant="ghost" onClick={() => { setStep({ kind: "idle" }); setError(""); }}>Cancel</Button>
        </div>
      </div>
    );
  }

  if (step.kind === "codes") {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          {step.context === "setup"
            ? "Two-factor sign-in is on. "
            : "Your old recovery codes no longer work. "}
          <strong>Save these recovery codes now</strong> — each works once if you lose your phone, and
          they will not be shown again.
        </p>
        <ul data-testid="recovery-codes" className="grid grid-cols-2 gap-2 font-mono text-sm bg-muted/40 rounded-lg p-4 max-w-sm">
          {step.codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void navigator.clipboard.writeText(step.codes.join("\n")); toast.success("Copied"); }}
          >
            <Copy className="w-3.5 h-3.5 mr-1" /> Copy
          </Button>
          <Button variant="outline" size="sm" onClick={() => download(step.codes)}>
            <Download className="w-3.5 h-3.5 mr-1" /> Download
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I have saved these codes somewhere safe
        </label>
        <Button
          disabled={!saved}
          onClick={() => {
            // A full navigation: the server re-checks the requirement on this request, now met.
            if (forced) window.location.assign("/dashboard");
            else setStep({ kind: "idle" });
          }}
        >
          {forced ? "Continue to Smartvie" : "Done"}
        </Button>
      </div>
    );
  }

  if (step.kind === "regenerate") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This replaces your recovery codes; the old ones stop working. Enter a current code from your authenticator app to continue.
        </p>
        {codeInput}
        {errorLine}
        <div className="flex gap-2">
          <Button onClick={regenerate} disabled={busy || code.replace(/\s/g, "").length !== 6}>
            {busy ? "Checking…" : "Make new recovery codes"}
          </Button>
          <Button variant="ghost" onClick={() => { setStep({ kind: "idle" }); setError(""); setCode(""); }}>Cancel</Button>
        </div>
      </div>
    );
  }

  return status.enabled ? (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
        <ShieldCheck className="w-4 h-4" /> Two-factor sign-in is on
        {status.enabledAt && (
          <span className="font-normal text-muted-foreground">
            since {new Date(status.enabledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        {status.recoveryCodesRemaining} of 10 recovery codes left.
        {status.recoveryCodesRemaining <= 3 && " Consider making new ones."}
      </p>
      <Button variant="outline" size="sm" onClick={() => { setCode(""); setError(""); setStep({ kind: "regenerate" }); }}>
        New recovery codes
      </Button>
      <p className="text-xs text-muted-foreground">
        Lost your phone? Ask an administrator to reset two-factor sign-in for you.
      </p>
    </div>
  ) : (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-700">
        <ShieldAlert className="w-4 h-4" /> Two-factor sign-in is off
      </p>
      <p className="text-sm text-muted-foreground">
        {forced
          ? "Two-factor sign-in is required for your role. Use any authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…)."
          : "Add a second step at sign-in — a code from an app on your phone — so a stolen password alone isn’t enough."}
      </p>
      {errorLine}
      <Button onClick={start} disabled={busy}>{busy ? "Starting…" : "Set up two-factor sign-in"}</Button>
    </div>
  );
}
