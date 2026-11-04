import type { WorkflowDefinition } from "@circuit/contracts";

export class DependencyScheduler {
  private readonly dependencies = new Map<string, Set<string>>();

  private readonly completed = new Set<string>();

  private readonly failed = new Set<string>();

  private readonly scheduled = new Set<string>();

  constructor(workflow: WorkflowDefinition) {
    // Initialize dependency sets for every node.
    for (const node of workflow.nodes) {
      this.dependencies.set(node.id, new Set());
    }

    // Build the dependency graph from workflow edges.
    for (const edge of workflow.edges) {
      this.dependencies.get(edge.target)?.add(edge.source);
    }
  }

  /**
   * Returns nodes whose dependencies have all completed successfully.
   */
  getReadyNodes(): string[] {
    const readyNodes: string[] = [];

    for (const [nodeId, nodeDependencies] of this.dependencies) {
      if (this.scheduled.has(nodeId)) {
        continue;
      }

      // A node cannot execute if any dependency failed.
      const hasFailedDependency = [...nodeDependencies].some((dependencyId) =>
        this.failed.has(dependencyId),
      );

      if (hasFailedDependency) {
        continue;
      }

      // All dependencies must have completed successfully.
      const dependenciesCompleted = [...nodeDependencies].every(
        (dependencyId) => this.completed.has(dependencyId),
      );

      if (dependenciesCompleted) {
        readyNodes.push(nodeId);
      }
    }

    // Reserve these nodes so they cannot be scheduled again.
    for (const nodeId of readyNodes) {
      this.scheduled.add(nodeId);
    }

    return readyNodes;
  }

  /**
   * Marks a node as successfully completed.
   */
  markCompleted(nodeId: string): void {
    this.assertKnownNode(nodeId);

    if (!this.scheduled.has(nodeId)) {
      throw new Error(`Node "${nodeId}" has not been scheduled.`);
    }

    this.completed.add(nodeId);
  }

  /**
   * Marks a node as unsuccessful.
   */
  markFailed(nodeId: string): void {
    this.assertKnownNode(nodeId);

    if (!this.scheduled.has(nodeId)) {
      throw new Error(`Node "${nodeId}" has not been scheduled.`);
    }

    this.failed.add(nodeId);
  }

  /**
   * Checks whether every node has reached a terminal state.
   */
  isComplete(): boolean {
    return this.completed.size + this.failed.size === this.dependencies.size;
  }

  private assertKnownNode(nodeId: string): void {
    if (!this.dependencies.has(nodeId)) {
      throw new Error(`Unknown node ID: "${nodeId}".`);
    }
  }
}
