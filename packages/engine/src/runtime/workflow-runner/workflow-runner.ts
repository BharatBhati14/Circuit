import type {
  ExecutionStatus,
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

    // Setup internal AbortController tied to optional external signal
    const internalController = new AbortController();

    if (options.signal) {
      if (options.signal.aborted) {
        internalController.abort(options.signal.reason);
      } else {
        options.signal.addEventListener(
          "abort",
          () => {
            internalController.abort(options.signal?.reason);
          },
          { once: true },
        );
      }
    }

    let workflowCancelled = false;

    while (!scheduler.isComplete()) {
      if (internalController.signal.aborted) {
        scheduler.cancelPendingNodes();
        workflowCancelled = true;
        break;
      }

      const readyNodeIds = scheduler.getReadyNodes(maxConcurrency);

      if (readyNodeIds.length === 0) {
        // If no ready nodes are returned and scheduler isn't complete, check if we're aborted or deadlocked
        if (internalController.signal.aborted) {
          scheduler.cancelPendingNodes();
          workflowCancelled = true;
        }
        break;
      }

      const batchResults = await Promise.all(
        readyNodeIds.map(async (nodeId) => {
          const nodeStartedAt = new Date().toISOString();

          try {
            // Check abort signal before running individual node
            if (internalController.signal.aborted) {
              return {
                nodeId,
                result: {
                  status: "CANCELLED" as const,
                  reason: "Workflow execution was cancelled.",
                  startedAt: nodeStartedAt,
                  finishedAt: new Date().toISOString(),
                },
              };
            }

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

            let nodeInput = options.input ?? {};
            const incomingEdges = options.workflow.edges.filter(
              (e) => e.target === nodeId,
            );

            if (incomingEdges.length > 0) {
              // For nodes with dependencies, combine or take upstream outputs as input
              // If single dependency, pass that dependency's output directly so $.body works!
              const firstDependencyOutput = nodeOutputs.get(
                incomingEdges[0].source,
              );
              if (firstDependencyOutput) {
                nodeInput = firstDependencyOutput;
              }
            }

            const result = await executor.execute(node, {
              executionId: options.executionId,
              workflowId: options.workflow.id,
              workflowVersion: options.workflowVersion,
              nodeId: node.id,
              attempt: 1,
              input: nodeInput,
              previousOutputs,
              signal: internalController.signal, // Pass signal to executor
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
            scheduler.markSkipped(nodeId);
            break;

          case "CANCELLED":
            scheduler.markCancelled(nodeId);
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
      } else if (scheduler.getStatus(node.id) === "CANCELLED") {
        if (!nodeResults[node.id]) {
          const timestamp = new Date().toISOString();

          nodeResults[node.id] = {
            status: "CANCELLED",
            reason: "Execution was cancelled.",
            startedAt: timestamp,
            finishedAt: timestamp,
          };
        }
      }
    }

    const hasFailures = Object.values(nodeResults).some(
      (result) => result.status === "FAILED",
    );
    const hasCancellations =
      workflowCancelled ||
      Object.values(nodeResults).some(
        (result) => result.status === "CANCELLED",
      );

    let finalStatus: ExecutionStatus = "COMPLETED";
    if (hasCancellations) {
      finalStatus = "CANCELLED";
    } else if (hasFailures) {
      finalStatus = "FAILED";
    }

    return {
      executionId: options.executionId,
      workflowId: options.workflow.id,
      workflowVersion: options.workflowVersion,
      status: finalStatus,
      nodeResults,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}
