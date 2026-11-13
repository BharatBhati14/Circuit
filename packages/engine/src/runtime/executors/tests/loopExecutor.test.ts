import { describe, it, expect } from "vitest";
import { LoopExecutor } from "../loop.executor.js";

import type { WorkflowNode, NodeExecutionContext } from "@circuit/contracts";

describe("LoopExecutor", () => {
  const executor = new LoopExecutor();

  it("successfully resolves and iterates over an array path", async () => {
    const node: WorkflowNode = {
      id: "loop-1",
      type: "loop",
      config: {
        itemsPath: "$.fetch_node.users",
        batchSize: 1,
      },
      position: { x: 0, y: 0 },
    };

    const context: NodeExecutionContext = {
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowVersion: 1,
      nodeId: "loop-1",
      attempt: 1,
      input: {},
      previousOutputs: {
        fetch_node: {
          users: ["alice", "bob", "charlie"],
        },
      },
    };

    const result = await executor.execute(node, context);

    expect(result.status).toBe("SUCCESS");

    if (result.status === "SUCCESS") {
      expect(result.output.items).toEqual(["alice", "bob", "charlie"]);

      expect(result.output.count).toBe(3);
    }
  });

  it("fails when itemsPath resolves to a non-array value", async () => {
    const node: WorkflowNode = {
      id: "loop-2",
      type: "loop",
      config: {
        itemsPath: "$.fetch_node.status",
        batchSize: 1,
      },
      position: { x: 0, y: 0 },
    };

    const context: NodeExecutionContext = {
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowVersion: 1,
      nodeId: "loop-2",
      attempt: 1,
      input: {},
      previousOutputs: {
        fetch_node: {
          status: "active",
        },
      },
    };

    const result = await executor.execute(node, context);

    expect(result.status).toBe("FAILED");

    if (result.status === "FAILED") {
      expect(result.error.code).toBe("INVALID_LOOP_INPUT");
    }
  });

  it("successfully handles an empty array", async () => {
    const node: WorkflowNode = {
      id: "loop-3",
      type: "loop",
      config: {
        itemsPath: "$.fetch_node.items",
        batchSize: 2,
      },
      position: { x: 0, y: 0 },
    };

    const context: NodeExecutionContext = {
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowVersion: 1,
      nodeId: "loop-3",
      attempt: 1,
      input: {},
      previousOutputs: {
        fetch_node: {
          items: [],
        },
      },
    };

    const result = await executor.execute(node, context);

    expect(result.status).toBe("SUCCESS");

    if (result.status === "SUCCESS") {
      expect(result.output.items).toEqual([]);
      expect(result.output.count).toBe(0);
    }
  });

  it("fails when itemsPath does not exist", async () => {
    const node: WorkflowNode = {
      id: "loop-4",
      type: "loop",
      config: {
        itemsPath: "$.fetch_node.missing",
      },
      position: { x: 0, y: 0 },
    };

    const context: NodeExecutionContext = {
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowVersion: 1,
      nodeId: "loop-4",
      attempt: 1,
      input: {},
      previousOutputs: {
        fetch_node: {
          users: ["alice"],
        },
      },
    };

    const result = await executor.execute(node, context);

    expect(result.status).toBe("FAILED");

    if (result.status === "FAILED") {
      expect(result.error.code).toBe("INVALID_LOOP_INPUT");
    }
  });

  it("successfully resolves a nested array path", async () => {
    const node: WorkflowNode = {
      id: "loop-5",
      type: "loop",
      config: {
        itemsPath: "$.fetch_node.data.users",
        batchSize: 2,
      },
      position: { x: 0, y: 0 },
    };

    const context: NodeExecutionContext = {
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowVersion: 1,
      nodeId: "loop-5",
      attempt: 1,
      input: {},
      previousOutputs: {
        fetch_node: {
          data: {
            users: ["alice", "bob"],
          },
        },
      },
    };

    const result = await executor.execute(node, context);

    expect(result.status).toBe("SUCCESS");

    if (result.status === "SUCCESS") {
      expect(result.output.items).toEqual(["alice", "bob"]);
      expect(result.output.count).toBe(2);
    }
  });

  it("respects abort signal cancellation", async () => {
    const node: WorkflowNode = {
      id: "loop-6",
      type: "loop",
      config: {
        itemsPath: "$.fetch_node.items",
      },
      position: { x: 0, y: 0 },
    };

    const controller = new AbortController();
    controller.abort();

    const context: NodeExecutionContext = {
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowVersion: 1,
      nodeId: "loop-6",
      attempt: 1,
      input: {},
      previousOutputs: {},
      signal: controller.signal,
    };

    const result = await executor.execute(node, context);

    expect(result.status).toBe("CANCELLED");
  });
});
