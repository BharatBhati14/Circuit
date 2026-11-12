import { Queue } from "bullmq";
import { WorkflowDefinition } from "@circuit/contracts";

export class WorkflowSchedulerService {
  constructor(private workflowQueue: Queue) {}

  /**
   * Synchronizes schedule triggers for a workflow version using BullMQ Job Schedulers.
   */
  async syncWorkflowSchedules(
    versionId: string,
    definition: WorkflowDefinition,
  ) {
    // 1. Clean up any existing schedulers for this version first
    await this.removeWorkflowSchedules(versionId);

    // 2. Find all schedule_trigger nodes in the DAG
    const scheduleNodes = definition.nodes.filter(
      (node) => node.type === "schedule_trigger",
    );

    if (scheduleNodes.length === 0) {
      console.log(`ℹ️ No schedule triggers found for version: ${versionId}`);
      return;
    }

    // 3. Register each schedule using Job Schedulers
    for (const node of scheduleNodes) {
      const config = node.config as { cron: string; timezone?: string };

      if (!config || !config.cron) {
        console.warn(
          `⚠️ Schedule node ${node.id} in version ${versionId} is missing cron config.`,
        );
        continue;
      }

      const schedulerId = `cron:${versionId}:${node.id}`;

      await this.workflowQueue.upsertJobScheduler(
        schedulerId,
        {
          pattern: config.cron,
          tz: config.timezone || "UTC",
        },
        {
          name: "scheduled-workflow-execution",
          data: {
            versionId,
            triggerNodeId: node.id,
            triggerType: "cron",
          },
        },
      );

      console.log(
        `⏰ Upserted cron job scheduler [${config.cron}] for workflow version: ${versionId} (Node: ${node.id})`,
      );
    }
  }

  /**
   * Removes active job schedulers associated with a workflow version.
   */
  async removeWorkflowSchedules(versionId: string) {
    const schedulers = await this.workflowQueue.getJobSchedulers();

    // Filter schedulers belonging to this specific version ID prefix
    const versionSchedulers = schedulers.filter(
      (scheduler) =>
        scheduler.id && scheduler.id.startsWith(`cron:${versionId}:`),
    );

    for (const scheduler of versionSchedulers) {
      if (!scheduler.id) continue;

      await this.workflowQueue.removeJobScheduler(scheduler.id);
      console.log(`🗑️ Removed cron job scheduler ID: ${scheduler.id}`);
    }
  }
}
