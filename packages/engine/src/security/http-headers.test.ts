import { describe, expect, it } from "vitest";

import {
  InvalidHttpHeadersError,
  MAX_HTTP_HEADER_COUNT,
  MAX_HTTP_HEADER_NAME_BYTES,
  MAX_HTTP_HEADER_VALUE_BYTES,
  MAX_HTTP_HEADERS_TOTAL_BYTES,
  validateHttpHeaders,
} from "./http-headers.js";

describe("validateHttpHeaders", () => {
  describe("valid headers", () => {
    it("accepts undefined headers", () => {
      expect(() => validateHttpHeaders()).not.toThrow();
    });

    it("accepts an empty headers object", () => {
      expect(() => validateHttpHeaders({})).not.toThrow();
    });

    it("accepts standard HTTP headers", () => {
      expect(() =>
        validateHttpHeaders({
          "content-type": "application/json",
          authorization: "Bearer token",
          accept: "application/json",
          "x-request-id": "request-123",
        }),
      ).not.toThrow();
    });

    it("accepts valid HTTP token characters in header names", () => {
      expect(() =>
        validateHttpHeaders({
          "!#$%&'*+-.^_`|~0123456789": "valid",
          "X-Custom_Header": "value",
        }),
      ).not.toThrow();
    });

    it("accepts values containing ordinary spaces and tabs", () => {
      expect(() =>
        validateHttpHeaders({
          authorization: "Bearer token",
          "x-custom": "value with spaces\tand tabs",
        }),
      ).not.toThrow();
    });
  });

  describe("invalid header names", () => {
    it.each([
      "",
      "invalid header",
      "content type",
      "bad:name",
      "bad/name",
      "bad(name)",
      "bad[name]",
    ])("rejects invalid header name: %s", (name) => {
      expect(() =>
        validateHttpHeaders({
          [name]: "value",
        }),
      ).toThrow("Invalid HTTP header name");
    });
  });

  describe("Host header protection", () => {
    it.each(["Host", "host", "HOST", "hOsT"])(
      "rejects the %s header",
      (name) => {
        expect(() =>
          validateHttpHeaders({
            [name]: "attacker.example.com",
          }),
        ).toThrow("The Host header cannot be overridden.");
      },
    );
  });

  describe("header value validation", () => {
    it("rejects carriage return characters", () => {
      expect(() =>
        validateHttpHeaders({
          "x-custom": "value\rInjected: true",
        }),
      ).toThrow("contains invalid newline characters");
    });

    it("rejects line feed characters", () => {
      expect(() =>
        validateHttpHeaders({
          "x-custom": "value\nInjected: true",
        }),
      ).toThrow("contains invalid newline characters");
    });

    it("rejects CRLF injection", () => {
      expect(() =>
        validateHttpHeaders({
          "x-custom": "value\r\nInjected: true",
        }),
      ).toThrow("contains invalid newline characters");
    });

    it("rejects non-string header values at runtime", () => {
      const headers = {
        "x-custom": 123,
      } as unknown as Record<string, string>;

      expect(() => validateHttpHeaders(headers)).toThrow(
        'HTTP header "x-custom" must have a string value.',
      );
    });

    it("rejects null header values at runtime", () => {
      const headers = {
        "x-custom": null,
      } as unknown as Record<string, string>;

      expect(() => validateHttpHeaders(headers)).toThrow(
        'HTTP header "x-custom" must have a string value.',
      );
    });
  });

  describe("invalid headers container", () => {
    it("rejects null", () => {
      expect(() =>
        validateHttpHeaders(null as unknown as Record<string, string>),
      ).toThrow("HTTP headers must be an object.");
    });

    it("rejects arrays", () => {
      expect(() =>
        validateHttpHeaders([] as unknown as Record<string, string>),
      ).toThrow("HTTP headers must be an object.");
    });
  });
});

describe("HTTP header resource limits", () => {
  it("accepts exactly 50 headers", () => {
    const headers = Object.fromEntries(
      Array.from({ length: MAX_HTTP_HEADER_COUNT }, (_, index) => [
        `x-${index}`,
        "value",
      ]),
    );

    expect(() => validateHttpHeaders(headers)).not.toThrow();
  });

  it("rejects more than 50 headers", () => {
    const headers = Object.fromEntries(
      Array.from({ length: MAX_HTTP_HEADER_COUNT + 1 }, (_, index) => [
        `x-${index}`,
        "value",
      ]),
    );

    expect(() => validateHttpHeaders(headers)).toThrow(InvalidHttpHeadersError);
  });

  it("accepts a header name of exactly 256 bytes", () => {
    const name = "x".repeat(256);

    expect(() => validateHttpHeaders({ [name]: "value" })).not.toThrow();
  });

  it("rejects a header name exceeding 256 bytes", () => {
    const name = "x".repeat(257);

    expect(() => validateHttpHeaders({ [name]: "value" })).toThrow(
      InvalidHttpHeadersError,
    );
  });

  it("accepts a header value of exactly 8192 bytes", () => {
    const value = "a".repeat(MAX_HTTP_HEADER_VALUE_BYTES);

    expect(() => validateHttpHeaders({ "x-test": value })).not.toThrow();
  });

  it("rejects a header value exceeding 8192 bytes", () => {
    const value = "a".repeat(MAX_HTTP_HEADER_VALUE_BYTES + 1);

    expect(() => validateHttpHeaders({ "x-test": value })).toThrow(
      InvalidHttpHeadersError,
    );
  });

  it("measures header values using UTF-8 bytes", () => {
    // Each emoji occupies 4 UTF-8 bytes.
    const value = "😀".repeat(2049);

    expect(Buffer.byteLength(value, "utf8")).toBe(8196);

    expect(() => validateHttpHeaders({ "x-test": value })).toThrow(
      InvalidHttpHeadersError,
    );
  });

  it("accepts a total serialized header size of exactly 32768 bytes", () => {
    const headers = {
      a: "a".repeat(8187),
      b: "b".repeat(8187),
      c: "c".repeat(8186),
      d: "d".repeat(8186),
    };

    expect(() => validateHttpHeaders(headers)).not.toThrow();

    const totalSize = Object.entries(headers).reduce(
      (total, [name, value]) =>
        total +
        Buffer.byteLength(name, "utf8") +
        Buffer.byteLength(value, "utf8") +
        4,
      2,
    );

    expect(totalSize).toBe(MAX_HTTP_HEADERS_TOTAL_BYTES);
  });

  it("rejects a total serialized header size exceeding 32768 bytes", () => {
    const headers = {
      a: "a".repeat(8188),
      b: "b".repeat(8187),
      c: "c".repeat(8186),
      d: "d".repeat(8186),
    };

    expect(() => validateHttpHeaders(headers)).toThrow(InvalidHttpHeadersError);
  });
});
