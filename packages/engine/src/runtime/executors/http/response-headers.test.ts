import { describe, expect, it } from "vitest";

import {
  InvalidResponseHeadersError,
  normalizeResponseHeaders,
} from "./response-headers.js";

describe("normalizeResponseHeaders", () => {
  it("normalizes header names to lowercase", () => {
    const result = normalizeResponseHeaders({
      "Content-Type": "application/json",
      Authorization: "Bearer token",
      "X-Custom-Header": "Circuit",
    });

    expect(result).toEqual({
      "content-type": "application/json",
      authorization: "Bearer token",
      "x-custom-header": "Circuit",
    });
  });

  it("preserves multiple headers", () => {
    const result = normalizeResponseHeaders({
      "content-type": "application/json",
      "cache-control": "no-cache",
      server: "nginx",
    });

    expect(Object.keys(result)).toHaveLength(3);
  });

  it("preserves array values without joining them", () => {
    const result = normalizeResponseHeaders({
      "set-cookie": ["session=abc; HttpOnly", "theme=dark; Secure"],
    });

    expect(result["set-cookie"]).toEqual([
      "session=abc; HttpOnly",
      "theme=dark; Secure",
    ]);
  });

  it("omits headers with undefined values", () => {
    const result = normalizeResponseHeaders({
      "content-type": "application/json",
      "x-optional": undefined,
    });

    expect(result).toEqual({
      "content-type": "application/json",
    });

    expect(result).not.toHaveProperty("x-optional");
  });

  it("preserves empty string values", () => {
    const result = normalizeResponseHeaders({
      "x-empty": "",
    });

    expect(result["x-empty"]).toBe("");
  });

  it("preserves empty array values", () => {
    const result = normalizeResponseHeaders({
      "set-cookie": [],
    });

    expect(result["set-cookie"]).toEqual([]);
  });

  it("throws when header names differ only by case", () => {
    expect(() =>
      normalizeResponseHeaders({
        "Content-Type": "application/json",
        "content-type": "text/plain",
      }),
    ).toThrow(InvalidResponseHeadersError);
  });

  it("does not mutate the original headers object", () => {
    const headers = {
      "Content-Type": "application/json",
      "X-Custom": "Circuit",
    };

    const originalHeaders = { ...headers };

    normalizeResponseHeaders(headers);

    expect(headers).toEqual(originalHeaders);
  });

  it("safely preserves __proto__ as a normal header key", () => {
    const headers = Object.create(null) as Record<string, string | undefined>;

    headers["__proto__"] = "safe-value";

    const result = normalizeResponseHeaders(headers);

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result["__proto__"]).toBe("safe-value");
    expect(Object.getPrototypeOf(result)).toBeNull();
  });

  it("does not confuse constructor with an inherited property", () => {
    const headers = Object.create(null) as Record<string, string | undefined>;

    headers["constructor"] = "custom-value";

    const result = normalizeResponseHeaders(headers);

    expect(result.constructor).toBe("custom-value");
    expect(Object.hasOwn(result, "constructor")).toBe(true);
  });
});
