import { ExecutorRegistry } from "./registry.js";
import { HttpRequestExecutor } from "./executors/http-request.js";
import { DataTransformExecutor } from "./executors/data-transform.js";
import { ConditionExecutor } from "./executors/condition.js";
import { DelayExecutor } from "./executors/delay.js";
import { TriggerExecutor } from "./executors/trigger.js";

export function registerExecutors(): ExecutorRegistry {
  const registry = new ExecutorRegistry();

  registry.register(new TriggerExecutor("manual_trigger"));
  registry.register(new TriggerExecutor("webhook_trigger"));

  // Register all built-in node executors
  registry.register(new HttpRequestExecutor());
  registry.register(new DataTransformExecutor());
  registry.register(new ConditionExecutor());
  registry.register(new DelayExecutor());

  return registry;
}
