import type { WorkflowDefinition } from "@circuit/contracts";
import { InvalidWorkflowError } from "../errors.js";

export function createExecutionPlan(workflow: WorkflowDefinition): string[] {
  const { nodes, edges } = workflow;

  const nodeIds = new Set<string>();

  // Reject duplicate node IDs.
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new InvalidWorkflowError(`Duplicate node ID: "${node.id}"`);
    }

    nodeIds.add(node.id);
  }

  // Initialize the graph.
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Validate edges and build the dependency graph.
  const edgeIds = new Set<string>();

  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      throw new InvalidWorkflowError(`Duplicate edge ID: "${edge.id}"`);
    }

    edgeIds.add(edge.id);

    if (!nodeIds.has(edge.source)) {
      throw new InvalidWorkflowError(
        `Edge "${edge.id}" references missing source node "${edge.source}"`,
      );
    }

    if (!nodeIds.has(edge.target)) {
      throw new InvalidWorkflowError(
        `Edge "${edge.id}" references missing target node "${edge.target}"`,
      );
    }

    if (edge.source === edge.target) {
      throw new InvalidWorkflowError(
        `Self-connection detected on node "${edge.source}"`,
      );
    }

    adjacency.get(edge.source)!.push(edge.target);

    inDegree.set(edge.target, inDegree.get(edge.target)! + 1);
  }

  // Start with nodes that have no dependencies.
  const queue: string[] = [];

  for (const node of nodes) {
    if (inDegree.get(node.id) === 0) {
      queue.push(node.id);
    }
  }

  // Kahn's topological sorting algorithm.
  const executionPlan: string[] = [];
  let head = 0;

  while (head < queue.length) {
    const currentNodeId = queue[head++]!;

    executionPlan.push(currentNodeId);

    for (const neighborId of adjacency.get(currentNodeId)!) {
      const remainingDependencies = inDegree.get(neighborId)! - 1;

      inDegree.set(neighborId, remainingDependencies);

      if (remainingDependencies === 0) {
        queue.push(neighborId);
      }
    }
  }

  // If nodes remain, the graph contains a cycle.
  if (executionPlan.length !== nodes.length) {
    throw new InvalidWorkflowError(
      "Workflow contains a cycle and cannot be executed.",
    );
  }

  return executionPlan;
}
