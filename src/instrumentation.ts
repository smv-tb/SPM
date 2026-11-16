/**
 * Runs once when the Next server starts. Refuses to start in production
 * without server-wrapper.mjs in front (see src/lib/client-ip.ts, pentest F-10).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { wrapperStartupProblem, WRAPPER_TOKEN_ENV } = await import("@/lib/client-ip");
  const { logError, logWarn } = await import("@/lib/log");
  const problem = wrapperStartupProblem({ token: process.env[WRAPPER_TOKEN_ENV], nodeEnv: process.env.NODE_ENV });
  if (!problem) return;
  if (problem.level === "warn") {
    logWarn("client-ip", problem.message);
    return;
  }
  logError("client-ip", problem.message);
  process.exit(1);
}
