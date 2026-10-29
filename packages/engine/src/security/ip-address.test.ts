import { describe, expect, it } from "vitest";

import { isPublicIpAddress } from "./ip-address.js";

describe("isPublicIpAddress", () => {
  it.each([
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["2606:4700:4700::1111", true],
    ["127.0.0.1", false],
    ["10.0.0.1", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["::1", false],
    ["fc00::1", false],
    ["fe80::1", false],
    ["::ffff:127.0.0.1", false],
    ["not-an-ip", false],
  ])("returns %s → %s", (address, expected) => {
    expect(isPublicIpAddress(address)).toBe(expected);
  });
});
