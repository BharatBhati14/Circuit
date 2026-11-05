import { describe, expect, it, vi } from "vitest";
import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowDefinition,
  WorkflowNode,
} from "@circuit/contracts";

import { ExecutorRegistry } from "../registry.js";
import type { NodeExecutor } from "../types.js";
import { WorkflowRunner } from "./workflow-runner.js";

const timestamp = "2026-11-04T10:00:00.000Z";

function createNode(id: string): WorkflowNode {
  return {
    id,
    type: "manual_trigger",
    config: {},
    position: { x: 0, y: 0 },
  };
}

function createWorkflow(
  nodeIds: string[],
  edges: WorkflowDefinition["edges"] = [],
): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Test Workflow",
    nodes: nodeIds.map(createNode),
    edges,
  };
}

function createEdge(source: string, target: string) {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
  };
}

function createSuccessResult(
  output: Record<string, unknown> = { success: true },
): NodeExecutionResult {
  return {
    status: "SUCCESS",
    output,
    startedAt: timestamp,
    finishedAt: timestamp,
  };
}

function createFailureResult(
  message = "Execution failed",
): NodeExecutionResult {
  return {
    status: "FAILED",
    error: {
      code: "TEST_ERROR",
      message,
      retryable: false,
    },
    startedAt: timestamp,
    finishedAt: timestamp,
  };
}

function createMockExecutor(
  implementation?: (
    node: WorkflowNode,
    context: NodeExecutionContext,
  ) => Promise<NodeExecutionResult>,
) {
  const execute = vi.fn(implementation ?? (async () => createSuccessResult()));

  const executor: NodeExecutor = {
    type: "manual_trigger",
    execute,
  };

  return { executor, execute };
}

function createRegistry(executor: NodeExecutor): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  registry.register(executor);
  return registry;
}

