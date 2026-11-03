import { describe, expect, it } from "vitest";

import {
  HostResolutionError,
  InvalidHostnameError,
  UnsafeHostError,
} from "../../../security/host-errors.js";

import { InvalidHttpHeadersError } from "../../../security/http-headers.js";

import { HttpResponseTooLargeError } from "./http-transport.js";

import { HttpRedirectError } from "./redirect-policy.js";

import { InvalidJsonResponseError } from "./response-parser.js";

import { InvalidResponseHeadersError } from "./response-headers.js";

import { isRetryableTransportError } from "./retryable-errors.js";

describe("isRetryableTransportError", () => {
  describe("retryable network errors", () => {
    it.each([
      "ECONNRESET",
      "ECONNREFUSED",
      "ECONNABORTED",
      "ETIMEDOUT",
      "EPIPE",
      "EHOSTUNREACH",
      "ENETUNREACH",
    ])("classifies %s as retryable", (code) => {
      const error = Object.assign(new Error("Network failure"), { code });

      expect(isRetryableTransportError(error)).toBe(true);
    });

    it("classifies TimeoutError as retryable", () => {
      const error = new Error("Request timed out");
      error.name = "TimeoutError";

      expect(isRetryableTransportError(error)).toBe(true);
    });
  });

  describe("retryable DNS errors", () => {
    it.each(["EAI_AGAIN", "ETIMEOUT", "ESERVFAIL"])(
      "classifies DNS error %s as retryable",
      (code) => {
        const error = new HostResolutionError(
          "DNS resolution failed",
          Object.assign(new Error("DNS failure"), { code }),
        );

        expect(isRetryableTransportError(error)).toBe(true);
      },
    );

    it("does not retry permanent DNS errors", () => {
      const error = new HostResolutionError(
        "DNS resolution failed",
        Object.assign(new Error("Host not found"), {
          code: "ENOTFOUND",
        }),
      );

      expect(isRetryableTransportError(error)).toBe(false);
    });
  });

  describe("permanent errors", () => {
    it("does not retry invalid host errors", () => {
      expect(isRetryableTransportError(new InvalidHostnameError())).toBe(false);
    });

    it("does not retry unsafe host errors", () => {
      expect(isRetryableTransportError(new UnsafeHostError())).toBe(false);
    });

    it("does not retry redirect policy errors", () => {
      expect(
        isRetryableTransportError(
          new HttpRedirectError("HTTP_REDIRECT_BLOCKED", "Blocked"),
        ),
      ).toBe(false);
    });

    it("does not retry oversized responses", () => {
      expect(isRetryableTransportError(new HttpResponseTooLargeError())).toBe(
        false,
      );
    });

    it("does not retry invalid request headers", () => {
      expect(
        isRetryableTransportError(
          new InvalidHttpHeadersError("Invalid headers"),
        ),
      ).toBe(false);
    });

    it("does not retry invalid response headers", () => {
      expect(
        isRetryableTransportError(
          new InvalidResponseHeadersError("Invalid response headers"),
        ),
      ).toBe(false);
    });

    it("does not retry invalid JSON responses", () => {
      expect(
        isRetryableTransportError(new InvalidJsonResponseError("Invalid JSON")),
      ).toBe(false);
    });
  });

  describe("unknown errors", () => {
    it("does not retry unknown errors", () => {
      expect(isRetryableTransportError(new Error("Unexpected failure"))).toBe(
        false,
      );
    });

    it("does not retry non-error values", () => {
      expect(isRetryableTransportError("network failure")).toBe(false);
      expect(isRetryableTransportError(null)).toBe(false);
      expect(isRetryableTransportError(undefined)).toBe(false);
    });

    it("does not retry unknown error codes", () => {
      const error = Object.assign(new Error("Unexpected"), {
        code: "UNKNOWN_ERROR",
      });

      expect(isRetryableTransportError(error)).toBe(false);
    });
  });
});
