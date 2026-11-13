import { describe, it, expect, beforeEach } from "vitest";
import { WorkflowRunner } from "../../workflow-runner/workflow-runner.js";
import { ExecutorRegistry } from "../../registry.js";
import { LoopExecutor } from "../loop.executor.js";

import type {
  WorkflowDefinition,
  WorkflowNode,
  NodeExecutionContext,
  NodeExecutionResult,
} from "@circuit/contracts";
import { NodeExecutor } from "../../types.js";

const users = ["alice", "bob", "charlie"];

let receivedInputs: unknown[] = [];

class MockDataSourceExecutor implements NodeExecutor {
  readonly type = "manual_trigger" as const;

  async execute(
    _node: WorkflowNode,
    _context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    return {
      status: "SUCCESS",
      output: {
        users,
      },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }
}

class MockBodyExecutor implements NodeExecutor {
  readonly type = "http_request" as const;

  async execute(
    _node: WorkflowNode,
    context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    receivedInputs.push(context.input);

    return {
      status: "SUCCESS",
      output: {
        processed: true,
        inputReceived: context.input,
      },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }
}

function createWorkflow(
  itemsPath = "$.source.users",
  batchSize = 1,
): WorkflowDefinition {
  return {
    id: "wf-loop-test",
    name: "Loop Integration Workflow",
    nodes: [
      {
        id: "source",
        type: "manual_trigger",
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: "loop-node",
        type: "loop",
        config: {
          itemsPath,
          batchSize,
        },
        position: { x: 100, y: 0 },
      },
      {
        id: "body-node",
        type: "http_request",
        config: {
          method: "POST",
          url: "https://example.com/process",
        },
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "source",
        target: "loop-node",
      },
      {
        id: "e2",
        source: "loop-node",
        target: "body-node",
      },
    ],
  };
}

function createRunner(): WorkflowRunner {
  const registry = new ExecutorRegistry();

  registry.register(new MockDataSourceExecutor());
  registry.register(new LoopExecutor());
  registry.register(new MockBodyExecutor());

  return new WorkflowRunner(registry);
}

describe("WorkflowRunner Loop Integration", () => {
  beforeEach(() => {
    receivedInputs = [];
  });

  it("successfully executes a loop node", async () => {
    const runner = createRunner();

    const result = await runner.execute({
      executionId: "exec-loop-1",
      workflowVersion: 1,
      workflow: createWorkflow(),
      input: {},
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.nodeResults.source.status).toBe("SUCCESS");
    expect(result.nodeResults["loop-node"].status).toBe("SUCCESS");

    const loopResult = result.nodeResults["loop-node"];

    if (loopResult.status === "SUCCESS") {
      expect(loopResult.output.items).toEqual(users);
      expect(loopResult.output.count).toBe(3);
    }
  });

  it("passes item-level context to downstream nodes", async () => {
    const runner = createRunner();

    await runner.execute({
      executionId: "exec-loop-2",
      workflowVersion: 1,
      workflow: createWorkflow(),
      input: {},
    });

    // Requires item-level iteration support in WorkflowRunner.
    expect(receivedInputs).toHaveLength(3);
    expect(receivedInputs).toContainEqual({
      $item: "alice",
      $index: 0,
    });
  });

  it("preserves the correct index for every item", async () => {
    const runner = createRunner();

    await runner.execute({
      executionId: "exec-loop-3",
      workflowVersion: 1,
      workflow: createWorkflow(),
      input: {},
    });

    expect(receivedInputs).toEqual([
      { $item: "alice", $index: 0 },
      { $item: "bob", $index: 1 },
      { $item: "charlie", $index: 2 },
    ]);
  });

  it("processes items using the configured batch size", async () => {
    const runner = createRunner();

    await runner.execute({
      executionId: "exec-loop-4",
      workflowVersion: 1,
      workflow: createWorkflow("$.source.users", 2),
      input: {},
    });

    expect(receivedInputs).toHaveLength(3);
  });

  it("handles an empty array without executing body nodes", async () => {
    const registry = new ExecutorRegistry();

    class EmptyDataSourceExecutor implements NodeExecutor {
      readonly type = "manual_trigger" as const;

      async execute(): Promise<NodeExecutionResult> {
        return {
          status: "SUCCESS",
          output: { users: [] },
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        };
      }
    }

    registry.register(new EmptyDataSourceExecutor());
    registry.register(new LoopExecutor());
    registry.register(new MockBodyExecutor());

    const runner = new WorkflowRunner(registry);

    const result = await runner.execute({
      executionId: "exec-loop-5",
      workflowVersion: 1,
      workflow: createWorkflow(),
      input: {},
    });

    expect(result.nodeResults["loop-node"].status).toBe("SUCCESS");
    expect(receivedInputs).toHaveLength(0);
  });

  it("does not execute downstream nodes when loop input is invalid", async () => {
    const runner = createRunner();

    const result = await runner.execute({
      executionId: "exec-loop-6",
      workflowVersion: 1,
      workflow: createWorkflow("$.source.missing"),
      input: {},
    });

    expect(result.nodeResults["loop-node"].status).toBe("FAILED");
    expect(receivedInputs).toHaveLength(0);
  });
});
