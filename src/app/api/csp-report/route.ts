import { NextResponse } from "next/server";
import { logWarn } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Reports are small; anything bigger is not one. */
const MAX_BYTES = 16 * 1024;

/**
 * Receives Content-Security-Policy violation reports (S5.1). The browser sends
 * these itself, with no session and no custom headers, so the route is open
 * (see OPEN in api-route-guards.test.ts) and the proxy exempts it from the CSRF
 * header check. It does nothing but write one redacted log line, so the worst
 * a stranger can do is add noise, and the API rate limit caps that.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return new NextResponse(null, { status: 413 });

  let text = "";
  try {
    text = (await request.text()).slice(0, MAX_BYTES);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  let report: unknown = null;
  try {
    report = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // Legacy `report-uri` wraps the report as { "csp-report": {...} }.
  const body = (report as { "csp-report"?: Record<string, unknown> })?.["csp-report"];
  if (!body || typeof body !== "object") return new NextResponse(null, { status: 204 });

  const pick = (k: string) => (typeof body[k] === "string" ? (body[k] as string).slice(0, 300) : undefined);
  logWarn("csp", "violation report", {
    directive: pick("effective-directive") ?? pick("violated-directive"),
    blocked: pick("blocked-uri"),
    document: pick("document-uri"),
    source: pick("source-file"),
    line: typeof body["line-number"] === "number" ? body["line-number"] : undefined,
    disposition: pick("disposition"),
  });
  return new NextResponse(null, { status: 204 });
}
