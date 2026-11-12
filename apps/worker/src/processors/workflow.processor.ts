import { Job } from "bullmq";
import { updateWorkflowExecutionStatus, db } from "@circuit/db";
import {
  workflowVersions,
  nodeExecutions,
  workflowExecutions,
} from "@circuit/db/schema";
import { eq } from "drizzle-orm";
import { WorkflowRunner, registerExecutors } from "@circuit/engine";

// Initialize registry and runner once when the worker loads
const registry = registerExecutors();
const runner = new WorkflowRunner(registry);

interface WorkflowJobData {
  executionId?: string; // Optional now, since cron jobs are initialized inside the worker
  workflowVersionId: string;
  triggerType?: "manual" | "webhook" | "cron";
  triggerInput?: Record<string, unknown>;
}

export async function processWorkflowExecution(job: Job<WorkflowJobData>) {
  let {
    executionId,
    workflowVersionId,
    triggerType = "manual",
    triggerInput,
  } = job.data;

  console.log(
    `⚙️ Processing execution job for version: ${workflowVersionId} (Trigger: ${triggerType})`,
  );

  try {
    // 1. If no executionId was pre-created (e.g. Cron trigger), create it now in PostgreSQL
    if (!executionId) {
      const [newExecution] = await db
        .insert(workflowExecutions)
        .values({
          workflowVersionId,
          status: "PENDING",
        })
        .returning();

      executionId = newExecution.id;
      console.log(
        `📝 Initialized dynamic database execution record: ${executionId}`,
      );
    }

    // 2. Transition workflow execution status to RUNNING
    await updateWorkflowExecutionStatus(executionId, "RUNNING");

    // 3. Fetch workflow version and DAG definition from PostgreSQL
    const [version] = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, workflowVersionId));

    if (!version) {
      throw new Error(`Workflow version not found: ${workflowVersionId}`);
    }

    console.log(`🚀 Executing workflow DAG for version: ${workflowVersionId}`);

    // 4. Run the workflow via the core engine WorkflowRunner, passing trigger input if present
    const result = await runner.execute({
      executionId,
      workflowVersion: version.version,
      workflow: version.definition as any,
      maxConcurrency: 5,
      input: triggerInput || {},
    });

    // 5. Persist node execution results into the node_executions audit table
    for (const [nodeId, nodeResult] of Object.entries(result.nodeResults)) {
      await db.insert(nodeExecutions).values({
        executionId,
        nodeId,
        status: nodeResult.status,
        attempt: "attempt" in nodeResult ? (nodeResult.attempt as number) : 1,
        output: "output" in nodeResult ? nodeResult.output : null,
        error: "error" in nodeResult ? nodeResult.error : null,
        startedAt: new Date(nodeResult.startedAt),
        finishedAt: new Date(nodeResult.finishedAt),
      });
    }

    // 6. Update final execution status based on engine result
    const terminalStatus =
      result.status === "QUEUED" ? "COMPLETED" : result.status;
    await updateWorkflowExecutionStatus(executionId, terminalStatus as any);

    console.log(
      `✅ Completed execution ${executionId} with status: ${terminalStatus}`,
    );
  } catch (error) {
    if (executionId) {
      console.error(`❌ Failed execution ${executionId}:`, error);
      await updateWorkflowExecutionStatus(executionId, "FAILED");
    } else {
      console.error(`❌ Failed execution before record creation:`, error);
    }
    throw error;
  }
}
