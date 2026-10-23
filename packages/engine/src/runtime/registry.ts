import type { WorkflowNodeType } from "@circuit/contracts";
import { InvalidWorkflowError } from "../errors.js";
import type { NodeExecutor } from "./types.js";

export class ExecutorRegistry {
  private readonly executors = new Map<WorkflowNodeType, NodeExecutor>();

  register(executor: NodeExecutor): void {
    if (this.executors.has(executor.type)) {
      throw new InvalidWorkflowError(
        `An executor for node type "${executor.type}" is already registered.`,
      );
    }

    this.executors.set(executor.type, executor);
  }

  get(type: WorkflowNodeType): NodeExecutor {
    const executor = this.executors.get(type);

    if (!executor) {
      throw new InvalidWorkflowError(
        `No executor registered for node type "${type}".`,
      );
    }

    return executor;
  }

  has(type: WorkflowNodeType): boolean {
    return this.executors.has(type);
  }
}
