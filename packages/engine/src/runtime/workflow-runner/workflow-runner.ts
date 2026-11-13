import type {
  ExecutionStatus,
  NodeExecutionResult,
  WorkflowExecutionResult,
  WorkflowNode,
  NodeExecutionContext,
} from "@circuit/contracts";

import { validateWorkflow } from "../../validation/workflow.js";
import { DependencyScheduler } from "../scheduler/dependency-scheduler.js";
import type { ExecutorRegistry } from "../registry.js";
import type { WorkflowRunnerOptions } from "./types.js";

type WorkflowEdge = {
  source: string;
  target: string;
  sourceHandle?: string;
  handle?: string;
};

type LoopItemContext = {
  item: unknown;
  index: number;
};

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

    const edges = options.workflow.edges as WorkflowEdge[];

    // Identify nodes directly connected to loop nodes.
    // These nodes are executed exclusively by executeLoopBody().
    const loopBodyNodeIds = new Set<string>();

    for (const edge of edges) {
      const sourceNode = nodes.get(edge.source);

      if (sourceNode?.type === "loop") {
        loopBodyNodeIds.add(edge.target);
      }
    }

    const internalController = new AbortController();

    if (options.signal) {
      if (options.signal.aborted) {
        internalController.abort(options.signal.reason);
      } else {
        options.signal.addEventListener(
          "abort",
          () => internalController.abort(options.signal?.reason),
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

      const readyNodeIds = scheduler
        .getReadyNodes(maxConcurrency)
        .filter((nodeId) => !loopBodyNodeIds.has(nodeId));

      if (readyNodeIds.length === 0) {
        if (internalController.signal.aborted) {
          scheduler.cancelPendingNodes();
          workflowCancelled = true;
        }

        // Loop body nodes are handled by their parent loop.
        // If only loop body nodes remain, mark them as completed
        // because their actual executions have already been handled.
        for (const nodeId of loopBodyNodeIds) {
          if (scheduler.getStatus(nodeId) === "SCHEDULED") {
            scheduler.markCompleted(nodeId);
          }
        }

        if (scheduler.isComplete()) {
          break;
        }

        const remainingReady = scheduler.getReadyNodes(maxConcurrency);

        if (remainingReady.length === 0) {
          break;
        }

        continue;
      }

      const batchResults = await Promise.all(
        readyNodeIds.map(async (nodeId) => {
          const nodeStartedAt = new Date().toISOString();

          try {
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

            const incomingEdges = edges.filter(
              (edge) => edge.target === nodeId,
            );

            const previousOutputs = Object.fromEntries(
              incomingEdges.map((edge) => {
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

            let nodeInput: Record<string, unknown> = options.input ?? {};

            if (incomingEdges.length > 0) {
              const firstEdge = incomingEdges[0];
              const dependencyOutput = nodeOutputs.get(firstEdge.source);

              if (dependencyOutput) {
                nodeInput = dependencyOutput;
              }
            }

            const context: NodeExecutionContext = {
              executionId: options.executionId,
              workflowId: options.workflow.id,
              workflowVersion: options.workflowVersion,
              nodeId: node.id,
              attempt: 1,
              input: nodeInput,
              previousOutputs,
              signal: internalController.signal,
            };

            const result = await executor.execute(node, context);

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
          case "SUCCESS": {
            scheduler.markCompleted(nodeId);
            nodeOutputs.set(nodeId, result.output);

            const completedNode = nodes.get(nodeId);

            // Conditional branching.
            if (
              completedNode?.type === "condition" &&
              typeof result.output.matched === "boolean"
            ) {
              const matched = result.output.matched;

              const outgoingEdges = edges.filter(
                (edge) => edge.source === nodeId,
              );

              for (const edge of outgoingEdges) {
                const edgeHandle = edge.sourceHandle ?? edge.handle;

                if (edgeHandle != null) {
                  const shouldTakeBranch =
                    String(edgeHandle) === String(matched);

                  if (!shouldTakeBranch) {
                    this.skipNodeAndDownstream(
                      edge.target,
                      edges,
                      scheduler,
                      nodeResults,
                      nodeOutputs,
                    );
                  }
                }
              }
            }

            // Execute loop body once per item.
            if (
              completedNode?.type === "loop" &&
              Array.isArray(result.output.items)
            ) {
              const items = result.output.items as unknown[];

              const configuredBatchSize =
                (completedNode.config as { batchSize?: number })?.batchSize ??
                1;

              if (
                !Number.isSafeInteger(configuredBatchSize) ||
                configuredBatchSize < 1
              ) {
                throw new Error(
                  `Invalid batchSize configured for loop "${nodeId}".`,
                );
              }

              await this.executeLoopBody(
                nodeId,
                items,
                configuredBatchSize,
                options,
                nodes,
                edges,
                nodeOutputs,
                internalController.signal,
                maxConcurrency,
              );
            }

            break;
          }

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

    // Record automatically skipped and cancelled nodes.
    for (const node of options.workflow.nodes) {
      const status = scheduler.getStatus(node.id);

      if (status === "SKIPPED" && !nodeResults[node.id]) {
        const timestamp = new Date().toISOString();

        nodeResults[node.id] = {
          status: "SKIPPED",
          reason: "A dependency failed or was skipped.",
          startedAt: timestamp,
          finishedAt: timestamp,
        };
      }

      if (status === "CANCELLED" && !nodeResults[node.id]) {
        const timestamp = new Date().toISOString();

        nodeResults[node.id] = {
          status: "CANCELLED",
          reason: "Execution was cancelled.",
          startedAt: timestamp,
          finishedAt: timestamp,
        };
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

  /**
   * Executes direct loop-body nodes once for every item.
   *
   * Each iteration receives its own $item and $index context.
   * Batch size controls how many items are processed in a batch.
   */
  private async executeLoopBody(
    loopNodeId: string,
    items: unknown[],
    batchSize: number,
    options: WorkflowRunnerOptions,
    nodes: Map<string, WorkflowNode>,
    edges: WorkflowEdge[],
    nodeOutputs: Map<string, Record<string, unknown>>,
    signal: AbortSignal,
    maxConcurrency: number,
  ): Promise<void> {
    const outgoingEdges = edges.filter((edge) => edge.source === loopNodeId);

    if (outgoingEdges.length === 0 || items.length === 0) {
      return;
    }

    const bodyNodeIds = outgoingEdges.map((edge) => edge.target);

    for (let offset = 0; offset < items.length; offset += batchSize) {
      if (signal.aborted) {
        throw new Error("Loop execution was cancelled.");
      }

      const batch = items.slice(offset, offset + batchSize);

      for (
        let batchOffset = 0;
        batchOffset < batch.length;
        batchOffset += maxConcurrency
      ) {
        if (signal.aborted) {
          throw new Error("Loop execution was cancelled.");
        }

        const concurrentItems = batch.slice(
          batchOffset,
          batchOffset + maxConcurrency,
        );

        const executions = concurrentItems.flatMap((item, index) => {
          const globalIndex = offset + batchOffset + index;

          return bodyNodeIds.map(async (bodyNodeId) => {
            if (signal.aborted) {
              throw new Error("Loop execution was cancelled.");
            }

            const bodyNode = nodes.get(bodyNodeId);

            if (!bodyNode) {
              throw new Error(`Loop body node "${bodyNodeId}" was not found.`);
            }

            const executor = this.registry.get(bodyNode.type);

            const itemContext: LoopItemContext = {
              item,
              index: globalIndex,
            };

            const incomingEdges = edges.filter(
              (edge) => edge.target === bodyNodeId,
            );

            const previousOutputs: Record<string, unknown> = {};

            for (const edge of incomingEdges) {
              if (edge.source === loopNodeId) {
                previousOutputs[edge.source] = {
                  item,
                  index: globalIndex,
                  $item: item,
                  $index: globalIndex,
                };
              } else {
                const output = nodeOutputs.get(edge.source);

                if (output) {
                  previousOutputs[edge.source] = output;
                }
              }
            }

            const nodeInput: Record<string, unknown> = {
              ...(options.input ?? {}),
              $item: itemContext.item,
              $index: itemContext.index,
            };

            const context: NodeExecutionContext = {
              executionId: options.executionId,
              workflowId: options.workflow.id,
              workflowVersion: options.workflowVersion,
              nodeId: bodyNode.id,
              attempt: 1,
              input: nodeInput,
              previousOutputs,
              signal,
            };

            const result = await executor.execute(bodyNode, context);

            if (result.status !== "SUCCESS") {
              throw new Error(
                result.status === "FAILED"
                  ? result.error.message
                  : `Loop body node "${bodyNodeId}" did not complete successfully.`,
              );
            }

            // Preserve iteration-specific outputs.
            nodeOutputs.set(`${bodyNodeId}_item_${globalIndex}`, result.output);
          });
        });

        await Promise.all(executions);
      }
    }
  }

  /**
   * Recursively skips unchosen conditional branches.
   */
  private skipNodeAndDownstream(
    nodeId: string,
    edges: WorkflowEdge[],
    scheduler: DependencyScheduler,
    nodeResults: Record<string, NodeExecutionResult>,
    nodeOutputs: Map<string, Record<string, unknown>>,
  ): void {
    if (nodeResults[nodeId]) return;

    const currentStatus = scheduler.getStatus(nodeId);

    if (
      currentStatus === "COMPLETED" ||
      currentStatus === "FAILED" ||
      currentStatus === "CANCELLED"
    ) {
      return;
    }

    const timestamp = new Date().toISOString();

    nodeResults[nodeId] = {
      status: "SKIPPED",
      reason: "Condition branch not taken.",
      startedAt: timestamp,
      finishedAt: timestamp,
    };

    scheduler.markBranchSkipped(nodeId);
    nodeOutputs.set(nodeId, { skipped: true });

    const outgoing = edges.filter((edge) => edge.source === nodeId);

    for (const edge of outgoing) {
      this.skipNodeAndDownstream(
        edge.target,
        edges,
        scheduler,
        nodeResults,
        nodeOutputs,
      );
    }
  }
}
