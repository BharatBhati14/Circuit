import { describe, expect, it } from "vitest";
import { registerExecutors } from "../register-executors.js";

describe("registerExecutors", () => {
  it("registers all built-in node executors", () => {
    const registry = registerExecutors();

    expect(registry.has("http_request")).toBe(true);
    expect(registry.has("data_transform")).toBe(true);
    expect(registry.has("condition")).toBe(true);
    expect(registry.has("delay")).toBe(true);
  });

  it("returns a new registry for each invocation", () => {
    const firstRegistry = registerExecutors();
    const secondRegistry = registerExecutors();

    expect(firstRegistry).not.toBe(secondRegistry);
  });

  it("registers independent executor instances", () => {
    const firstRegistry = registerExecutors();
    const secondRegistry = registerExecutors();

    expect(firstRegistry.get("http_request")).not.toBe(
      secondRegistry.get("http_request"),
    );
  });
});
