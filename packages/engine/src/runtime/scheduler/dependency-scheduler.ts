import type { WorkflowDefinition } from "@circuit/contracts";

type SchedulerNodeStatus = "SCHEDULED" | "COMPLETED" | "FAILED" | "SKIPPED";

export class DependencyScheduler {
  private readonly dependencies = new Map<string, Set<string>>();

  private readonly statuses = new Map<string, SchedulerNodeStatus>();

  constructor(workflow: WorkflowDefinition) {
    for (const node of workflow.nodes) {
      this.dependencies.set(node.id, new Set());
    }

    for (const edge of workflow.edges) {
      this.dependencies.get(edge.target)?.add(edge.source);
    }
  }

  getReadyNodes(): string[] {
    this.propagateSkippedNodes();

    const readyNodes: string[] = [];

    for (const [nodeId, nodeDependencies] of this.dependencies) {
      if (this.statuses.has(nodeId)) continue;

      const dependenciesCompleted = [...nodeDependencies].every(
        (dependencyId) => this.statuses.get(dependencyId) === "COMPLETED",
      );

      if (dependenciesCompleted) {
        readyNodes.push(nodeId);
      }
    }

    for (const nodeId of readyNodes) {
      this.statuses.set(nodeId, "SCHEDULED");
    }

    return readyNodes;
  }

  markCompleted(nodeId: string): void {
    this.assertScheduled(nodeId);
    this.statuses.set(nodeId, "COMPLETED");
    this.propagateSkippedNodes();
  }

  markFailed(nodeId: string): void {
    this.assertScheduled(nodeId);
    this.statuses.set(nodeId, "FAILED");
    this.propagateSkippedNodes();
  }

  markSkipped(nodeId: string): void {
    this.assertScheduled(nodeId);
    this.statuses.set(nodeId, "SKIPPED");
    this.propagateSkippedNodes();
  }

  getStatus(nodeId: string): SchedulerNodeStatus | undefined {
    this.assertKnownNode(nodeId);
    return this.statuses.get(nodeId);
  }

  isComplete(): boolean {
    return this.statuses.size === this.dependencies.size;
  }

  private propagateSkippedNodes(): void {
    let changed = true;

    while (changed) {
      changed = false;

      for (const [nodeId, nodeDependencies] of this.dependencies) {
        if (this.statuses.has(nodeId)) continue;

        const hasBlockedDependency = [...nodeDependencies].some(
          (dependencyId) => {
            const status = this.statuses.get(dependencyId);

            return status === "FAILED" || status === "SKIPPED";
          },
        );

        if (hasBlockedDependency) {
          this.statuses.set(nodeId, "SKIPPED");
          changed = true;
        }
      }
    }
  }

  private assertKnownNode(nodeId: string): void {
    if (!this.dependencies.has(nodeId)) {
      throw new Error(`Unknown node ID: "${nodeId}".`);
    }
  }

  private assertScheduled(nodeId: string): void {
    this.assertKnownNode(nodeId);

    const status = this.statuses.get(nodeId);

    if (status === undefined) {
      throw new Error(`Node "${nodeId}" has not been scheduled.`);
    }

    if (status !== "SCHEDULED") {
      throw new Error(`Node "${nodeId}" has already reached a terminal state.`);
    }
  }
}
