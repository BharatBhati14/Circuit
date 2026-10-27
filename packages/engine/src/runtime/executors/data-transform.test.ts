import { describe, expect, it } from "vitest";
import type { NodeExecutionContext, WorkflowNode } from "@circuit/contracts";
import { DataTransformExecutor } from "./data-transform.js";

function createNode(
  config: Record<string, unknown> = {
    mappings: {
      customerName: "$.customer.name",
    },
  },
): WorkflowNode {
  return {
    id: "transform-1",
    type: "data_transform",
    config,
    position: { x: 0, y: 0 },
  };
}

function createContext(
  input: Record<string, unknown> = {
    customer: { name: "Asha" },
    order: { id: 1042 },
  },
): NodeExecutionContext {
  return {
    executionId: "execution-1",
    workflowId: "workflow-1",
    workflowVersion: 1,
    nodeId: "transform-1",
    attempt: 1,
    input,
    previousOutputs: {},
  };
}

describe("DataTransformExecutor", () => {
  const executor = new DataTransformExecutor();

  it("resolves nested object paths", async () => {
    const result = await executor.execute(
      createNode({
        mappings: {
          customerName: "$.customer.name",
        },
      }),
      createContext(),
    );

    expect(result.status).toBe("SUCCESS");

    if (result.status === "SUCCESS") {
      expect(result.output).toEqual({
        customerName: "Asha",
      });
    }
  });

  it("preserves numeric values", async () => {
    const result = await executor.execute(
      createNode({
        mappings: {
          orderId: "$.order.id",
        },
      }),
      createContext(),
    );

    expect(result.status).toBe("SUCCESS");

    if (result.status === "SUCCESS") {
      expect(result.output.orderId).toBe(1042);
      expect(typeof result.output.orderId).toBe("number");
    }
  });

  it("preserves literal strings", async () => {
    const result = await executor.execute(
      createNode({
        mappings: {
          source: "Circuit",
        },
      }),
      createContext(),
    );

    expect(result.status).toBe("SUCCESS");

    if (result.status === "SUCCESS") {
      expect(result.output).toEqual({
        source: "Circuit",
      });
    }
  });

  it("returns a structured failure for a missing path", async () => {
    const result = await executor.execute(
      createNode({
        mappings: {
          email: "$.customer.email",
        },
      }),
      createContext(),
    );

    expect(result.status).toBe("FAILED");

    if (result.status === "FAILED") {
      expect(result.error.code).toBe("DATA_PATH_NOT_FOUND");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("does not mutate the original input", async () => {
    const input = {
      customer: { name: "Asha" },
      order: { id: 1042 },
    };
    const original = structuredClone(input);

    await executor.execute(
      createNode({
        mappings: {
          customerName: "$.customer.name",
          source: "Circuit",
        },
      }),
      createContext(input),
    );

    expect(input).toEqual(original);
  });

  it("returns a structured failure for invalid node config", async () => {
    const result = await executor.execute(
      createNode({
        mappings: {
          invalid: 123,
        },
      }),
      createContext(),
    );

    expect(result.status).toBe("FAILED");

    if (result.status === "FAILED") {
      expect(result.error.code).toBe("INVALID_NODE_CONFIG");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("returns ISO 8601 timestamps", async () => {
    const result = await executor.execute(createNode(), createContext());

    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(Number.isNaN(Date.parse(result.startedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(result.finishedAt))).toBe(false);
  });

  it("rejects unsafe property paths", async () => {
    const result = await executor.execute(
      createNode({
        mappings: {
          value: "$.customer.constructor",
        },
      }),
      createContext(),
    );

    expect(result.status).toBe("FAILED");

    if (result.status === "FAILED") {
      expect(result.error.code).toBe("INVALID_DATA_PATH");
    }
  });
});
