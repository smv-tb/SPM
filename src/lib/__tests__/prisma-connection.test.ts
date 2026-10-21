import { describe, it, expect, vi } from "vitest";

// Regression: PrismaPg must be given a config object. Given a pg.Pool it saw no
// connection string and every query went to localhost:5432 (production outage).
describe("prisma client connection", () => {
  it("connects to the host in DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/db");
    vi.resetModules();
    const { prisma } = await import("../prisma");
    const err = await prisma.$queryRaw`SELECT 1`.then(
      () => null,
      (e: Error) => e,
    );
    await prisma.$disconnect();
    expect(err).not.toBeNull();
    expect(err!.message).toContain("127.0.0.1:1");
    expect(err!.message).not.toContain("5432");
    vi.unstubAllEnvs();
  });
});
