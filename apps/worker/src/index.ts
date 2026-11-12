import { Worker } from "bullmq";
import { redisConnection } from "./config/redis.js";
import { processWorkflowExecution } from "./processors/workflow.processor.js";

const worker = new Worker("workflow-executions", processWorkflowExecution, {
  connection: redisConnection,
});

worker.on("ready", () => {
  console.log(
    "👷 Circuit background worker is running and listening for jobs...",
  );
});

worker.on("error", (err) => {
  console.error("❌ Worker error:", err);
});
