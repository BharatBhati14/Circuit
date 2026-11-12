import {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";
import { NodeExecutor } from "../types.js";
import { validateNodeConfig } from "../../validation/node-config.js";
import { InvalidWorkflowError } from "../../errors.js";

export class CronTriggerExecutor implements NodeExecutor {
  readonly type = "schedule_trigger" as const;

  async execute(
    node: WorkflowNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const startTime = new Date();

    try {
      if (node.type !== this.type) {
        throw new InvalidWorkflowError(
          `WebhookTriggerExecutor cannot execute node type "${node.type}".`,
        );
      }

      validateNodeConfig(node);

      console.log(`⏰ Executing schedule trigger node: ${context.nodeId}`);

      // Retrieve scheduled timestamp injected from the job data, or fallback to now
      const triggeredAt = context.input?.triggeredAt || startTime.toISOString();
      const triggerType = context.input?.triggerType || "cron";

      return {
        status: "SUCCESS",
        output: {
          triggeredAt,
          triggerType,
          timestamp: startTime.getTime(),
        },
        startedAt: startTime.toISOString(),
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
          startedAt: startTime.toISOString(),
          finishedAt,
        };
      }

      return {
        status: "FAILED",
        error: {
          code: "SCHEDULE_CRON_TRIGGER_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected schedule cron trigger error occurred.",
          retryable: false,
        },
        startedAt: startTime.toISOString(),
        finishedAt,
      };
    }
  }
}
