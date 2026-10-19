import { describe, it, expect } from "vitest";
import { stepUpFresh, STEP_UP_WINDOW_MS } from "@/lib/mfa/step-up";

const NOW = 1_800_000_000_000;
const at = (msAgo: number) => new Date(NOW - msAgo);

describe("stepUpFresh", () => {
  it("counts a check made just now", () => {
    expect(stepUpFresh(at(0), NOW)).toBe(true);
  });

  it("counts one inside the window, including its last moment", () => {
    expect(stepUpFresh(at(STEP_UP_WINDOW_MS - 1), NOW)).toBe(true);
    expect(stepUpFresh(at(STEP_UP_WINDOW_MS), NOW)).toBe(true);
  });

  it("does not count one older than the window", () => {
    expect(stepUpFresh(at(STEP_UP_WINDOW_MS + 1), NOW)).toBe(false);
  });

  it("does not count a session that never checked", () => {
    expect(stepUpFresh(null, NOW)).toBe(false);
    expect(stepUpFresh(undefined, NOW)).toBe(false);
  });

  it("does not count a timestamp from the future (clock tampering or a bug)", () => {
    expect(stepUpFresh(new Date(NOW + 1000), NOW)).toBe(false);
  });

  it("keeps the window short: minutes, not hours", () => {
    expect(STEP_UP_WINDOW_MS).toBeLessThanOrEqual(10 * 60 * 1000);
  });
});
