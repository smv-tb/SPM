import bcrypt from "bcryptjs";
import { changeEndsSessions, newSecurityStamp } from "@/lib/session-validity";
import { passwordIssues } from "@/lib/password-policy";
import { HERMES_ACTOR } from "@/lib/audit";
import { recordUserChanged, recordUserCreated, recordUserDeleted } from "@/lib/user-audit";
import { alertInBackground, becameAdmin } from "@/lib/security-alerts";
import { prisma } from "@/lib/prisma";
import { userCreateSchema, userUpdateSchema } from "@/schemas/user";
import { BCRYPT_ROUNDS } from "@/lib/constants";
import { tryCatchTool, createToolResponse, defineTool } from "../errors";
import { parsePagination, paginateResponse, diffFields } from "./_shared";

const userSelect = { id: true, email: true, name: true, role: true, avatarUrl: true, isActive: true, createdAt: true, updatedAt: true } as const;

export function registerUserTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  handlers.set("user_list", defineTool(
    "List users with cursor-based pagination, role filter, and search",
    {
      type: "object",
      properties: {
        cursor: { type: "string" }, limit: { type: "number" },
        role: { type: "string" }, search: { type: "string" },
      },
    },
    async (args) => {
      return tryCatchTool(async () => {
        const { take, cursor, skip } = parsePagination(args);
        const where: Record<string, unknown> = {};
        if (args.role) where.role = String(args.role);
        if (args.search) {
          const q = String(args.search);
          where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ];
        }
        const users = await prisma.user.findMany({ where, select: userSelect, orderBy: { name: "asc" }, take, cursor, skip });
        return createToolResponse(paginateResponse(users, take - 1));
      });
    }
  ));

  handlers.set("user_get", defineTool(
    "Get a single user by ID",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const user = await prisma.user.findUnique({ where: { id: String(id) }, select: userSelect });
        if (!user) return createToolResponse({ error: "User not found" });
        return createToolResponse(user);
      });
    }
  ));

  handlers.set("user_create", defineTool(
    "Create a new user with hashed password",
    {
      type: "object",
      properties: {
        name: { type: "string" }, email: { type: "string" },
        password: { type: "string" }, role: { type: "string" },
      },
      required: ["name", "email", "password"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const validation = userCreateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const { name, email, password, role } = validation.data;
        const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: { name, email, password: hashed, mustChangePassword: true, role },
            select: { id: true, email: true, name: true, role: true, isActive: true, mustChangePassword: true, createdAt: true },
          });
          await recordUserCreated(tx, { actor: HERMES_ACTOR }, created.id, created);
          return created;
        });
        if (becameAdmin(null, user.role)) {
          alertInBackground({
            event: "user.admin_granted",
            summary: `${user.email} was created as an administrator by the Hermes agent`,
            actor: "HERMES",
            target: user.email,
          });
        }
        return createToolResponse(user);
      });
    }
  ));

  handlers.set("user_update", defineTool(
    "Update a user. Guards against last-admin modification.",
    {
      type: "object",
      properties: {
        id: { type: "string" }, name: { type: "string" }, email: { type: "string" },
        role: { type: "string" }, isActive: { type: "boolean" }, password: { type: "string" },
      },
      required: ["id"],
    },
    async (args) => {
      return tryCatchTool(async () => {
        const id = String(args.id);
        const validation = userUpdateSchema.safeParse(args);
        if (!validation.success) return createToolResponse({ error: "Validation failed", details: validation.error.flatten() });
        const existing = await prisma.user.findUnique({ where: { id } });
        if (!existing) return createToolResponse({ error: "User not found" });
        const { name, email, role, isActive, password } = validation.data;
        if (password) {
          const issues = passwordIssues(password, { email: email ?? existing.email, name: name ?? existing.name });
          if (issues.length > 0) return createToolResponse({ error: issues[0], details: { password: issues } });
        }
        if (role && role !== existing.role && existing.role === "ADMIN") {
          const count = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
          if (count <= 1) return createToolResponse({ error: "Cannot demote the last active admin" });
        }
        if (isActive === false && existing.role === "ADMIN") {
          const count = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
          if (count <= 1) return createToolResponse({ error: "Cannot deactivate the last active admin" });
        }
        const data: Record<string, unknown> = {};
        if (name !== undefined) data.name = name;
        if (email !== undefined) data.email = email;
        if (role !== undefined) data.role = role;
        if (isActive !== undefined) data.isActive = isActive;
        if (password && password.length > 0) {
          data.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
          data.mustChangePassword = true; // the agent chose it, not the user
        }
        if (changeEndsSessions(existing, { role, isActive, password })) data.securityStamp = newSecurityStamp();
        const updated = await prisma.$transaction(async (tx) => {
          const result = await tx.user.update({ where: { id }, data, select: { ...userSelect, mustChangePassword: true } });
          await recordUserChanged(tx, { actor: HERMES_ACTOR }, id, existing, result, { passwordReset: Boolean(data.password) });
          return result;
        });
        if (becameAdmin(existing.role, updated.role)) {
          alertInBackground({
            event: "user.admin_granted",
            summary: `${updated.email} was made an administrator by the Hermes agent`,
            actor: "HERMES",
            target: updated.email,
          });
        }
        const changes = diffFields(existing, updated);
        if (data.password) changes.password = { from: "[redacted]", to: "[changed]" };
        return createToolResponse({ ...updated, changes });
      });
    }
  ));

  handlers.set("user_delete", defineTool(
    "Delete a user. Guards against deleting the last admin.",
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async ({ id }) => {
      return tryCatchTool(async () => {
        const uid = String(id);
        const user = await prisma.user.findUnique({
          where: { id: uid },
          select: { email: true, name: true, role: true, isActive: true, mustChangePassword: true },
        });
        if (!user) return createToolResponse({ error: "User not found" });
        if (user.role === "ADMIN") {
          const count = await prisma.user.count({ where: { role: "ADMIN" } });
          if (count <= 1) return createToolResponse({ error: "Cannot delete the last admin" });
        }
        await prisma.$transaction(async (tx) => {
          await tx.user.delete({ where: { id: uid } });
          await recordUserDeleted(tx, { actor: HERMES_ACTOR }, uid, user);
        });
        return createToolResponse({ ok: true });
      });
    }
  ));
}
