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
