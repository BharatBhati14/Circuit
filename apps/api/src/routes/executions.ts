import { FastifyInstance } from "fastify";
import { db } from "@circuit/db";
import { workflowExecutions, nodeExecutions } from "@circuit/db/schema";
import { eq } from "drizzle-orm";

export async function executionRoutes(fastify: FastifyInstance) {
  // Get Execution Status
  fastify.get("/executions/:executionId", async (request, reply) => {
    const { executionId } = request.params as { executionId: string };

    try {
      const [execution] = await db
        .select()
        .from(workflowExecutions)
        .where(eq(workflowExecutions.id, executionId));

      if (!execution) {
        return reply
          .status(404)
          .send({ success: false, error: "Execution not found" });
      }

      return reply.send({ success: true, execution });
    } catch (error) {
      fastify.log.error(error);
      return reply
        .status(500)
        .send({ success: false, error: "Failed to fetch execution" });
    }
  });

  // Get Node Execution Audit Logs
  fastify.get("/executions/:executionId/nodes", async (request, reply) => {
    const { executionId } = request.params as { executionId: string };

    try {
      const nodes = await db
        .select()
        .from(nodeExecutions)
        .where(eq(nodeExecutions.executionId, executionId));

      return reply.send({ success: true, nodes });
    } catch (error) {
      fastify.log.error(error);
      return reply
        .status(500)
        .send({ success: false, error: "Failed to fetch node audit logs" });
    }
  });
}
