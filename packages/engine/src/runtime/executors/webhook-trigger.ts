import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";
import { InvalidWorkflowError } from "../../errors.js";
import { validateNodeConfig } from "../../validation/node-config.js";
import type { NodeExecutor } from "../types.js";

export class WebhookTriggerExecutor implements NodeExecutor {
  readonly type = "webhook_trigger" as const;

  async execute(
    node: WorkflowNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const startedAt = new Date().toISOString();

    try {
      if (node.type !== this.type) {
        throw new InvalidWorkflowError(
          `WebhookTriggerExecutor cannot execute node type "${node.type}".`,
        );
      }

      validateNodeConfig(node);

      // Pass through the incoming webhook payload (body, headers, query)
      // as the output of this trigger node so downstream nodes can reference it.
      const output =
        context.input && Object.keys(context.input).length > 0
          ? context.input
          : {};

      return {
        status: "SUCCESS",
        output,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();

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
          code: "WEBHOOK_TRIGGER_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected webhook trigger error occurred.",
          retryable: false,
        },
        startedAt,
        finishedAt,
      };
    }
  }
}
