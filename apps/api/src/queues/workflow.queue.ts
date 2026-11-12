import { env } from "@circuit/config";
import { Queue } from "bullmq";

const redisConnection = {
  host: env.REDIS_HOST ?? "localhost",
  port: Number(env.REDIS_PORT ?? 6379),
};

export const workflowQueue = new Queue("workflow-executions", {
  connection: redisConnection,
});
