"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Leaf } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Two steps: the password, then (only for accounts with two-factor on) a code.
  // The password stays in memory so all three can be sent together, which is
  // what lets the server check the password and the code in a single request.
  const [step, setStep] = useState<"password" | "code">("password");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        ...(step === "code" ? { code } : {}),
        redirect: false,
      });

      setLoading(false);
      if (!result?.error) {
        router.push("/dashboard");
        return;
      }
      switch (result.code) {
        case "mfa_required":
          setStep("code");
          setCode("");
          break;
        case "mfa_invalid":
          setError("That code isn't right. Wait for the next one, or use a recovery code.");
          setCode("");
          break;
        case "too_many_attempts":
          setError("Too many attempts. Please wait a while and try again.");
          break;
        default:
          // A wrong password after the first step means starting again.
          setError("Invalid email or password.");
          setStep("password");
          setCode("");
      }
    } catch {
      setLoading(false);
      setError("Network error — please try again.");
    }
  }

  function backToPassword() {
    setStep("password");
    setCode("");
    setPassword("");
    setError("");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
            <Leaf className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-white text-2xl font-bold leading-none">Smartvie</p>
            <p className="text-sidebar-foreground text-xs mt-0.5">Project Management</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card rounded-md border border-border p-8">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            {step === "code" ? "Two-factor check" : "Sign in"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {step === "code"
              ? "Enter the 6-digit code from your authenticator app, or one of your recovery codes."
              : "Enter your credentials to continue"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {step === "password" ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1" htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full h-10 px-3 rounded-md border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1" htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full h-10 px-3 rounded-md border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="••••••••"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1" htmlFor="code">Authentication code</label>
                <input
                  id="code"
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  maxLength={24}
                  className="w-full h-10 px-3 rounded-md border border-input text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="123456"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {loading ? "Signing in…" : step === "code" ? "Verify" : "Sign in"}
            </button>
            {step === "code" && (
              <button
                type="button"
                onClick={backToPassword}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