describe("WorkflowRunner", () => {
  it("executes a single-node workflow", async () => {
    const workflow = createWorkflow(["A"]);

    const { executor, execute } = createMockExecutor();
    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("COMPLETED");
    expect(result.nodeResults.A?.status).toBe("SUCCESS");
  });

  it("executes a linear workflow", async () => {
    const workflow = createWorkflow(
      ["A", "B", "C"],
      [createEdge("A", "B"), createEdge("B", "C")],
    );

    const { executor, execute } = createMockExecutor();
    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(execute).toHaveBeenCalledTimes(3);

    expect(execute.mock.calls.map(([node]) => node.id)).toEqual([
      "A",
      "B",
      "C",
    ]);

    expect(result.status).toBe("COMPLETED");
  });

  it("executes independent nodes", async () => {
    const workflow = createWorkflow(["A", "B", "C"]);

    const { executor, execute } = createMockExecutor();
    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("COMPLETED");

    expect(
      Object.values(result.nodeResults).every(
        (nodeResult) => nodeResult.status === "SUCCESS",
      ),
    ).toBe(true);
  });

  it("returns FAILED when a node fails", async () => {
    const workflow = createWorkflow(["A"]);

    const { executor } = createMockExecutor(async () => createFailureResult());

    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(result.status).toBe("FAILED");
    expect(result.nodeResults.A?.status).toBe("FAILED");
  });

  it("continues independent branches after failure", async () => {
    const workflow = createWorkflow(
      ["A", "B", "C", "D"],
      [createEdge("A", "C"), createEdge("B", "D")],
    );

    const { executor, execute } = createMockExecutor(async (node) => {
      if (node.id === "A") {
        return createFailureResult();
      }

      return createSuccessResult();
    });

    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.nodeResults.A?.status).toBe("FAILED");
    expect(result.nodeResults.B?.status).toBe("SUCCESS");
    expect(result.nodeResults.C?.status).toBe("SKIPPED");
    expect(result.nodeResults.D?.status).toBe("SUCCESS");
    expect(result.status).toBe("FAILED");
  });

  it("skips dependent nodes after failure", async () => {
    const workflow = createWorkflow(
      ["A", "B", "C"],
      [createEdge("A", "B"), createEdge("B", "C")],
    );

    const { executor, execute } = createMockExecutor(async () =>
      createFailureResult(),
    );

    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.nodeResults.A?.status).toBe("FAILED");
    expect(result.nodeResults.B?.status).toBe("SKIPPED");
    expect(result.nodeResults.C?.status).toBe("SKIPPED");
    expect(result.status).toBe("FAILED");
  });

  it("preserves actual executor results and outputs", async () => {
    const workflow = createWorkflow(["A"]);

    const expectedOutput = {
      message: "Hello from executor",
      count: 42,
    };

    const expectedResult = createSuccessResult(expectedOutput);

    const { executor } = createMockExecutor(async () => expectedResult);

    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(result.nodeResults.A).toEqual(expectedResult);
    expect(
      result.nodeResults.A?.status === "SUCCESS"
        ? result.nodeResults.A.output
        : undefined,
    ).toEqual(expectedOutput);
  });

  it("propagates outputs through a linear workflow", async () => {
    const workflow = createWorkflow(
      ["A", "B", "C"],
      [createEdge("A", "B"), createEdge("B", "C")],
    );

    const outputA = { userId: 101, name: "John" };
    const outputB = { message: "Hello John" };
    const outputC = { success: true };

    const { executor, execute } = createMockExecutor(async (node) => {
      switch (node.id) {
        case "A":
          return createSuccessResult(outputA);
        case "B":
          return createSuccessResult(outputB);
        case "C":
          return createSuccessResult(outputC);
        default:
          throw new Error(`Unexpected node: ${node.id}`);
      }
    });

    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(execute).toHaveBeenCalledTimes(3);

    expect(execute.mock.calls[0]?.[1].previousOutputs).toEqual({});

    expect(execute.mock.calls[1]?.[1].previousOutputs).toEqual({
      A: outputA,
    });

    expect(execute.mock.calls[2]?.[1].previousOutputs).toEqual({
      B: outputB,
    });

    expect(result.status).toBe("COMPLETED");
  });

  it("passes outputs from multiple direct dependencies", async () => {
    const workflow = createWorkflow(
      ["A", "B", "C"],
      [createEdge("A", "C"), createEdge("B", "C")],
    );

    const outputA = { valueA: 10 };
    const outputB = { valueB: 20 };
    const outputC = { total: 30 };

    const { executor, execute } = createMockExecutor(async (node) => {
      switch (node.id) {
        case "A":
          return createSuccessResult(outputA);
        case "B":
          return createSuccessResult(outputB);
        case "C":
          return createSuccessResult(outputC);
        default:
          throw new Error(`Unexpected node: ${node.id}`);
      }
    });

    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(execute).toHaveBeenCalledTimes(3);

    const cCall = execute.mock.calls.find(([node]) => node.id === "C");

    expect(cCall?.[1].previousOutputs).toEqual({
      A: outputA,
      B: outputB,
    });

    expect(result.status).toBe("COMPLETED");
  });

  it("does not expose outputs from unrelated branches", async () => {
    const workflow = createWorkflow(
      ["A", "B", "C", "D"],
      [createEdge("A", "C"), createEdge("B", "D")],
    );

    const outputA = { dataA: "A output" };
    const outputB = { dataB: "B output" };

    const { executor, execute } = createMockExecutor(async (node) => {
      if (node.id === "A") {
        return createSuccessResult(outputA);
      }

      if (node.id === "B") {
        return createSuccessResult(outputB);
      }

      return createSuccessResult();
    });

    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(execute).toHaveBeenCalledTimes(4);

    const cCall = execute.mock.calls.find(([node]) => node.id === "C");
    const dCall = execute.mock.calls.find(([node]) => node.id === "D");

    expect(cCall?.[1].previousOutputs).toEqual({
      A: outputA,
    });

    expect(dCall?.[1].previousOutputs).toEqual({
      B: outputB,
    });

    expect(result.status).toBe("COMPLETED");
  });

  it("skips downstream nodes when a dependency fails", async () => {
    const workflow = createWorkflow(
      ["A", "B", "C"],
      [createEdge("A", "B"), createEdge("B", "C")],
    );

    const { executor, execute } = createMockExecutor(async () =>
      createFailureResult("Node A failed"),
    );

    const runner = new WorkflowRunner(createRegistry(executor));

    const result = await runner.execute({
      workflow,
      executionId: "execution-1",
      workflowVersion: 1,
    });

    expect(execute).toHaveBeenCalledTimes(1);

    expect(execute.mock.calls.map(([node]) => node.id)).toEqual(["A"]);

    expect(result.nodeResults.A?.status).toBe("FAILED");
    expect(result.nodeResults.B?.status).toBe("SKIPPED");
    expect(result.nodeResults.C?.status).toBe("SKIPPED");

    expect(result.status).toBe("FAILED");
  });

  it("passes the correct execution context to executors", async () => {
    const workflow = createWorkflow(["A"]);

    const { executor, execute } = createMockExecutor();
    const runner = new WorkflowRunner(createRegistry(executor));

    const input = {
      userId: "user-123",
      message: "Hello",
    };

    await runner.execute({
      workflow,
      executionId: "execution-123",
      workflowVersion: 5,
      input,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "A",
        type: "manual_trigger",
      }),
      {
        executionId: "execution-123",
        workflowId: "workflow-1",
        workflowVersion: 5,
        nodeId: "A",
        attempt: 1,
        input,
        previousOutputs: {},
      },
    );
  });
});
