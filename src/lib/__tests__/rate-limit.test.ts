import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit, then refuses with the time actually left", () => {
    const rl = createRateLimiter(3, 60_000);
    const t0 = 1_000_000;
    expect(rl.check("ip", t0).remaining).toBe(2);
    rl.check("ip", t0 + 1);
    expect(rl.check("ip", t0 + 2).limited).toBe(false);
    const refused = rl.check("ip", t0 + 45_000);
    expect(refused.limited).toBe(true);
    expect(refused.retryAfterSeconds).toBe(15);
  });

  it("opens a fresh window after reset and keeps keys apart", () => {
    const rl = createRateLimiter(1, 1_000);
    expect(rl.check("a", 0).limited).toBe(false);
    expect(rl.check("a", 10).limited).toBe(true);
    expect(rl.check("b", 10).limited).toBe(false);
    expect(rl.check("a", 1_000).limited).toBe(false);
  });
});
