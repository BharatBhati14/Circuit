import { describe, it, expect } from "vitest";
import { ConditionExecutor } from "../condition.js";
import type { WorkflowNode, NodeExecutionContext } from "@circuit/contracts";

describe("ConditionExecutor", () => {
  const executor = new ConditionExecutor();

  it("evaluates 'equals' condition correctly when true", async () => {
    const node: WorkflowNode = {
      id: "cond-1",
      type: "condition",
      config: {
        field: "$.http_node.statusCode",
        operator: "equals",
        value: 200,
      },
      position: { x: 0, y: 0 },
    };

    const context: NodeExecutionContext = {
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowVersion: 1,
      nodeId: "cond-1",
      attempt: 1,
      input: {},
      previousOutputs: {
        http_node: {
          statusCode: 200,
        },
      },
    };

    const result = await executor.execute(node, context);

    expect(result.status).toBe("SUCCESS");
    if (result.status === "SUCCESS") {
      expect(result.output.matched).toBe(true);
      expect(result.output.resolvedValue).toBe(200);
    }
  });

  it("evaluates 'greater_than' condition correctly when false", async () => {
    const node: WorkflowNode = {
      id: "cond-2",
      type: "condition",
      config: {
        field: "$.data_node.count",
        operator: "greater_than",
        value: 10,
      },
      position: { x: 0, y: 0 },
    };

    const context: NodeExecutionContext = {
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowVersion: 1,
      nodeId: "cond-2",
      attempt: 1,
      input: {},
      previousOutputs: {
        data_node: {
          count: 5,
        },
      },
    };

    const result = await executor.execute(node, context);

    expect(result.status).toBe("SUCCESS");
    if (result.status === "SUCCESS") {
      expect(result.output.matched).toBe(false);
      expect(result.output.resolvedValue).toBe(5);
    }
  });
});
