import { describe, expect, it } from "vitest";

import { validateHttpHeaders } from "./http-headers.js";

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
