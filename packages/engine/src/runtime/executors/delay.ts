import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";
import type { NodeExecutor } from "../types.js";
import { InvalidWorkflowError } from "../../errors.js";
import { delayConfigSchema } from "../../validation/node-config.js";

export class DelayExecutor implements NodeExecutor {
  readonly type = "delay" as const;

  async execute(
    node: WorkflowNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const startedAt = new Date().toISOString();

    try {
      if (node.type !== this.type) {
        throw new InvalidWorkflowError(
          `DelayExecutor cannot execute node type "${node.type}".`,
        );
      }

      if (context.signal?.aborted) {
        return {
          status: "CANCELLED",
          reason: "Execution was cancelled before delay started.",
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      const parsedConfig = delayConfigSchema.safeParse(node.config);

      if (!parsedConfig.success) {
        return {
          status: "FAILED",
          error: {
            code: "INVALID_NODE_CONFIG",
            message: `Invalid delay configuration: ${parsedConfig.error.message}`,
            retryable: false,
          },
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      const { durationMs } = parsedConfig.data;

      // Wait for the delay duration or abort signal
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          context.signal?.removeEventListener("abort", abortHandler);
          resolve();
        }, durationMs);

        const abortHandler = () => {
          clearTimeout(timer);
          reject(new Error("Delay was cancelled."));
        };

        context.signal?.addEventListener("abort", abortHandler, { once: true });
      });

      return {
        status: "SUCCESS",
        output: { delayedMs: durationMs },
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();

      if (context.signal?.aborted) {
        return {
          status: "CANCELLED",
          reason: "Delay execution was cancelled.",
          startedAt,
          finishedAt,
        };
      }

      return {
        status: "FAILED",
        error: {
          code: "DELAY_EXECUTION_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected delay error occurred.",
          retryable: false,
        },
        startedAt,
        finishedAt,
      };
    }
  }
}
