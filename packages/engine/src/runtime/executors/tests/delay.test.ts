import { describe, it, expect } from "vitest";
import { DelayExecutor } from "../delay.js";
import type { WorkflowNode, NodeExecutionContext } from "@circuit/contracts";

describe("DelayExecutor", () => {
  const executor = new DelayExecutor();

  it("successfully completes a short delay", async () => {
    const node: WorkflowNode = {
      id: "delay-1",
      type: "delay",
      config: { durationMs: 10 },
      position: { x: 0, y: 0 },
    };

    const context: NodeExecutionContext = {
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowVersion: 1,
      nodeId: "delay-1",
      attempt: 1,
      input: {},
      previousOutputs: {},
    };

    const startTime = Date.now();
    const result = await executor.execute(node, context);
    const duration = Date.now() - startTime;

    expect(result.status).toBe("SUCCESS");
    if (result.status === "SUCCESS") {
      expect(result.output.delayedMs).toBe(10);
    }
    expect(duration).toBeGreaterThanOrEqual(10);
  });

  it("handles cancellation signal during delay", async () => {
    const node: WorkflowNode = {
      id: "delay-2",
      type: "delay",
      config: { durationMs: 1000 },
      position: { x: 0, y: 0 },
    };

    const controller = new AbortController();
    const context: NodeExecutionContext = {
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowVersion: 1,
      nodeId: "delay-2",
      attempt: 1,
      input: {},
      previousOutputs: {},
      signal: controller.signal,
    };

    setTimeout(() => {
      controller.abort();
    }, 20);

    const result = await executor.execute(node, context);

    expect(result.status).toBe("CANCELLED");
  });
});
