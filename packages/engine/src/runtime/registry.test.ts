import { describe, expect, it } from "vitest";
import { InvalidWorkflowError } from "../errors.js";
import { ExecutorRegistry } from "./registry.js";
import type { NodeExecutor } from "./types.js";

function createExecutor(type: NodeExecutor["type"]): NodeExecutor {
  return {
    type,
    async execute() {
      return {
        status: "SUCCESS",
        output: {},
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
      };
    },
  };
}

describe("ExecutorRegistry", () => {
  it("registers and retrieves an executor", () => {
    const registry = new ExecutorRegistry();
    const executor = createExecutor("manual_trigger");

    registry.register(executor);

    expect(registry.get("manual_trigger")).toBe(executor);
    expect(registry.has("manual_trigger")).toBe(true);
  });

  it("rejects duplicate registrations", () => {
    const registry = new ExecutorRegistry();

    registry.register(createExecutor("http_request"));

    expect(() => registry.register(createExecutor("http_request"))).toThrow(
      InvalidWorkflowError,
    );
  });

  it("rejects lookups for unregistered executors", () => {
    const registry = new ExecutorRegistry();

    expect(() => registry.get("data_transform")).toThrow(InvalidWorkflowError);
  });

  it("reports false for unregistered executor types", () => {
    const registry = new ExecutorRegistry();

    expect(registry.has("webhook_trigger")).toBe(false);
  });
});
