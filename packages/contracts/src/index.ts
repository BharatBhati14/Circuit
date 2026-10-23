export type WorkflowNodeType =
  | "manual_trigger"
  | "webhook_trigger"
  | "http_request"
  | "data_transform";

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

// Result produced by executing a single workflow node.
export type NodeExecutionResult = NodeExecutionSuccess | NodeExecutionFailure;
