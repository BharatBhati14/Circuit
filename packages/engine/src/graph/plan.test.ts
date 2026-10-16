import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "@circuit/contracts";
import { createExecutionPlan, InvalidWorkflowError } from "../index.js";

function createWorkflow(
  nodes: string[],
  edges: Array<{ id: string; source: string; target: string }>,
): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Test workflow",
    nodes: nodes.map((id, index) => ({
      id,
      type: "manual_trigger",
      config: {},
      position: { x: index * 200, y: 0 },
    })),
    edges,
  };
}

describe("createExecutionPlan", () => {
  it("plans a linear workflow in dependency order", () => {
    const workflow = createWorkflow(
      ["A", "B", "C"],
      [
        { id: "e1", source: "A", target: "B" },
        { id: "e2", source: "B", target: "C" },
      ],
    );

    expect(createExecutionPlan(workflow)).toEqual(["A", "B", "C"]);
  });

  it("supports parallel branches", () => {
    const workflow = createWorkflow(
      ["A", "B", "C", "D"],
      [
        { id: "e1", source: "A", target: "B" },
        { id: "e2", source: "A", target: "C" },
        { id: "e3", source: "B", target: "D" },
        { id: "e4", source: "C", target: "D" },
      ],
    );

    const plan = createExecutionPlan(workflow);

    expect(plan).toHaveLength(4);
    expect(plan.indexOf("A")).toBeLessThan(plan.indexOf("B"));
    expect(plan.indexOf("A")).toBeLessThan(plan.indexOf("C"));
    expect(plan.indexOf("B")).toBeLessThan(plan.indexOf("D"));
    expect(plan.indexOf("C")).toBeLessThan(plan.indexOf("D"));
  });

  it("rejects a cycle", () => {
    const workflow = createWorkflow(
      ["A", "B", "C"],
      [
        { id: "e1", source: "A", target: "B" },
        { id: "e2", source: "B", target: "C" },
        { id: "e3", source: "C", target: "A" },
      ],
    );

    expect(() => createExecutionPlan(workflow)).toThrow(InvalidWorkflowError);
  });

  it("rejects an edge referencing a missing node", () => {
    const workflow = createWorkflow(
      ["A"],
      [{ id: "e1", source: "A", target: "B" }],
    );

    expect(() => createExecutionPlan(workflow)).toThrow(InvalidWorkflowError);
  });

  it("rejects duplicate node IDs", () => {
    const workflow = createWorkflow(["A", "A"], []);

    expect(() => createExecutionPlan(workflow)).toThrow(InvalidWorkflowError);
  });
});
