import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";
import { workflowVersions } from "./workflows.js";

export const workflowExecutions = pgTable("workflow_executions", {
  id: uuid("id").primaryKey().defaultRandom(),

  workflowVersionId: uuid("workflow_version_id")
    .references(() => workflowVersions.id, { onDelete: "cascade" })
    .notNull(),

  status: text("status").notNull(), // QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED

  startedAt: timestamp("started_at", { withTimezone: true }),

  finishedAt: timestamp("finished_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const nodeExecutions = pgTable("node_executions", {
  id: uuid("id").primaryKey().defaultRandom(),

  executionId: uuid("execution_id")
    .references(() => workflowExecutions.id, { onDelete: "cascade" })
    .notNull(),

  nodeId: text("node_id").notNull(),

  attempt: integer("attempt").notNull(),

  status: text("status").notNull(),
  // SCHEDULED, COMPLETED, FAILED, SKIPPED, CANCELLED

  output: jsonb("output"),

  error: jsonb("error"),

  startedAt: timestamp("started_at", { withTimezone: true }),

  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
