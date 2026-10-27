import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";
import { InvalidWorkflowError } from "../../errors.js";
import { validateNodeConfig } from "../../validation/node-config.js";
import type { NodeExecutor } from "../types.js";

const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

class DataPathResolutionError extends Error {
  constructor(
    message: string,
    readonly code: "DATA_PATH_NOT_FOUND" | "INVALID_DATA_PATH",
  ) {
    super(message);
    this.name = "DataPathResolutionError";
  }
}

function resolveInputPath(
  path: string,
  input: Record<string, unknown>,
): unknown {
  const segments = path.slice(2).split(".");

  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment.length === 0 || UNSAFE_PATH_SEGMENTS.has(segment),
    )
  ) {
    throw new DataPathResolutionError(
      `Invalid data path: "${path}".`,
      "INVALID_DATA_PATH",
    );
  }

  let current: unknown = input;

  for (const segment of segments) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      throw new DataPathResolutionError(
        `Data path "${path}" could not be resolved.`,
        "DATA_PATH_NOT_FOUND",
      );
    }

    current = (current as Record<string, unknown>)[segment];
  }

  if (current === undefined) {
    throw new DataPathResolutionError(
      `Data path "${path}" resolved to undefined.`,
      "DATA_PATH_NOT_FOUND",
    );
  }

  return current;
}

export class DataTransformExecutor implements NodeExecutor {
  readonly type = "data_transform" as const;

  async execute(
    node: WorkflowNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const startedAt = new Date().toISOString();

    try {
      if (node.type !== this.type) {
        throw new InvalidWorkflowError(
          `DataTransformExecutor cannot execute node type "${node.type}".`,
        );
      }

      validateNodeConfig(node);

      const mappings = node.config.mappings as Record<string, string>;
      const output: Record<string, unknown> = {};

      for (const [key, expression] of Object.entries(mappings)) {
        output[key] = expression.startsWith("$.")
          ? resolveInputPath(expression, context.input)
          : expression;
      }

      return {
        status: "SUCCESS",
        output,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();

      if (error instanceof DataPathResolutionError) {
        return {
          status: "FAILED",
          error: {
            code: error.code,
            message: error.message,
            retryable: false,
          },
          startedAt,
          finishedAt,
        };
      }

      if (error instanceof InvalidWorkflowError) {
        return {
          status: "FAILED",
          error: {
            code: "INVALID_NODE_CONFIG",
            message: error.message,
            retryable: false,
          },
          startedAt,
          finishedAt,
        };
      }

      return {
        status: "FAILED",
        error: {
          code: "DATA_TRANSFORM_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected data transform error occurred.",
          retryable: false,
        },
        startedAt,
        finishedAt,
      };
    }
  }
}
