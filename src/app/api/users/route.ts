export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireAdmin, apiError, apiSuccess, withErrorHandler } from "@/lib/api-errors";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, BCRYPT_ROUNDS } from "@/lib/constants";
import { userCreateSchema } from "@/schemas/user";
import { UserRole } from "@prisma/client";
import { stepUpGuard } from "@/lib/mfa/step-up";
import { firstPasswordMessage } from "@/schemas/user";
import { actorFromSession, requestIp } from "@/lib/audit";
import { recordUserCreated } from "@/lib/user-audit";
import { alertInBackground, becameAdmin } from "@/lib/security-alerts";
import bcrypt from "bcryptjs";

export const GET = withErrorHandler(async (req: NextRequest) => {
  // Allow ADMIN (full access) and CONTRIBUTOR+ (listing only)
  const session = await auth();
  if (!hasPermission(session, "users:list")) {
    return apiError("Forbidden", 403);
  }

  const url = req.nextUrl;
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || String(DEFAULT_PAGE_LIMIT), 10), MAX_PAGE_LIMIT);
  const role = url.searchParams.get("role") as UserRole | null;
  const search = url.searchParams.get("search")?.trim();

  const where: Record<string, unknown> = {};
  if (role) where.role = role;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatarUrl: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      totpEnabledAt: true,
    },
    orderBy: { name: "asc" },
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
  });

  const isAdmin = hasPermission(session, "users:manage");
  const hasMore = users.length > limit;
  // Who has a second factor is for administrators; everyone else gets the plain list.
  const data = (hasMore ? users.slice(0, -1) : users).map(({ totpEnabledAt, ...u }) =>
    isAdmin ? { ...u, mfaEnabled: totpEnabledAt !== null } : u
  );
  const nextCursor = hasMore ? data[data.length - 1]?.id : null;

  return apiSuccess({ data, nextCursor });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const authResult = await requireAdmin();
  if (!authResult.success) return authResult.response;
  // Creating an account is handing out access.
  const refusal = await stepUpGuard(authResult.session);
  if (refusal) return refusal;

  const body = await req.json();
  const validation = userCreateSchema.safeParse(body);
  if (!validation.success) {
    return apiError(firstPasswordMessage(validation.error) ?? "Invalid request data", 400, validation.error.flatten());
  }

  const { name, email, password, role } = validation.data;
  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          // The admin chose it, so the person must replace it before using anything.
          mustChangePassword: true,
          role,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatarUrl: true,
          isActive: true,
          mustChangePassword: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await recordUserCreated(tx, { actor: actorFromSession(authResult.session), ipAddress: requestIp(req) }, created.id, created);
      return created;
    });
    if (becameAdmin(null, user.role)) {
      alertInBackground({
        event: "user.admin_granted",
        summary: `${user.email} was created as an administrator`,
        actor: (authResult.session.user as { email?: string }).email ?? null,
        target: user.email,
        ipAddress: requestIp(req),
      });
    }
    return apiSuccess(user, 201);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return apiError("Email already in use", 409);
    }
    throw error;
  }
});
