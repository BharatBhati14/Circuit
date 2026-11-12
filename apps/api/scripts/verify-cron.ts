import { workflowQueue } from "../src/queues/workflow.queue.js";
import { WorkflowSchedulerService } from "../src/services/scheduler.service.js";
import { createWorkflowWithVersion } from "@circuit/db";
import type { WorkflowDefinition } from "@circuit/contracts";

async function verifyCronScheduling() {
  console.log("🧪 Starting End-to-End Cron Scheduling Verification...\n");

  const schedulerService = new WorkflowSchedulerService(workflowQueue);

  // 1. Define a mock workflow containing a schedule_trigger node
  const mockWorkflowDefinition: WorkflowDefinition = {
    id: "workflow-test-1",
    name: "Test Cron Automation",
    nodes: [
      {
        id: "node-schedule-1",
        type: "schedule_trigger",
        config: {
          cron: "0 * * * *", // Every hour
          timezone: "UTC",
        },
        position: { x: 0, y: 0 },
      },
      {
        id: "node-http-1",
        type: "http_request",
        config: {
          url: "https://httpbin.org/get",
          method: "GET",
        },
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "node-schedule-1",
        target: "node-http-1",
      },
    ],
  };

  try {
    // 2. Create workflow and version in PostgreSQL
    console.log("📝 Creating test workflow and version in PostgreSQL...");
    const { workflow, version } = await createWorkflowWithVersion(
      "Test Cron Automation",
      "Created via E2E verification script",
      mockWorkflowDefinition,
    );
    console.log(`✅ Created Workflow ID: ${workflow.id}`);
    console.log(`✅ Created Version ID: ${version.id}\n`);

    // 3. Synchronize schedules (Registers with BullMQ Job Schedulers)
    console.log("⚙️ Synchronizing schedules with BullMQ...");
    await schedulerService.syncWorkflowSchedules(
      version.id,
      mockWorkflowDefinition,
    );

    // 4. Verify the job scheduler exists in Redis via BullMQ using direct lookup
    console.log("\n🔍 Inspecting BullMQ Job Scheduler in Redis...");
    const targetSchedulerId = `cron:${version.id}:node-schedule-1`;
    const registeredScheduler =
      await workflowQueue.getJobScheduler(targetSchedulerId);

    if (registeredScheduler) {
      console.log(`🎉 SUCCESS: Found registered BullMQ Job Scheduler!`);
      console.log(`   - Key/ID: ${targetSchedulerId}`);
      console.log(`   - Pattern: ${registeredScheduler.pattern}`);
      console.log(`   - Timezone: ${registeredScheduler.tz}`);
    } else {
      console.error(
        `❌ FAILURE: Job scheduler ${targetSchedulerId} was not found in Redis.`,
      );
    }

    // 5. Clean up test data and schedulers
    console.log("\n🧹 Cleaning up test schedules...");
    await schedulerService.removeWorkflowSchedules(version.id);
    console.log("✅ Cleanup complete.");
  } catch (error) {
    console.error("❌ Verification failed with error:", error);
  } finally {
    // Close Redis / BullMQ connections cleanly
    await workflowQueue.close();
    process.exit(0);
  }
}

verifyCronScheduling();
