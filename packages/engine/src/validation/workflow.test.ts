import { describe, expect, it } from "vitest";
import type { WorkflowDefinition, WorkflowNode } from "@circuit/contracts";
import { InvalidWorkflowError, validateWorkflow } from "../index.js";

function createNode(
  id: string,
  type: WorkflowNode["type"] = "manual_trigger",
  config: Record<string, unknown> = {},
): WorkflowNode {
  return {
    id,
    type,
    config,
    position: { x: 0, y: 0 },
  };
}

function createWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowDefinition["edges"] = [],
): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Test workflow",
    nodes,
    edges,
  };
}

describe("validateWorkflow", () => {
  it("returns an execution plan for a valid workflow", () => {
    const workflow = createWorkflow(
      [
        createNode("trigger"),
        createNode("request", "http_request", {
          method: "GET",
          url: "https://example.com",
        }),
        createNode("transform", "data_transform", {
          mappings: { result: "$.data" },
        }),
      ],
      [
        { id: "edge-1", source: "trigger", target: "request" },
        { id: "edge-2", source: "request", target: "transform" },
      ],
    );

    const plan = validateWorkflow(workflow);

    expect(plan).toEqual(["trigger", "request", "transform"]);
  });

  it("rejects a workflow containing a cycle", () => {
    const workflow = createWorkflow(
      [createNode("A"), createNode("B")],
      [
        { id: "edge-1", source: "A", target: "B" },
        { id: "edge-2", source: "B", target: "A" },
      ],
    );

    expect(() => validateWorkflow(workflow)).toThrow(InvalidWorkflowError);
  });

  it("rejects an HTTP request node with an invalid method", () => {
    const workflow = createWorkflow([
      createNode("trigger"),
      createNode("request", "http_request", {
        method: "INVALID",
        url: "https://example.com",
      }),
    ]);

    expect(() => validateWorkflow(workflow)).toThrow(InvalidWorkflowError);
  });

  it("rejects an HTTP request node with an invalid URL", () => {
    const workflow = createWorkflow([
      createNode("request", "http_request", {
        method: "GET",
        url: "not-a-valid-url",
      }),
    ]);

    expect(() => validateWorkflow(workflow)).toThrow(InvalidWorkflowError);
  });

  it("rejects a data transform node with invalid mappings", () => {
    const workflow = createWorkflow([
      createNode("transform", "data_transform", {
        mappings: "not-an-object",
      }),
    ]);

    expect(() => validateWorkflow(workflow)).toThrow(InvalidWorkflowError);
  });

  it("rejects a manual trigger node with unexpected configuration", () => {
    const workflow = createWorkflow([
      createNode("trigger", "manual_trigger", {
        unexpected: true,
      }),
    ]);

    expect(() => validateWorkflow(workflow)).toThrow(InvalidWorkflowError);
  });

  it("accepts a workflow containing only a manual trigger", () => {
    const workflow = createWorkflow([createNode("trigger")]);

    expect(validateWorkflow(workflow)).toEqual(["trigger"]);
  });
});
