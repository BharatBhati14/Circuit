import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve4, resolve6 } from "node:dns/promises";

import {
  HostResolutionError,
  InvalidHostnameError,
  UnsafeHostError,
} from "./host-errors.js";
import { resolvePublicHost } from "./resolve-public-host.js";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);

function dnsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`DNS error: ${code}`), { code });
}

function noDataError(): NodeJS.ErrnoException {
  return dnsError("ENODATA");
}

describe("resolvePublicHost", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockResolve4.mockRejectedValue(noDataError());
    mockResolve6.mockRejectedValue(noDataError());
  });

  it("accepts a hostname resolving only to public addresses", async () => {
    mockResolve4.mockResolvedValue(["8.8.8.8", "1.1.1.1"]);
    mockResolve6.mockResolvedValue(["2606:4700:4700::1111"]);

    await expect(resolvePublicHost("Example.COM.")).resolves.toEqual([
      { address: "8.8.8.8", family: 4 },
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);

    expect(mockResolve4).toHaveBeenCalledWith("example.com");
    expect(mockResolve6).toHaveBeenCalledWith("example.com");
  });

  it("rejects a hostname resolving to a private address", async () => {
    mockResolve4.mockResolvedValue(["192.168.1.10"]);

    await expect(resolvePublicHost("internal.example")).rejects.toBeInstanceOf(
      UnsafeHostError,
    );
  });

  it("rejects mixed public and private DNS results", async () => {
    mockResolve4.mockResolvedValue(["8.8.8.8", "10.0.0.1"]);

    await expect(resolvePublicHost("mixed.example")).rejects.toBeInstanceOf(
      UnsafeHostError,
    );
  });

  it("accepts an IPv4-only hostname when IPv6 has no records", async () => {
    mockResolve4.mockResolvedValue(["8.8.8.8"]);
    mockResolve6.mockRejectedValue(noDataError());

    await expect(resolvePublicHost("ipv4.example")).resolves.toEqual([
      { address: "8.8.8.8", family: 4 },
    ]);
  });

  it("accepts an IPv6-only hostname when IPv4 has no records", async () => {
    mockResolve4.mockRejectedValue(noDataError());
    mockResolve6.mockResolvedValue(["2606:4700:4700::1111"]);

    await expect(resolvePublicHost("ipv6.example")).resolves.toEqual([
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
  });

  it("throws HostResolutionError for DNS lookup failures", async () => {
    mockResolve4.mockResolvedValue(["8.8.8.8"]);
    mockResolve6.mockRejectedValue(dnsError("ENOTFOUND"));

    await expect(resolvePublicHost("failure.example")).rejects.toBeInstanceOf(
      HostResolutionError,
    );
  });

  it("preserves the original DNS error code", async () => {
    mockResolve4.mockRejectedValue(dnsError("EAI_AGAIN"));

    try {
      await resolvePublicHost("temporary-failure.example");
      throw new Error("Expected DNS resolution to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HostResolutionError);
      expect(error).toMatchObject({
        name: "HostResolutionError",
        dnsCode: "EAI_AGAIN",
      });
      expect((error as Error).cause).toMatchObject({
        code: "EAI_AGAIN",
      });
    }
  });

  it("rejects when both DNS lookups return no records", async () => {
    mockResolve4.mockRejectedValue(noDataError());
    mockResolve6.mockRejectedValue(noDataError());

    await expect(resolvePublicHost("empty.example")).rejects.toMatchObject({
      name: "HostResolutionError",
      dnsCode: "ENODATA",
      message: "Hostname resolved to no IP addresses",
    });
  });

  it("rejects malformed hostnames with InvalidHostnameError", async () => {
    await expect(resolvePublicHost("invalid..example")).rejects.toBeInstanceOf(
      InvalidHostnameError,
    );

    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
  });

  it("rejects an empty hostname", async () => {
    await expect(resolvePublicHost("")).rejects.toBeInstanceOf(
      InvalidHostnameError,
    );
  });

  it("accepts a public IP literal without DNS lookups", async () => {
    await expect(resolvePublicHost("8.8.8.8")).resolves.toEqual([
      { address: "8.8.8.8", family: 4 },
    ]);

    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
  });

  it("rejects a private IP literal with UnsafeHostError", async () => {
    await expect(resolvePublicHost("192.168.1.1")).rejects.toBeInstanceOf(
      UnsafeHostError,
    );

    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
  });

  it("rejects IPv4-mapped IPv6 literals", async () => {
    await expect(resolvePublicHost("::ffff:8.8.8.8")).rejects.toBeInstanceOf(
      UnsafeHostError,
    );

    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
  });
});
