import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETRY_POLICY,
  calculateBackoffCeiling,
  calculateBackoffDelay,
  canRetry,
  isRetryableStatusCode,
  validateRetryPolicy,
} from "./retry-policy.js";

describe("retry policy", () => {
  describe("DEFAULT_RETRY_POLICY", () => {
    it("uses the expected default configuration", () => {
      expect(DEFAULT_RETRY_POLICY).toEqual({
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        multiplier: 2,
      });
    });
  });

  describe("validateRetryPolicy", () => {
    it("accepts a valid policy", () => {
      expect(() => validateRetryPolicy(DEFAULT_RETRY_POLICY)).not.toThrow();
    });

    it("rejects a non-positive maxAttempts", () => {
      expect(() =>
        validateRetryPolicy({
          ...DEFAULT_RETRY_POLICY,
          maxAttempts: 0,
        }),
      ).toThrow("maxAttempts must be a positive integer.");
    });

    it("rejects a negative initial delay", () => {
      expect(() =>
        validateRetryPolicy({
          ...DEFAULT_RETRY_POLICY,
          initialDelayMs: -1,
        }),
      ).toThrow();
    });

    it("rejects a negative maximum delay", () => {
      expect(() =>
        validateRetryPolicy({
          ...DEFAULT_RETRY_POLICY,
          maxDelayMs: -1,
        }),
      ).toThrow();
    });

    it("rejects a multiplier below one", () => {
      expect(() =>
        validateRetryPolicy({
          ...DEFAULT_RETRY_POLICY,
          multiplier: 0.5,
        }),
      ).toThrow();
    });

    it("rejects a maximum delay smaller than the initial delay", () => {
      expect(() =>
        validateRetryPolicy({
          ...DEFAULT_RETRY_POLICY,
          initialDelayMs: 2000,
          maxDelayMs: 1000,
        }),
      ).toThrow();
    });

    it("rejects non-finite values", () => {
      expect(() =>
        validateRetryPolicy({
          ...DEFAULT_RETRY_POLICY,
          initialDelayMs: Number.POSITIVE_INFINITY,
        }),
      ).toThrow();
    });
  });

  describe("isRetryableStatusCode", () => {
    it.each([408, 429, 500, 502, 503, 504])(
      "considers HTTP %i retryable",
      (statusCode) => {
        expect(isRetryableStatusCode(statusCode)).toBe(true);
      },
    );

    it.each([200, 301, 400, 401, 403, 404, 422])(
      "does not consider HTTP %i retryable",
      (statusCode) => {
        expect(isRetryableStatusCode(statusCode)).toBe(false);
      },
    );
  });

  describe("canRetry", () => {
    it("allows another attempt after the first attempt", () => {
      expect(canRetry(1)).toBe(true);
    });

    it("allows another attempt after the second attempt", () => {
      expect(canRetry(2)).toBe(true);
    });

    it("does not allow another attempt after the maximum attempts", () => {
      expect(canRetry(3)).toBe(false);
    });

    it("does not allow attempts beyond the maximum", () => {
      expect(canRetry(4)).toBe(false);
    });

    it("rejects invalid attempt numbers", () => {
      expect(canRetry(0)).toBe(false);
      expect(canRetry(-1)).toBe(false);
      expect(canRetry(1.5)).toBe(false);
    });

    it("respects a custom maximum attempt count", () => {
      const policy = {
        ...DEFAULT_RETRY_POLICY,
        maxAttempts: 5,
      };

      expect(canRetry(4, policy)).toBe(true);
      expect(canRetry(5, policy)).toBe(false);
    });
  });

  describe("calculateBackoffCeiling", () => {
    it("calculates the first retry ceiling", () => {
      expect(calculateBackoffCeiling(1)).toBe(1000);
    });

    it("calculates the second retry ceiling", () => {
      expect(calculateBackoffCeiling(2)).toBe(2000);
    });

    it("calculates the third retry ceiling", () => {
      expect(calculateBackoffCeiling(3)).toBe(4000);
    });

    it("caps the delay at maxDelayMs", () => {
      expect(calculateBackoffCeiling(10)).toBe(10000);
    });

    it("rejects invalid retry numbers", () => {
      expect(() => calculateBackoffCeiling(0)).toThrow();
      expect(() => calculateBackoffCeiling(-1)).toThrow();
      expect(() => calculateBackoffCeiling(1.5)).toThrow();
    });
  });

  describe("calculateBackoffDelay", () => {
    it("returns zero when the random value is zero", () => {
      expect(calculateBackoffDelay(1, DEFAULT_RETRY_POLICY, () => 0)).toBe(0);
    });

    it("returns the maximum possible integer delay", () => {
      expect(calculateBackoffDelay(1, DEFAULT_RETRY_POLICY, () => 0.9999)).toBe(
        1000,
      );
    });

    it("calculates a deterministic jittered delay", () => {
      expect(calculateBackoffDelay(2, DEFAULT_RETRY_POLICY, () => 0.5)).toBe(
        1000,
      );
    });

    it("applies jitter after the maximum delay is capped", () => {
      expect(calculateBackoffDelay(10, DEFAULT_RETRY_POLICY, () => 0.5)).toBe(
        5000,
      );
    });

    it("rejects a random value below zero", () => {
      expect(() =>
        calculateBackoffDelay(1, DEFAULT_RETRY_POLICY, () => -0.1),
      ).toThrow();
    });

    it("rejects a random value equal to one", () => {
      expect(() =>
        calculateBackoffDelay(1, DEFAULT_RETRY_POLICY, () => 1),
      ).toThrow();
    });
  });
});
