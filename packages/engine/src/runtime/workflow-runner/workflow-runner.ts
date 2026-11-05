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

    const maxConcurrency = options.maxConcurrency ?? 5;

    if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new RangeError("maxConcurrency must be a positive safe integer.");
    }

    validateWorkflow(options.workflow);

    const scheduler = new DependencyScheduler(options.workflow);

    const nodeResults: Record<string, NodeExecutionResult> = {};
    const nodeOutputs = new Map<string, Record<string, unknown>>();

    const nodes = new Map<string, WorkflowNode>(
      options.workflow.nodes.map((node) => [node.id, node]),
    );

    while (!scheduler.isComplete()) {
      const readyNodeIds = scheduler.getReadyNodes(maxConcurrency);

      if (readyNodeIds.length === 0) {
        break;
      }

      const batchResults = await Promise.all(
        readyNodeIds.map(async (nodeId) => {
          const nodeStartedAt = new Date().toISOString();

          try {
            const node = nodes.get(nodeId);

            if (!node) {
              throw new Error(`Workflow node "${nodeId}" was not found.`);
            }

            const previousOutputs = Object.fromEntries(
              options.workflow.edges
                .filter((edge) => edge.target === nodeId)
                .map((edge) => {
                  const output = nodeOutputs.get(edge.source);

                  if (!output) {
                    throw new Error(
                      `Output for dependency "${edge.source}" is missing.`,
                    );
                  }

                  return [edge.source, output];
                }),
            );

            const executor = this.registry.get(node.type);

            const result = await executor.execute(node, {
              executionId: options.executionId,
              workflowId: options.workflow.id,
              workflowVersion: options.workflowVersion,
              nodeId: node.id,
              attempt: 1,
              input: options.input ?? {},
              previousOutputs,
            });

            return { nodeId, result };
          } catch (error) {
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
              finishedAt: new Date().toISOString(),
            };

            return { nodeId, result: failure };
          }
        }),
      );

      for (const { nodeId, result } of batchResults) {
        nodeResults[nodeId] = result;

        switch (result.status) {
          case "SUCCESS":
            scheduler.markCompleted(nodeId);
            nodeOutputs.set(nodeId, result.output);
            break;

          case "FAILED":
            scheduler.markFailed(nodeId);
            break;

          case "SKIPPED":
          case "CANCELLED":
            scheduler.markSkipped(nodeId);
            break;
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
