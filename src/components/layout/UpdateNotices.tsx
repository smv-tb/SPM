"use client";

import { useEffect, useState } from "react";
import { RELEASES, releasesSince, type Release } from "@/lib/releases";
import { APP_VERSION, compareVersions } from "@/lib/version";

const SEEN_KEY = "pm_seen_version";
const POLL_MS = 5 * 60 * 1000;

/**
 * Two notices. "What's new" appears once per browser after the app has been
 * upgraded. "Refresh" appears on a page that was loaded before an upgrade and
 * is still open. A browser that has never opened the app is not shown history.
 */
export function UpdateNotices() {
  const [news, setNews] = useState<Release[]>([]);
  const [newer, setNewer] = useState<string | null>(null);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      if (seen === null) localStorage.setItem(SEEN_KEY, APP_VERSION);
      else setNews(releasesSince(seen, APP_VERSION, RELEASES));
    } catch {
      /* storage blocked: no what's-new, the refresh prompt still works */
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const res = await fetch("/api/version", { credentials: "include", cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        if (!stopped && version && compareVersions(version, APP_VERSION) > 0) setNewer(version);
      } catch {
        /* offline: try again later */
      }
    }
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(SEEN_KEY, APP_VERSION);
    } catch {
      /* hidden for this page only */
    }
    setNews([]);
  }

  return (
    <>
      {newer && (
        <div role="status" className="bg-primary/10 border-b border-primary text-sm px-6 py-2 flex flex-wrap items-center gap-3">
          <span>
            Version <strong>{newer}</strong> is available.
          </span>
          <button type="button" onClick={() => window.location.reload()} className="underline font-medium">
            Refresh to update
          </button>
        </div>
      )}
      {news.length > 0 && (
        <div role="status" className="bg-primary/10 border-b border-primary text-sm px-6 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium">What&apos;s new in version {APP_VERSION}</p>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {news.flatMap((r) => r.highlights.map((h) => <li key={`${r.version}:${h}`}>{h}</li>))}
              </ul>
            </div>
            <button type="button" onClick={dismiss} className="underline font-medium shrink-0">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
