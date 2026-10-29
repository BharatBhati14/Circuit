import { describe, expect, it } from "vitest";

import { isPublicIpAddress } from "./ip-address.js";

describe("isPublicIpAddress", () => {
  it.each([
    // Public IPv4 and IPv6
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["2606:4700:4700::1111", true],

    // Loopback
    ["127.0.0.1", false],
    ["::1", false],

    // Private IPv4 and IPv6
    ["10.0.0.1", false],
    ["172.16.0.1", false],
    ["192.168.1.1", false],
    ["fc00::1", false],
    ["fd12:3456::1", false],

    // Link-local
    ["169.254.169.254", false],
    ["fe80::1", false],

    // Carrier-grade NAT (100.64.0.0/10)
    ["100.64.0.1", false],
    ["100.127.255.254", false],

    // Multicast
    ["224.0.0.1", false],
    ["239.255.255.250", false],
    ["ff02::1", false],

    // Reserved and special-purpose addresses
    ["0.0.0.0", false],
    ["255.255.255.255", false],
    ["192.0.2.1", false], // Documentation
    ["198.51.100.1", false], // Documentation
    ["203.0.113.1", false], // Documentation
    ["2001:db8::1", false], // IPv6 documentation

    // IPv4-mapped IPv6
    ["::ffff:127.0.0.1", false],
    ["::ffff:10.0.0.1", false],
    ["::ffff:192.168.1.1", false],

    // Invalid input
    ["", false],
    ["not-an-ip", false],
    ["256.256.256.256", false],
    ["999.1.1.1", false],
    ["example.com", false],
    ["192.168.1.1:8080", false],
  ])("%s returns %s", (address, expected) => {
    expect(isPublicIpAddress(address)).toBe(expected);
  });
});
