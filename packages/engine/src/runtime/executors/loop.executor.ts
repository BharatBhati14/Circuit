import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";
import type { NodeExecutor } from "../types.js";
import { InvalidWorkflowError } from "../../errors.js";
import {
  loopConfigSchema,
  validateNodeConfig,
} from "../../validation/node-config.js";

export class LoopExecutor implements NodeExecutor {
  readonly type = "loop" as const;

  async execute(
    node: WorkflowNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const startedAt = new Date().toISOString();

    try {
      if (node.type !== this.type) {
        throw new InvalidWorkflowError(
          `LoopExecutor cannot execute node type "${node.type}".`,
        );
      }

      if (context.signal?.aborted) {
        return {
          status: "CANCELLED",
          reason: "Execution was cancelled.",
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      validateNodeConfig(node);

      const parsedConfig = loopConfigSchema.safeParse(node.config);

      if (!parsedConfig.success) {
        return {
          status: "FAILED",
          error: {
            code: "INVALID_NODE_CONFIG",
            message: `Invalid loop configuration: ${parsedConfig.error.message}`,
            retryable: false,
          },
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      const { itemsPath, batchSize } = parsedConfig.data;

      // Resolve the target array from previous outputs using dot notation
      const resolvedItems = resolveFieldPath(
        itemsPath,
        context.previousOutputs,
      );

      if (!Array.isArray(resolvedItems)) {
        return {
          status: "FAILED",
          error: {
            code: "INVALID_LOOP_INPUT",
            message: `Loop itemsPath "${itemsPath}" resolved to a non-array value: ${typeof resolvedItems}`,
            retryable: false,
          },
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      console.log(
        `🔄 Loop node ${node.id} initialized with ${resolvedItems.length} items (batchSize: ${batchSize})`,
      );

      return {
        status: "SUCCESS",
        output: {
          items: resolvedItems,
          count: resolvedItems.length,
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      return {
        status: "FAILED",
        error: {
          code: "LOOP_EXECUTION_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected loop execution error occurred.",
          retryable: false,
        },
        startedAt,
        finishedAt,
      };
    }
  }
}

/**
 * Helper to resolve dotted path (e.g. $.nodeId.arrayField)
 */
function resolveFieldPath(
  path: string,
  previousOutputs: Record<string, unknown>,
): unknown {
  const cleanPath = path.startsWith("$.") ? path.slice(2) : path;
  const parts = cleanPath.split(".");
  let current: unknown = previousOutputs;

  for (const part of parts) {
    if (
      current &&
      typeof current === "object" &&
      current !== null &&
      part in current
    ) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}
