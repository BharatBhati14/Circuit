import { describe, expect, it } from "vitest";
import type { NodeExecutionContext, WorkflowNode } from "@circuit/contracts";
import { WebhookTriggerExecutor } from "../webhook-trigger.js";

function createNode(config: Record<string, unknown> = {}): WorkflowNode {
  return {
    id: "webhook-1",
    type: "webhook_trigger",
    config,
    position: { x: 0, y: 0 },
  };
}

function createContext(
  input: Record<string, unknown> = {
    body: { event: "order.created", id: 99 },
    headers: { "content-type": "application/json" },
    query: { ref: "dashboard" },
  },
): NodeExecutionContext {
  return {
    executionId: "execution-1",
    workflowId: "workflow-1",
    workflowVersion: 1,
    nodeId: "webhook-1",
    attempt: 1,
    input,
    previousOutputs: {},
  };
}

describe("WebhookTriggerExecutor", () => {
  const executor = new WebhookTriggerExecutor();

  it("passes through incoming webhook input as output", async () => {
    const context = createContext();
    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");
    if (result.status === "SUCCESS") {
      expect(result.output).toEqual(context.input);
    }
  });

  it("fails on invalid node type execution", async () => {
    const invalidNode: WorkflowNode = {
      id: "node-2",
      type: "manual_trigger",
      config: {},
      position: { x: 0, y: 0 },
    };

    const result = await executor.execute(invalidNode, createContext());
    expect(result.status).toBe("FAILED");
    if (result.status === "FAILED") {
      expect(result.error.code).toBe("INVALID_NODE_CONFIG");
    }
  });
});
