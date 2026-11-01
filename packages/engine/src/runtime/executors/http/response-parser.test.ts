import { describe, expect, it } from "vitest";

import {
  InvalidJsonResponseError,
  parseResponseBody,
} from "./response-parser.js";

describe("parseResponseBody", () => {
  it("returns null for an empty response", () => {
    expect(parseResponseBody(Buffer.alloc(0), "application/json")).toEqual({
      type: "empty",
      value: null,
    });
  });

  it("parses application/json responses", () => {
    const body = Buffer.from('{"message":"hello"}');

    expect(parseResponseBody(body, "application/json")).toEqual({
      type: "json",
      value: { message: "hello" },
    });
  });

  it("parses JSON with charset parameters", () => {
    const body = Buffer.from('{"success":true}');

    expect(parseResponseBody(body, "application/json; charset=utf-8")).toEqual({
      type: "json",
      value: { success: true },
    });
  });

  it("parses application/problem+json responses", () => {
    const body = Buffer.from('{"title":"Not Found"}');

    expect(parseResponseBody(body, "application/problem+json")).toEqual({
      type: "json",
      value: { title: "Not Found" },
    });
  });

  it("parses other application +json media types", () => {
    const body = Buffer.from('{"data":123}');

    expect(parseResponseBody(body, "application/vnd.api+json")).toEqual({
      type: "json",
      value: { data: 123 },
    });
  });

  it("returns text for text/plain responses", () => {
    const body = Buffer.from("Hello Circuit");

    expect(parseResponseBody(body, "text/plain")).toEqual({
      type: "text",
      value: "Hello Circuit",
    });
  });

  it("returns text for text/html responses", () => {
    const body = Buffer.from("<h1>Hello</h1>");

    expect(parseResponseBody(body, "text/html")).toEqual({
      type: "text",
      value: "<h1>Hello</h1>",
    });
  });

  it("returns Base64 for unknown content types", () => {
    const body = Buffer.from([0, 1, 2, 3]);

    expect(parseResponseBody(body, "application/octet-stream")).toEqual({
      type: "binary",
      value: "AAECAw==",
    });
  });

  it("returns Base64 when Content-Type is missing", () => {
    const body = Buffer.from("unknown");

    expect(parseResponseBody(body, undefined)).toEqual({
      type: "binary",
      value: "dW5rbm93bg==",
    });
  });

  it("rejects malformed JSON responses", () => {
    const body = Buffer.from('{"message":');

    expect(() => parseResponseBody(body, "application/json")).toThrow(
      InvalidJsonResponseError,
    );
  });

  it("handles case-insensitive content types", () => {
    const body = Buffer.from('{"ok":true}');

    expect(parseResponseBody(body, "APPLICATION/JSON")).toEqual({
      type: "json",
      value: { ok: true },
    });
  });
});
