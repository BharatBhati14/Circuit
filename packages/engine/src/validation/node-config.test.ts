import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "@circuit/contracts";
import { InvalidWorkflowError } from "../errors.js";
import { validateNodeConfig } from "./node-config.js";

function createHttpNode(config: Record<string, unknown>): WorkflowNode {
  return {
    id: "http-1",
    type: "http_request",
    config,
    position: { x: 0, y: 0 },
  };
}

describe("HTTP request node configuration", () => {
  it("accepts a valid GET request without a body", () => {
    expect(() =>
      validateNodeConfig(
        createHttpNode({
          method: "GET",
          url: "https://api.example.com/customers",
        }),
      ),
    ).not.toThrow();
  });

  it("accepts a POST request with headers and a JSON object body", () => {
    expect(() =>
      validateNodeConfig(
        createHttpNode({
          method: "POST",
          url: "https://api.example.com/customers",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer example-token",
          },
          body: { name: "Asha" },
          timeoutMs: 10000,
        }),
      ),
    ).not.toThrow();
  });

  it("rejects unsupported URL protocols", () => {
    expect(() =>
      validateNodeConfig(
        createHttpNode({
          method: "GET",
          url: "ftp://api.example.com/file",
        }),
      ),
    ).toThrow(InvalidWorkflowError);
  });

  it("rejects embedded URL credentials", () => {
    expect(() =>
      validateNodeConfig(
        createHttpNode({
          method: "GET",
          url: "https://user:password@example.com/data",
        }),
      ),
    ).toThrow(InvalidWorkflowError);
  });

  it.each(["GET", "DELETE"] as const)(
    "rejects a body for %s requests",
    (method) => {
      expect(() =>
        validateNodeConfig(
          createHttpNode({
            method,
            url: "https://api.example.com/data",
            body: { name: "Asha" },
          }),
        ),
      ).toThrow(InvalidWorkflowError);
    },
  );

  it.each([
    ["array", ["Asha"]],
    ["string", "Asha"],
    ["number", 123],
    ["boolean", true],
    ["null", null],
  ])("rejects a %s request body", (_label, body) => {
    expect(() =>
      validateNodeConfig(
        createHttpNode({
          method: "POST",
          url: "https://api.example.com/data",
          body,
        }),
      ),
    ).toThrow(InvalidWorkflowError);
  });

  it.each([999, 31000, 1000.5])("rejects invalid timeout %s", (timeoutMs) => {
    expect(() =>
      validateNodeConfig(
        createHttpNode({
          method: "GET",
          url: "https://api.example.com/data",
          timeoutMs,
        }),
      ),
    ).toThrow(InvalidWorkflowError);
  });

  it("accepts the timeout boundaries", () => {
    for (const timeoutMs of [1000, 30000]) {
      expect(() =>
        validateNodeConfig(
          createHttpNode({
            method: "GET",
            url: "https://api.example.com/data",
            timeoutMs,
          }),
        ),
      ).not.toThrow();
    }
  });

  it("rejects unknown configuration fields", () => {
    expect(() =>
      validateNodeConfig(
        createHttpNode({
          method: "GET",
          url: "https://api.example.com/data",
          retries: 5,
        }),
      ),
    ).toThrow(InvalidWorkflowError);
  });

  it("rejects non-string header values", () => {
    expect(() =>
      validateNodeConfig(
        createHttpNode({
          method: "POST",
          url: "https://api.example.com/data",
          headers: {
            "Content-Type": "application/json",
            "X-Count": 123,
          },
        }),
      ),
    ).toThrow(InvalidWorkflowError);
  });
});
