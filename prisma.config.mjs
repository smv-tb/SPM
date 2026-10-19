import { defineConfig } from "prisma/config";
let url = process.env.DATABASE_URL;
if (!url) {
  try {
    const { config } = await import("dotenv");
    config({ path: ".env" });
    config({ path: ".env.local", override: true });
    url = process.env.DATABASE_URL;
  } catch {
    // dotenv not installed or files missing; DATABASE_URL must be set in the environment
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url,
  },
});
