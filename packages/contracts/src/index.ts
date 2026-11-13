export type WorkflowNodeType =
  | "manual_trigger"
  | "webhook_trigger"
  | "schedule_trigger"
  | "http_request"
  | "data_transform"
  | "condition"
  | "delay";

export interface ScheduleTriggerConfig {
  cron: string; // Standard cron expression (e.g., "0 * * * *" or "*/15 * * * *")
  timezone?: string; // IANA timezone string (e.g., "UTC", "America/New_York")
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  config: Record<string, unknown>;
  position: {
    x: number;
    y: number;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// condition node
export type ComparisonOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "greater_than"
  | "less_than";

export interface ConditionRule {
  field: string; // Key/path to evaluate from upstream outputs (e.g. "status" or "body.code")
  operator: ComparisonOperator;
  value: string | number | boolean;
}

export interface ConditionConfig {
  rules: ConditionRule[];
  logicalOperator?: "AND" | "OR"; // Default to AND if omitted
}

export type ExecutionStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type NodeExecutionStatus =
  | "PENDING"
  | "RUNNING"
  | "RETRYING"
  | "SUCCESS"
  | "FAILED"
  | "SKIPPED"
  | "CANCELLED";

/**
 * Data available to a node while it executes.
 *
 * `input` contains data supplied to the current node.
 * `previousOutputs` contains outputs from upstream nodes, keyed by their node IDs.
 */

export interface NodeExecutionContext {
  executionId: string;
  workflowId: string;
  workflowVersion: number;
  nodeId: string;
  attempt: number;
  input: Record<string, unknown>;
  previousOutputs: Record<string, unknown>;

  signal?: AbortSignal;
}

// Successful result returned by a node executor.
export interface NodeExecutionSuccess {
  status: "SUCCESS";
  output: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
}

// Failed result returned by a node executor.

export interface NodeExecutionFailure {
  status: "FAILED";
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
  startedAt: string;
  finishedAt: string;
}

export interface NodeExecutionCancelled {
  status: "CANCELLED";
  reason?: string;
  startedAt: string;
  finishedAt: string;
}

export interface NodeExecutionSkipped {
  status: "SKIPPED";
  reason: string;
  startedAt: string;
  finishedAt: string;
}

// Result produced by executing a single workflow node.
export type NodeExecutionResult =
  | NodeExecutionSuccess
  | NodeExecutionFailure
  | NodeExecutionCancelled
  | NodeExecutionSkipped;

export interface WorkflowExecutionResult {
  executionId: string;
  workflowId: string;
  workflowVersion: number;

  status: ExecutionStatus;

  nodeResults: Record<string, NodeExecutionResult>;

  startedAt: string;
  finishedAt: string;
}
