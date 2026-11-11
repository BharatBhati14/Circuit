import { eq } from "drizzle-orm";
import { db } from "./client.js";
import {
  workflows,
  workflowVersions,
  workflowExecutions,
  nodeExecutions,
} from "./schema/index.js";
import type { WorkflowDefinition } from "@circuit/contracts";

export async function createWorkflowWithVersion(
  name: string,
  description: string | undefined,
  definition: WorkflowDefinition,
) {
  return await db.transaction(async (tx) => {
    const [workflow] = await tx
      .insert(workflows)
      .values({ name, description })
      .returning();

    const [version] = await tx
      .insert(workflowVersions)
      .values({
        workflowId: workflow.id,
        version: 1,
        definition: definition as unknown as Record<string, unknown>,
      })
      .returning();

    return { workflow, version };
  });
}

export async function createWorkflowExecution(workflowVersionId: string) {
  const [execution] = await db
    .insert(workflowExecutions)
    .values({
      workflowVersionId,
      status: "QUEUED",
      startedAt: new Date(),
    })
    .returning();

  return execution;
}

export async function updateWorkflowExecutionStatus(
  executionId: string,
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED",
) {
  const [updated] = await db
    .update(workflowExecutions)
    .set({
      status,
      finishedAt: ["COMPLETED", "FAILED", "CANCELLED"].includes(status)
        ? new Date()
        : undefined,
    })
    .where(eq(workflowExecutions.id, executionId))
    .returning();

  return updated;
}
