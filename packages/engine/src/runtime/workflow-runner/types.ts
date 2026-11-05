import type { WorkflowDefinition } from "@circuit/contracts";

export interface WorkflowRunnerOptions {
  workflow: WorkflowDefinition;
  executionId: string;
  workflowVersion: number;
  input?: Record<string, unknown>;
  maxConcurrency?: number;
}
