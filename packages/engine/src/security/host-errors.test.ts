import { describe, expect, it } from "vitest";

import {
  HostResolutionError,
  InvalidHostnameError,
  UnsafeHostError,
} from "./host-errors.js";

describe("Host errors", () => {
  describe("InvalidHostnameError", () => {
    it("creates an error with the correct name", () => {
      const error = new InvalidHostnameError();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(InvalidHostnameError);
      expect(error.name).toBe("InvalidHostnameError");
      expect(error.message).toBe("Invalid hostname");
    });

    it("accepts a custom message", () => {
      const error = new InvalidHostnameError(
        "Hostname contains invalid characters",
      );

      expect(error.message).toBe("Hostname contains invalid characters");
    });
  });

  describe("UnsafeHostError", () => {
    it("creates an error with the correct name", () => {
      const error = new UnsafeHostError();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(UnsafeHostError);
      expect(error.name).toBe("UnsafeHostError");
      expect(error.message).toBe("Host resolves to a non-public IP address");
    });

    it("accepts a custom message", () => {
      const error = new UnsafeHostError("Private IP address blocked");

      expect(error.message).toBe("Private IP address blocked");
    });
  });

  describe("HostResolutionError", () => {
    it("preserves the original DNS error as cause", () => {
      const dnsError = Object.assign(new Error("Temporary DNS failure"), {
        code: "EAI_AGAIN",
      });

      const error = new HostResolutionError(
        "Failed to resolve hostname",
        dnsError,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(HostResolutionError);
      expect(error.name).toBe("HostResolutionError");
      expect(error.cause).toBe(dnsError);
      expect(error.dnsCode).toBe("EAI_AGAIN");
    });

    it("supports errors without a DNS code", () => {
      const error = new HostResolutionError(
        "Failed to resolve hostname",
        new Error("Unknown failure"),
      );

      expect(error.dnsCode).toBeUndefined();
    });

    it("supports construction without a cause", () => {
      const error = new HostResolutionError();

      expect(error.message).toBe("Failed to resolve hostname");
      expect(error.cause).toBeUndefined();
      expect(error.dnsCode).toBeUndefined();
    });

    it("supports custom messages", () => {
      const error = new HostResolutionError("DNS lookup timed out");

      expect(error.message).toBe("DNS lookup timed out");
    });
  });
});
