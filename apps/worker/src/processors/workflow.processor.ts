import { Job } from "bullmq";
import { updateWorkflowExecutionStatus, db } from "@circuit/db";
import { workflowVersions, nodeExecutions } from "@circuit/db/schema";
import { eq } from "drizzle-orm";
import { WorkflowRunner, registerExecutors } from "@circuit/engine";

// Initialize registry and runner once when the worker loads
const registry = registerExecutors();
const runner = new WorkflowRunner(registry);

interface WorkflowJobData {
  executionId: string;
  workflowVersionId: string;
  triggerInput?: Record<string, unknown>;
}

export async function processWorkflowExecution(job: Job<WorkflowJobData>) {
  const { executionId, workflowVersionId, triggerInput } = job.data;
  console.log(`⚙️ Processing execution job: ${executionId}`);

  try {
    // 1. Transition workflow execution status to RUNNING
    await updateWorkflowExecutionStatus(executionId, "RUNNING");

    // 2. Fetch workflow version and DAG definition from PostgreSQL
    const [version] = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, workflowVersionId));

    if (!version) {
      throw new Error(`Workflow version not found: ${workflowVersionId}`);
    }

    console.log(`🚀 Executing workflow DAG for version: ${workflowVersionId}`);

    // 3. Run the workflow via the core engine WorkflowRunner, passing trigger input if present
    const result = await runner.execute({
      executionId,
      workflowVersion: version.version,
      workflow: version.definition as any,
      maxConcurrency: 5,
      input: triggerInput || {},
    });

    // 4. Persist node execution results into the node_executions audit table
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

    // 5. Update final execution status based on engine result
    const terminalStatus =
      result.status === "QUEUED" ? "COMPLETED" : result.status;
    await updateWorkflowExecutionStatus(executionId, terminalStatus as any);

    console.log(
      `✅ Completed execution ${executionId} with status: ${terminalStatus}`,
    );
  } catch (error) {
    console.error(`❌ Failed execution ${executionId}:`, error);
    await updateWorkflowExecutionStatus(executionId, "FAILED");
    throw error;
  }
}
