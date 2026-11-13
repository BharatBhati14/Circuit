import { describe, it, expect } from "vitest";
import { WorkflowRunner } from "../../workflow-runner/workflow-runner.js";
import { ExecutorRegistry } from "../../registry.js";
import { ConditionExecutor } from "../../executors/condition.js";

import type {
  WorkflowDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
} from "@circuit/contracts";

import type { NodeExecutor } from "../../types.js";

// Mock manual trigger executor
class MockManualTriggerExecutor implements NodeExecutor {
  readonly type = "manual_trigger" as const;

  async execute(
    node: any,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    return {
      status: "SUCCESS",
      output: { value: "other_value" },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }
}

// Mock executor for branch nodes
class MockTaskExecutor implements NodeExecutor {
  readonly type = "http_request" as const;

  async execute(
    node: any,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    return {
      status: "SUCCESS",
      output: { success: true },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }
}

describe("WorkflowRunner Conditional Branching & Skip Propagation", () => {
  it("skips the true branch and executes the false branch when condition evaluates to false", async () => {
    const registry = new ExecutorRegistry();

    registry.register(new MockManualTriggerExecutor());
    registry.register(new ConditionExecutor());
    registry.register(new MockTaskExecutor());

    const workflow: WorkflowDefinition = {
      id: "wf-branch-test",
      name: "Branching Test Workflow",

      nodes: [
        {
          id: "start-node",
          type: "manual_trigger",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: "cond-node",
          type: "condition",
          config: {
            rules: [
              {
                field: "$.start-node.value",
                operator: "equals",
                value: "target",
              },
            ],
            logicalOperator: "AND",
          },
          position: { x: 100, y: 0 },
        },
        {
          id: "true-branch-node",
          type: "http_request",
          config: {
            method: "GET",
            url: "https://example.com",
          },
          position: { x: 200, y: -50 },
        },
        {
          id: "false-branch-node",
          type: "http_request",
          config: {
            method: "GET",
            url: "https://example.com",
          },
          position: { x: 200, y: 50 },
        },
      ],

      edges: [
        {
          id: "edge-start-cond",
          source: "start-node",
          target: "cond-node",
        },
        {
          id: "edge-true",
          source: "cond-node",
          target: "true-branch-node",
          // @ts-ignore handle configuration
          handle: "true",
        },
        {
          id: "edge-false",
          source: "cond-node",
          target: "false-branch-node",
          // @ts-ignore handle configuration
          handle: "false",
        },
      ],
    };

    const runner = new WorkflowRunner(registry);

    const executionResult = await runner.execute({
      executionId: "exec-test-1",
      workflowVersion: 1,
      workflow,
      input: {},
    });

    expect(executionResult.status).toBe("COMPLETED");

    // Verify condition evaluated to false
    expect(executionResult.nodeResults["cond-node"].status).toBe("SUCCESS");

    if (executionResult.nodeResults["cond-node"].status === "SUCCESS") {
      expect(executionResult.nodeResults["cond-node"].output.matched).toBe(
        false,
      );
    }

    // Verify true branch was skipped
    expect(executionResult.nodeResults["true-branch-node"].status).toBe(
      "SKIPPED",
    );

    // Verify false branch executed successfully
    expect(executionResult.nodeResults["false-branch-node"].status).toBe(
      "SUCCESS",
    );
  });
});
