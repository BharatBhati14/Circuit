import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),

  name: text("name").notNull(),

  description: text("description"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const workflowVersions = pgTable("workflow_versions", {
  id: uuid("id").primaryKey().defaultRandom(),

  workflowId: uuid("workflow_id")
    .references(() => workflows.id, { onDelete: "cascade" })
    .notNull(),

  version: integer("version").notNull(),

  definition: jsonb("definition").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
