import { defineConfig } from "drizzle-kit";
import { env } from "@circuit/config";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: env?.DATABASE_URL!,
  },
});
