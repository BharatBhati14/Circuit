import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
  ConditionRule,
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

      if (context.signal?.aborted) {
        return {
          status: "CANCELLED",
          reason: "Execution was cancelled.",
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
            message: parsedConfig.error.message,
            retryable: false,
          },
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      const { rules, logicalOperator = "AND" } = parsedConfig.data;

      const ruleResults = rules.map((rule) =>
        evaluateRule(rule, context.previousOutputs),
      );

      const matched =
        logicalOperator === "AND"
          ? ruleResults.every(Boolean)
          : ruleResults.some(Boolean);

      return {
        status: "SUCCESS",
        output: {
          matched,
          ruleResults,
          logicalOperator,
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
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
        finishedAt: new Date().toISOString(),
      };
    }
  }
}

function evaluateRule(
  rule: ConditionRule,
  previousOutputs: Record<string, unknown>,
): boolean {
  const resolvedValue = resolveFieldPath(rule.field, previousOutputs);

  switch (rule.operator) {
    case "equals":
      return resolvedValue === rule.value;

    case "not_equals":
      return resolvedValue !== rule.value;

    case "contains":
      return (
        typeof resolvedValue === "string" &&
        typeof rule.value === "string" &&
        resolvedValue.includes(rule.value)
      );

    case "greater_than":
      return (
        typeof resolvedValue === "number" &&
        typeof rule.value === "number" &&
        resolvedValue > rule.value
      );

    case "less_than":
      return (
        typeof resolvedValue === "number" &&
        typeof rule.value === "number" &&
        resolvedValue < rule.value
      );

    default:
      return false;
  }
}

function resolveFieldPath(
  path: string,
  previousOutputs: Record<string, unknown>,
): unknown {
  const cleanPath = path.startsWith("$.") ? path.slice(2) : path;

  const parts = cleanPath.split(".");

  let current: unknown = previousOutputs;

  for (const part of parts) {
    if (
      current !== null &&
      typeof current === "object" &&
      Object.prototype.hasOwnProperty.call(current, part)
    ) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}
