import { describe, it, expect } from "vitest";

import type { WorkflowDefinition } from "@circuit/contracts";

import { DependencyScheduler } from "./dependency-scheduler.js";

function createWorkflow(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Test Workflow",
    nodes: [
      { id: "A", type: "manual_trigger", config: {}, position: { x: 0, y: 0 } },
      { id: "B", type: "data_transform", config: {}, position: { x: 0, y: 0 } },
      { id: "C", type: "data_transform", config: {}, position: { x: 0, y: 0 } },
      { id: "D", type: "data_transform", config: {}, position: { x: 0, y: 0 } },
    ],
    edges: [
      { id: "edge-1", source: "A", target: "B" },
      { id: "edge-2", source: "A", target: "C" },
      { id: "edge-3", source: "B", target: "D" },
      { id: "edge-4", source: "C", target: "D" },
    ],
  };
}

describe("DependencyScheduler", () => {
  it("returns only nodes without dependencies initially", () => {
    const scheduler = new DependencyScheduler(createWorkflow());

    expect(scheduler.getReadyNodes()).toEqual(["A"]);
  });

  it("returns independent nodes together", () => {
    const workflow = createWorkflow();

    workflow.nodes = workflow.nodes.filter((node) => node.id !== "D");

    workflow.edges = [
      { id: "edge-1", source: "A", target: "C" },
      { id: "edge-2", source: "B", target: "C" },
    ];

    const scheduler = new DependencyScheduler(workflow);

    expect(scheduler.getReadyNodes()).toEqual(["A", "B"]);
  });

  it("unlocks dependent nodes after successful completion", () => {
    const scheduler = new DependencyScheduler(createWorkflow());

    expect(scheduler.getReadyNodes()).toEqual(["A"]);

    scheduler.markCompleted("A");

    expect(scheduler.getReadyNodes()).toEqual(["B", "C"]);
  });

  it("does not schedule the same node twice", () => {
    const scheduler = new DependencyScheduler(createWorkflow());

    expect(scheduler.getReadyNodes()).toEqual(["A"]);
    expect(scheduler.getReadyNodes()).toEqual([]);
  });

  it("waits until all dependencies complete successfully", () => {
    const scheduler = new DependencyScheduler(createWorkflow());

    scheduler.getReadyNodes();
    scheduler.markCompleted("A");

    expect(scheduler.getReadyNodes()).toEqual(["B", "C"]);

    scheduler.markCompleted("B");

    expect(scheduler.getReadyNodes()).toEqual([]);

    scheduler.markCompleted("C");

    expect(scheduler.getReadyNodes()).toEqual(["D"]);
  });

  it("does not schedule a node whose dependency failed", () => {
    const scheduler = new DependencyScheduler(createWorkflow());

    scheduler.getReadyNodes();
    scheduler.markCompleted("A");

    scheduler.getReadyNodes();
    scheduler.markFailed("B");
    scheduler.markCompleted("C");

    expect(scheduler.getReadyNodes()).toEqual([]);
  });

  it("allows independent branches to continue after a failure", () => {
    const workflow = createWorkflow();

    workflow.edges = [
      { id: "edge-1", source: "A", target: "B" },
      { id: "edge-2", source: "C", target: "D" },
    ];

    const scheduler = new DependencyScheduler(workflow);

    expect(scheduler.getReadyNodes()).toEqual(["A", "C"]);

    scheduler.markFailed("A");
    scheduler.markCompleted("C");

    expect(scheduler.getReadyNodes()).toEqual(["D"]);
  });

  it("throws when completing an unknown node", () => {
    const scheduler = new DependencyScheduler(createWorkflow());

    expect(() => scheduler.markCompleted("UNKNOWN")).toThrow(
      'Unknown node ID: "UNKNOWN".',
    );
  });

  it("throws when marking an unscheduled node as failed", () => {
    const scheduler = new DependencyScheduler(createWorkflow());

    expect(() => scheduler.markFailed("B")).toThrow(
      'Node "B" has not been scheduled.',
    );
  });
});

describe("DependencyScheduler - terminal states", () => {
  it("marks a node as skipped", () => {
    const workflow = createWorkflow();
    const scheduler = new DependencyScheduler(workflow);

    const readyNodes = scheduler.getReadyNodes();

    for (const nodeId of readyNodes) {
      scheduler.markSkipped(nodeId);
    }

    expect(scheduler.getStatus(readyNodes[0]!)).toBe("SKIPPED");
  });

  it("automatically skips dependent nodes after failure", () => {
    const workflow = createWorkflow();
    const scheduler = new DependencyScheduler(workflow);

    const readyNodes = scheduler.getReadyNodes();

    scheduler.markFailed(readyNodes[0]!);

    expect(scheduler.getStatus("C")).toBe("SKIPPED");
  });

  it("recursively skips downstream dependencies", () => {
    const workflow = createWorkflow();
    const scheduler = new DependencyScheduler(workflow);

    const readyNodes = scheduler.getReadyNodes();

    scheduler.markFailed(readyNodes[0]!);

    expect(scheduler.getStatus("C")).toBe("SKIPPED");
    expect(scheduler.getStatus("D")).toBe("SKIPPED");
  });

  it("allows independent branches to continue after failure", () => {
    const workflow = createWorkflow();

    workflow.edges = [
      { id: "edge-1", source: "A", target: "B" },
      { id: "edge-2", source: "C", target: "D" },
    ];

    const scheduler = new DependencyScheduler(workflow);

    const readyNodes = scheduler.getReadyNodes();

    expect(readyNodes).toEqual(["A", "C"]);

    scheduler.markFailed("A");

    expect(scheduler.getStatus("B")).toBe("SKIPPED");

    // C was already scheduled, so it must not be returned again.
    expect(scheduler.getStatus("C")).toBe("SCHEDULED");

    scheduler.markCompleted("C");

    expect(scheduler.getReadyNodes()).toEqual(["D"]);
  });

  it("recognizes completion when every node is terminal", () => {
    const workflow = createWorkflow();
    const scheduler = new DependencyScheduler(workflow);

    const readyNodes = scheduler.getReadyNodes();

    for (const nodeId of readyNodes) {
      scheduler.markFailed(nodeId);
    }

    expect(scheduler.isComplete()).toBe(true);
  });

  it("rejects duplicate terminal state transitions", () => {
    const workflow = createWorkflow();
    const scheduler = new DependencyScheduler(workflow);

    const readyNodes = scheduler.getReadyNodes();
    const nodeId = readyNodes[0]!;

    scheduler.markCompleted(nodeId);

    expect(() => scheduler.markFailed(nodeId)).toThrow();
  });

  it("rejects marking an unscheduled node as skipped", () => {
    const workflow = createWorkflow();
    const scheduler = new DependencyScheduler(workflow);

    expect(() => scheduler.markSkipped("C")).toThrow();
  });
});
