/**
 * Creates the first administrator. There is no sign-up page, so a fresh
 * installation needs this once.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long passphrase' yarn tsx scripts/seed-admin.ts
 *   (optional: ADMIN_NAME="Your Name")
 *
 * The credentials come from the environment and are never printed or stored in
 * the repository. The password must meet the same policy as everywhere else
 * (src/lib/password-policy.ts), and is marked temporary: you are asked to
 * replace it at first sign-in. Does nothing if an administrator already exists.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { passwordIssues } from "@/lib/password-policy";
import { recordUserCreated } from "@/lib/user-audit";
import { BCRYPT_ROUNDS } from "@/lib/constants";

// Precedence: variables already in the environment win, then .env.local, then .env.
// (dotenv never overrides what is set, so the order of these calls is the order of priority.)
// A script that creates administrators must not silently ignore the database it was told to use.
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Admin";
  if (!email || !password) {
    fail("Set ADMIN_EMAIL and ADMIN_PASSWORD (and optionally ADMIN_NAME) — see the header of this script.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("ADMIN_EMAIL is not a valid email address.");
  const issues = passwordIssues(password, { email, name });
  if (issues.length > 0) fail(`ADMIN_PASSWORD is not acceptable: ${issues[0]}`);

  try {
    const target = new URL(process.env.DATABASE_URL ?? "");
    console.log(`Database: ${target.hostname}${target.port ? `:${target.port}` : ""}${target.pathname}`);
  } catch {
    fail("DATABASE_URL is not set or not a valid URL.");
  }

  const existing = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (existing) {
    console.log("An administrator already exists:", existing.email);
    return;
  }

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const admin = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name, email, password: hashed, role: "ADMIN", isActive: true, mustChangePassword: true },
      select: { id: true, email: true, name: true, role: true, isActive: true, mustChangePassword: true },
    });
    await recordUserCreated(tx, { actor: { type: "SYSTEM", label: "seed-admin" } }, created.id, created);
    return created;
  });

  console.log("Created administrator:", admin.email);
  console.log("Sign in with the password you supplied; you will be asked to replace it straight away.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
