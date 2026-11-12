import { ExecutorRegistry } from "./registry.js";
import { HttpRequestExecutor } from "./executors/http-request.js";
import { DataTransformExecutor } from "./executors/data-transform.js";
import { ConditionExecutor } from "./executors/condition.js";
import { DelayExecutor } from "./executors/delay.js";

export function registerExecutors(): ExecutorRegistry {
  const registry = new ExecutorRegistry();

  // Register all built-in node executors
  registry.register(new HttpRequestExecutor());
  registry.register(new DataTransformExecutor());
  registry.register(new ConditionExecutor());
  registry.register(new DelayExecutor());

  return registry;
}
