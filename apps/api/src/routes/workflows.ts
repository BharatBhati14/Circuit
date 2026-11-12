import { FastifyInstance } from "fastify";
import {
  createWorkflowWithVersion,
  createWorkflowExecution,
} from "@circuit/db";
import { workflowQueue } from "../queues/workflow.queue.js";
import { WorkflowSchedulerService } from "../services/scheduler.service.js";
import type { WorkflowDefinition } from "@circuit/contracts";

const schedulerService = new WorkflowSchedulerService(workflowQueue);

export async function workflowRoutes(fastify: FastifyInstance) {
  // 1. Create a Workflow with initial version & DAG definition
  fastify.post("/workflows", async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      definition: WorkflowDefinition;
    };

    try {
      const { workflow, version } = await createWorkflowWithVersion(
        body.name,
        body.description,
        body.definition,
      );

      // Synchronize schedule triggers with BullMQ Job Schedulers
      await schedulerService.syncWorkflowSchedules(version.id, body.definition);

      return reply.status(201).send({ success: true, workflow, version });
    } catch (error) {
      fastify.log.error(error);
      return reply
        .status(500)
        .send({ success: false, error: "Failed to create workflow" });
    }
  });

  // 2. Trigger Workflow Execution (Persist QUEUED state & enqueue in BullMQ)
  fastify.post("/workflows/:versionId/execute", async (request, reply) => {
    const { versionId } = request.params as { versionId: string };

    try {
      const execution = await createWorkflowExecution(versionId);

      await workflowQueue.add("execute-workflow", {
        executionId: execution.id,
        workflowVersionId: versionId,
      });

      return reply.status(202).send({
        success: true,
        message: "Workflow execution queued successfully",
        executionId: execution.id,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply
        .status(500)
        .send({ success: false, error: "Failed to queue workflow execution" });
    }
  });

  // #################========================

  // Webhook Route Handler for Fastify
  fastify.post("/webhooks/:versionId", async (request, reply) => {
    const { versionId } = request.params as { versionId: string };

    try {
      // 1. Create a workflow execution record in the database first
      const execution = await createWorkflowExecution(versionId);

      // 2. Package incoming request context
      const triggerInput = {
        body: request.body,
        headers: request.headers,
        query: request.query,
        method: request.method,
      };

      // 3. Enqueue job with correct BullMQ arguments (name, data)
      await workflowQueue.add("execute-workflow", {
        executionId: execution.id,
        workflowVersionId: versionId,
        triggerInput,
      });

      return reply.status(202).send({
        success: true,
        message: "Webhook workflow execution queued successfully",
        executionId: execution.id,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
}
