import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { isProjectArchivedError, PROJECT_ARCHIVED_MESSAGE } from "@/lib/project-scope";

export function prismaErrorToMcp(error: unknown): McpError {
  if (isProjectArchivedError(error)) return new McpError(ErrorCode.InvalidParams, PROJECT_ARCHIVED_MESSAGE);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002": {
        const target = error.meta?.target as string[] | undefined;
        const targetStr = Array.isArray(target) ? target.join(", ") : "";
        return new McpError(
          ErrorCode.InvalidParams,
          `Conflict: a record with this value already exists${targetStr ? ` (${targetStr})` : ""}`
        );
      }
      case "P2025":
        return new McpError(ErrorCode.InvalidParams, "Record not found");
      case "P2014":
      case "P2003":
        return new McpError(ErrorCode.InvalidParams, "Referenced record does not exist");
      case "P2016":
        return new McpError(ErrorCode.InternalError, "Invalid query");
      default:
        return new McpError(ErrorCode.InternalError, "Database error");
    }
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return new McpError(ErrorCode.InvalidParams, "Invalid data provided");
  }
  return new McpError(ErrorCode.InternalError, "Internal server error");
}

export function zodErrorToMcp(error: ZodError): McpError {
  const details = error.flatten();
  const fieldErrors = details.fieldErrors as Record<string, string[] | undefined>;
  const entries = Object.entries(fieldErrors);
  const msg = entries.length > 0
    ? entries.map(([k, v]) => `${k}: ${(v ?? []).join(", ")}`).join("; ")
    : "invalid input";
  return new McpError(ErrorCode.InvalidParams, `Validation error: ${msg}`);
}

export async function tryCatchTool<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZodError) throw zodErrorToMcp(error);
    if (error instanceof McpError) throw error;
    throw prismaErrorToMcp(error);
  }
}

export function createToolResponse(data: unknown) {
  return data;
}

export type ToolHandler = ((args: Record<string, unknown>) => Promise<unknown>) & {
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export function defineTool(
  description: string,
  inputSchema: Record<string, unknown>,
  handler: (args: Record<string, unknown>) => Promise<unknown>
): ToolHandler {
  const fn = handler as ToolHandler;
  fn.description = description;
  fn.inputSchema = inputSchema;
  return fn;
}
