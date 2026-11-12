import Fastify from "fastify";
import { workflowRoutes } from "./routes/workflows.js";
import { executionRoutes } from "./routes/executions.js";

const fastify = Fastify({ logger: true });

// Health check route
fastify.get("/", async (_request, reply) => {
  return {
    success: true,
    hello: "Welcome to Circuit - Visual Workflow Automation Platform",
  };
});

// Register modular routes
fastify.register(workflowRoutes);
fastify.register(executionRoutes);

const start = async () => {
  try {
    await fastify.listen({ port: 4000 });
    fastify.log.info("Circuit API server is running on http://localhost:4000");
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

start();
