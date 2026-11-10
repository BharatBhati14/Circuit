import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";
import type { NodeExecutor } from "../types.js";
import { InvalidWorkflowError } from "../../errors.js";
import {
  conditionConfigSchema,
  validateNodeConfig,
} from "../../validation/node-config.js";

export class ConditionExecutor implements NodeExecutor {
  readonly type = "condition" as const;

  async execute(
    node: WorkflowNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const startedAt = new Date().toISOString();

    try {
      if (node.type !== this.type) {
        throw new InvalidWorkflowError(
          `ConditionExecutor cannot execute node type "${node.type}".`,
        );
      }

      // Check if cancellation was requested before running
      if (context.signal?.aborted) {
        const reason = context.signal.reason;
        return {
          status: "CANCELLED",
          reason:
            reason instanceof Error
              ? reason.message
              : typeof reason === "string"
                ? reason
                : "Execution was cancelled.",
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      validateNodeConfig(node);

      const parsedConfig = conditionConfigSchema.safeParse(node.config);

      if (!parsedConfig.success) {
        return {
          status: "FAILED",
          error: {
            code: "INVALID_NODE_CONFIG",
            message: `Invalid condition configuration: ${parsedConfig.error.message}`,
            retryable: false,
          },
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      const { field, operator, value: targetValue } = parsedConfig.data;

      // Helper to resolve dotted path (e.g., "$.http_request.status") from previousOutputs
      const resolvedValue = resolveFieldPath(field, context.previousOutputs);

      let matched = false;
      switch (operator) {
        case "equals":
          matched = resolvedValue === targetValue;
          break;
        case "not_equals":
          matched = resolvedValue !== targetValue;
          break;
        case "contains":
          matched =
            typeof resolvedValue === "string" &&
            typeof targetValue === "string" &&
            resolvedValue.includes(targetValue);
          break;
        case "greater_than":
          matched =
            typeof resolvedValue === "number" &&
            typeof targetValue === "number" &&
            resolvedValue > targetValue;
          break;
        case "less_than":
          matched =
            typeof resolvedValue === "number" &&
            typeof targetValue === "number" &&
            resolvedValue < targetValue;
          break;
      }

      return {
        status: "SUCCESS",
        output: { matched, resolvedValue },
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();

      if (context.signal?.aborted) {
        const reason = context.signal.reason;
        return {
          status: "CANCELLED",
          reason:
            reason instanceof Error
              ? reason.message
              : typeof reason === "string"
                ? reason
                : "Execution was cancelled.",
          startedAt,
          finishedAt,
        };
      }

      return {
        status: "FAILED",
        error: {
          code: "CONDITION_EXECUTION_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected condition evaluation error occurred.",
          retryable: false,
        },
        startedAt,
        finishedAt,
      };
    }
  }
}

// Simple path resolver for nested objects (e.g. $.nodeId.propertyName)
function resolveFieldPath(
  path: string,
  previousOutputs: Record<string, unknown>,
): unknown {
  const cleanPath = path.startsWith("$.") ? path.slice(2) : path;
  const parts = cleanPath.split(".");
  let current: unknown = previousOutputs;

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}
