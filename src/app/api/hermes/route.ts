import { randomUUID } from "node:crypto";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createHermesServer } from "@/hermes/server";
import { withHermesAuth, extractBearerToken } from "@/hermes/auth";

export const dynamic = "force-dynamic";

interface HermesSession {
  server: Server;
  transport: WebStandardStreamableHTTPServerTransport;
  lastSeen: number;
}

const sessions = new Map<string, HermesSession>();

const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

function pruneIdleSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (now - session.lastSeen > SESSION_IDLE_TTL_MS) {
      sessions.delete(sessionId);
      void session.transport.close();
    }
  }
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" },
  });
}

function badRequest(message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}

async function handleMcpRequest(req: Request): Promise<Response> {
  const auth = withHermesAuth(extractBearerToken(req));
  if (!auth.ok) return unauthorized(auth.error);

  pruneIdleSessions();

  const sessionId = req.headers.get("mcp-session-id") ?? undefined;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    if (req.method !== "POST") {
      return badRequest("Bad Request: no valid session found for this request");
    }

    const server = createHermesServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        session!.lastSeen = Date.now();
        sessions.set(sid, session!);
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
      },
    });
    session = { server, transport, lastSeen: Date.now() };
    await server.connect(transport);
    return transport.handleRequest(req);
  }

  session.lastSeen = Date.now();
  return session.transport.handleRequest(req);
}

export async function POST(req: Request): Promise<Response> {
  return handleMcpRequest(req);
}

export async function GET(req: Request): Promise<Response> {
  return handleMcpRequest(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return handleMcpRequest(req);
}
