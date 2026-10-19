import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { registerAllTools } from "./tools";
import type { ToolHandler } from "./errors";
import { HERMES_RATE_LIMIT } from "@/lib/rate-limit";

/** Conventions every tool follows — sent to the client at initialize. */
export const HERMES_INSTRUCTIONS = [
  "Smartvie PM tools. Conventions:",
  "- Projects: there can be several. Get ids from project_list (archived ones are hidden unless includeArchived). List tools take an optional projectId; without it they return every project's rows. The books (accounting tools) are company-wide, not per project.",
  "- Updates are true PATCHes: only fields present in the payload are written. Every *_update returns the record plus `changes` ({ field: { from, to } }); an empty `changes` means nothing changed.",
  "- Dates: write YYYY-MM-DD. Full ISO timestamps (as returned by reads) are also accepted; the date part is used. Reads return ISO timestamps (summary rows return YYYY-MM-DD).",
  "- Task owners: a task's owner is its Resource (resourceId) or a User assignment (taskAssignments with role OWNER). Read `owner` / `owners` on task rows; a null resourceId does not mean unassigned.",
  "- Living Lab costs: rows with a taskId mirror that task's money in every lab of the project. Only taskId-null rows are standalone lab spend.",
  "- Large reads: task_list, milestone_list, living_lab_list and living_lab_cost_list accept `summary: true` and `fields: [...]`.",
  "- Batches: task_bulk_update and living_lab_cost_bulk_delete are atomic and take up to 200 items per call; both support dryRun.",
  `- Rate limit: ${HERMES_RATE_LIMIT.max} HTTP requests per ${HERMES_RATE_LIMIT.windowMs / 1000}s per client IP, shared by all tool calls (a bulk call counts once). Over the limit, requests get HTTP 429 with JSON-RPC error -32029 and Retry-After set to the seconds left in the window.`,
  "- Validation errors come back as { error, details } in the tool result; -32602 means invalid params or a record that does not exist.",
  "- Bank reconciliation: use reconciliation_bank_accounts to list accounts, reconciliation_view for the full reconcile screen, reconciliation_create to match statement lines to book entries, reconciliation_with_invoices to record a receipt paying open invoices, reconciliation_create_and_reconcile to post a journal for uncategorised money, reconciliation_unreconcile to undo a match, and reconciliation_auto to apply safe suggestions automatically.",
].join("\n");

const toolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
registerAllTools(toolHandlers);

/**
 * Creates a fresh MCP Server bound to the shared (stateless) tool-handler
 * map. Each transport/session needs its own Server instance — the SDK
 * assumes a 1:1 server-to-transport relationship — but the tool handlers
 * themselves are stateless and safe to share across all of them.
 */
export function createHermesServer(): Server {
  const server = new Server(
    { name: "hermes-agent", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: HERMES_INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Array.from(toolHandlers.entries()).map(([name, handler]) => ({
        name,
        description: (handler as ToolHandler).description ?? "",
        inputSchema: (handler as ToolHandler).inputSchema ?? { type: "object", properties: {} },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolHandlers.get(name);
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    try {
      const result = await handler((args as Record<string, unknown>) ?? {});
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  return server;
}
