import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";
import { NodeExecutor } from "../types.js";

export class TriggerExecutor implements NodeExecutor {
  constructor(public readonly type: "manual_trigger" | "webhook_trigger") {}

  async execute(
    node: WorkflowNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const startedAt = new Date().toISOString();

    // The trigger node passes through the initial execution input (or node config) as its output
    const output = {
      ...(node.config || {}),
      ...(context.input || {}),
    };

    const finishedAt = new Date().toISOString();

    return {
      status: "SUCCESS",
      output,
      startedAt,
      finishedAt,
    };
  }
}
