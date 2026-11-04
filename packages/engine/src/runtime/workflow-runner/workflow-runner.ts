import type {
  NodeExecutionResult,
  WorkflowExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";

import { validateWorkflow } from "../../validation/workflow.js";
import { DependencyScheduler } from "../scheduler/dependency-scheduler.js";
import type { ExecutorRegistry } from "../registry.js";
import type { WorkflowRunnerOptions } from "./types.js";

export class WorkflowRunner {
  constructor(private readonly registry: ExecutorRegistry) {}

  async execute(
    options: WorkflowRunnerOptions,
  ): Promise<WorkflowExecutionResult> {
    const startedAt = new Date().toISOString();

    validateWorkflow(options.workflow);

    const scheduler = new DependencyScheduler(options.workflow);

    const nodeResults: Record<string, NodeExecutionResult> = {};

    const nodes = new Map<string, WorkflowNode>(
      options.workflow.nodes.map((node) => [node.id, node]),
    );

    while (!scheduler.isComplete()) {
      const readyNodeIds = scheduler.getReadyNodes();

      if (readyNodeIds.length === 0) {
        break;
      }

      for (const nodeId of readyNodeIds) {
        const node = nodes.get(nodeId);

        if (!node) {
          throw new Error(`Workflow node "${nodeId}" was not found.`);
        }

        const nodeStartedAt = new Date().toISOString();

        try {
          const executor = this.registry.get(node.type);

          const result = await executor.execute(node, {
            executionId: options.executionId,
            workflowId: options.workflow.id,
            workflowVersion: options.workflowVersion,
            nodeId: node.id,
            attempt: 1,
            input: options.input ?? {},
            previousOutputs: {},
          });

          nodeResults[nodeId] = result;

          switch (result.status) {
            case "SUCCESS":
              scheduler.markCompleted(nodeId);
              break;

            case "FAILED":
              scheduler.markFailed(nodeId);
              break;

            case "SKIPPED":
              scheduler.markSkipped(nodeId);
              break;

            case "CANCELLED":
              scheduler.markSkipped(nodeId);
              break;
          }
        } catch (error) {
          const finishedAt = new Date().toISOString();

          const failure: NodeExecutionResult = {
            status: "FAILED",
            error: {
              code: "NODE_EXECUTION_ERROR",
              message:
                error instanceof Error
                  ? error.message
                  : "An unexpected node execution error occurred.",
              retryable: false,
            },
            startedAt: nodeStartedAt,
            finishedAt,
          };

          nodeResults[nodeId] = failure;
          scheduler.markFailed(nodeId);
        }
      }
    }

    // Record nodes skipped by dependency failure propagation.
    for (const node of options.workflow.nodes) {
      if (scheduler.getStatus(node.id) === "SKIPPED") {
        if (!nodeResults[node.id]) {
          const timestamp = new Date().toISOString();

          nodeResults[node.id] = {
            status: "SKIPPED",
            reason: "A dependency failed or was skipped.",
            startedAt: timestamp,
            finishedAt: timestamp,
          };
        }
      }
    }

    const hasFailures = Object.values(nodeResults).some(
      (result) => result.status === "FAILED" || result.status === "CANCELLED",
    );

    return {
      executionId: options.executionId,
      workflowId: options.workflow.id,
      workflowVersion: options.workflowVersion,
      status: hasFailures ? "FAILED" : "COMPLETED",
      nodeResults,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}
