import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolve4, resolve6 } from "node:dns/promises";

import { resolvePublicHost } from "./resolve-public-host.js";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);

function noDataError(): NodeJS.ErrnoException {
  return Object.assign(new Error("No address records"), {
    code: "ENODATA",
  });
}

function notFoundError(): NodeJS.ErrnoException {
  return Object.assign(new Error("DNS lookup failed"), {
    code: "ENOTFOUND",
  });
}

describe("resolvePublicHost", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default: no records for either address family.
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

    await expect(resolvePublicHost("internal.example")).rejects.toThrow(
      "non-public IP address",
    );
  });

  it("rejects mixed public and private results", async () => {
    mockResolve4.mockResolvedValue(["8.8.8.8", "10.0.0.1"]);

    await expect(resolvePublicHost("mixed.example")).rejects.toThrow(
      "non-public IP address",
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

  it("rejects when DNS resolution fails", async () => {
    mockResolve4.mockResolvedValue(["8.8.8.8"]);
    mockResolve6.mockRejectedValue(notFoundError());

    await expect(resolvePublicHost("failure.example")).rejects.toThrow(
      "Failed to resolve hostname",
    );
  });

  it("rejects when both DNS lookups return no records", async () => {
    mockResolve4.mockRejectedValue(noDataError());
    mockResolve6.mockRejectedValue(noDataError());

    await expect(resolvePublicHost("empty.example")).rejects.toThrow(
      "Hostname resolved to no IP addresses",
    );
  });

  it("accepts a public IP literal without DNS lookups", async () => {
    await expect(resolvePublicHost("8.8.8.8")).resolves.toEqual([
      { address: "8.8.8.8", family: 4 },
    ]);

    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
  });

  it("rejects a private IP literal without DNS lookups", async () => {
    await expect(resolvePublicHost("192.168.1.1")).rejects.toThrow(
      "non-public IP address",
    );

    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
  });
});
