import { describe, it, expect } from "vitest";

import {
  hasIdempotencyKey,
  canRetryHttpRequest,
} from "./idempotency-policy.js";

import type { HttpTransportRequest } from "./http-transport.js";

function createRequest(
  method: HttpTransportRequest["method"],
  headers?: HttpTransportRequest["headers"],
): HttpTransportRequest {
  return {
    url: new URL("https://example.com"),
    method,
    timeoutMs: 10_000,
    headers,
  };
}

describe("hasIdempotencyKey", () => {
  it("recognizes an Idempotency-Key header", () => {
    expect(hasIdempotencyKey({ "Idempotency-Key": "request-123" })).toBe(true);
  });

  it("recognizes case-insensitive header names", () => {
    expect(hasIdempotencyKey({ "IDEMPOTENCY-KEY": "request-123" })).toBe(true);
  });

  it("rejects an empty idempotency key", () => {
    expect(hasIdempotencyKey({ "Idempotency-Key": "   " })).toBe(false);
  });

  it("returns false when headers are missing", () => {
    expect(hasIdempotencyKey(undefined)).toBe(false);
  });
});

describe("canRetryHttpRequest", () => {
  it.each(["GET", "PUT", "DELETE"] as const)(
    "allows automatic retries for %s",
    (method) => {
      expect(canRetryHttpRequest(createRequest(method))).toEqual({
        allowed: true,
      });
    },
  );

  it.each(["POST", "PATCH"] as const)(
    "rejects %s without an idempotency key",
    (method) => {
      const result = canRetryHttpRequest(createRequest(method));

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Idempotency-Key");
    },
  );

  it.each(["POST", "PATCH"] as const)(
    "allows %s with an idempotency key",
    (method) => {
      const result = canRetryHttpRequest(
        createRequest(method, {
          "Idempotency-Key": "request-123",
        }),
      );

      expect(result).toEqual({ allowed: true });
    },
  );

  it("rejects unsupported HTTP methods", () => {
    const request = {
      ...createRequest("GET"),
      method: "HEAD",
    } as unknown as HttpTransportRequest;

    const result = canRetryHttpRequest(request);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("HEAD");
  });
});
