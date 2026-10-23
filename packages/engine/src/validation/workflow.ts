import type { WorkflowDefinition } from "@circuit/contracts";
import { createExecutionPlan } from "../graph/plan.js";
import { validateNodeConfig } from "./node-config.js";

export function validateWorkflow(workflow: WorkflowDefinition): string[] {
  const plan = createExecutionPlan(workflow);

  for (const node of workflow.nodes) {
    validateNodeConfig(node);
  }

  return plan;
}
