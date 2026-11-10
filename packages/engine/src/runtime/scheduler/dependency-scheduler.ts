import type { WorkflowDefinition } from "@circuit/contracts";

type SchedulerNodeStatus =
  | "SCHEDULED"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED"
  | "CANCELLED";

export class DependencyScheduler {
  private readonly dependencies = new Map<string, Set<string>>();

  private readonly statuses = new Map<string, SchedulerNodeStatus>();

  private cancellationRequested = false;

  constructor(workflow: WorkflowDefinition) {
    for (const node of workflow.nodes) {
      this.dependencies.set(node.id, new Set());
    }

    for (const edge of workflow.edges) {
      this.dependencies.get(edge.target)?.add(edge.source);
    }
  }

  getReadyNodes(limit = Number.MAX_SAFE_INTEGER): string[] {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError(
        "Concurrency limit must be a positive safe integer.",
      );
    }

    this.propagateSkippedNodes();

    if (this.cancellationRequested) {
      return [];
    }

    const readyNodes: string[] = [];

    for (const [nodeId, nodeDependencies] of this.dependencies) {
      if (readyNodes.length >= limit) {
        break;
      }

      if (this.statuses.has(nodeId)) continue;

      const dependenciesCompleted = [...nodeDependencies].every(
        (dependencyId) => this.statuses.get(dependencyId) === "COMPLETED",
      );

      if (dependenciesCompleted) {
        readyNodes.push(nodeId);
      }
    }

    for (const nodeId of readyNodes) {
      this.validateTransition(nodeId, "SCHEDULED");
      this.statuses.set(nodeId, "SCHEDULED");
    }

    return readyNodes;
  }

  markCompleted(nodeId: string): void {
    this.assertScheduled(nodeId);
    this.validateTransition(nodeId, "COMPLETED");
    this.statuses.set(nodeId, "COMPLETED");
    this.propagateSkippedNodes();
  }

  markFailed(nodeId: string): void {
    this.assertScheduled(nodeId);
    this.validateTransition(nodeId, "FAILED");
    this.statuses.set(nodeId, "FAILED");
    this.propagateSkippedNodes();
  }

  markSkipped(nodeId: string): void {
    this.assertScheduled(nodeId);
    this.validateTransition(nodeId, "SKIPPED");
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

  markCancelled(nodeId: string): void {
    this.assertScheduled(nodeId);
    this.validateTransition(nodeId, "CANCELLED");
    this.statuses.set(nodeId, "CANCELLED");
  }

  cancelPendingNodes(): void {
    this.cancellationRequested = true;

    for (const nodeId of this.dependencies.keys()) {
      // Already scheduled nodes may still be executing.
      // Their cancellation will be recorded when they settle.
      if (this.statuses.has(nodeId)) continue;

      this.validateTransition(nodeId, "CANCELLED");
      this.statuses.set(nodeId, "CANCELLED");
    }
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
          this.validateTransition(nodeId, "SKIPPED");
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

  private validateTransition(
    nodeId: string,
    targetStatus: SchedulerNodeStatus,
  ): void {
    const currentStatus = this.statuses.get(nodeId);

    if (currentStatus === targetStatus) {
      return;
    }

    const terminalStates: SchedulerNodeStatus[] = [
      "COMPLETED",
      "FAILED",
      "SKIPPED",
      "CANCELLED",
    ];

    if (currentStatus && terminalStates.includes(currentStatus)) {
      throw new Error(
        `Invalid state transition for node "${nodeId}": cannot transition from terminal state "${currentStatus}" to "${targetStatus}".`,
      );
    }
  }
}
