import z from "zod";
import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({
  path: resolve(process.cwd(), "../../.env"),
});

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid PostgreSQL connection string."),
});

const parsedEnv = envSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
});

if (!parsedEnv.success) {
  console.error(
    "❌ Invalid environment variables detected:",
    JSON.stringify(parsedEnv.error.format(), null, 2),
  );
  process.exit(1);
}

export const env = parsedEnv.data;
export type Environment = z.infer<typeof envSchema>;
