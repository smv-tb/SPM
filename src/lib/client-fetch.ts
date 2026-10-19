"use client";

import { safePath } from "@/lib/log";

/**
 * Asks the person to confirm with their authenticator, resolving true once they
 * have (and false if they cancel). Registered by <StepUpDialog /> in the app
 * layout; absent in tests and outside the app, where it simply isn't offered.
 */
type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

export function registerStepUpHandler(handler: StepUpHandler): () => void {
  stepUpHandler = handler;
  return () => {
    if (stepUpHandler === handler) stepUpHandler = null;
  };
}

export const STEP_UP_REQUIRED_CODE = "step_up_required";

async function send(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = init?.method || "GET";
  const headers = new Headers(init?.headers);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers.set("X-Requested-By", "smartvie-pm");
  }

  return fetch(input, {
    credentials: "include",
    ...init,
    headers,
  });
}

function logFailure(res: Response): Response {
  if (!res.ok) console.error(`[clientFetch] ${res.status} ${safePath(res.url)}`);
  return res;
}

export async function clientFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await send(input, init);

  // A dangerous action the server wants a fresh second-factor check for: ask,
  // then repeat the request once. Every caller gets this without knowing about it.
  if (res.status === 403 && stepUpHandler) {
    const body = await res.clone().json().catch(() => null);
    if (body?.code === STEP_UP_REQUIRED_CODE && (await stepUpHandler())) {
      return logFailure(await send(input, init));
    }
  }

  // Only the final outcome is logged: the first 403 of a step-up is a normal step, not an error.
  return logFailure(res);
}
