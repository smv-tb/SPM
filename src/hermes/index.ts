import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHermesServer } from "./server";

const server = createHermesServer();
const transport = new StdioServerTransport();
await server.connect(transport);
