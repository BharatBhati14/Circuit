import { describe, expect, it } from "vitest";
import { isPublicIpAddress } from "./ip-address.js";

describe("isPublicIpAddress", () => {
  describe("public IPv4 addresses", () => {
    it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34"])("allows %s", (address) => {
      expect(isPublicIpAddress(address)).toBe(true);
    });
  });

  describe("non-public IPv4 addresses", () => {
    it.each([
      "0.0.0.0",
      "10.0.0.1",
      "127.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ])("blocks %s", (address) => {
      expect(isPublicIpAddress(address)).toBe(false);
    });
  });

  describe("public IPv6 addresses", () => {
    it.each(["2606:4700:4700::1111", "2001:4860:4860::8888"])(
      "allows %s",
      (address) => {
        expect(isPublicIpAddress(address)).toBe(true);
      },
    );
  });

  describe("non-public IPv6 addresses", () => {
    it.each([
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "2001::1",
      "2002::1",
      "64:ff9b::1",
      "3fff::1",
    ])("blocks %s", (address) => {
      expect(isPublicIpAddress(address)).toBe(false);
    });
  });

  describe("IPv4-mapped IPv6 addresses", () => {
    it.each(["::ffff:8.8.8.8", "::ffff:192.168.1.1"])(
      "blocks %s",
      (address) => {
        expect(isPublicIpAddress(address)).toBe(false);
      },
    );
  });

  describe("invalid addresses", () => {
    it.each(["", "not-an-ip", "999.999.999.999", "256.1.1.1", "example.com"])(
      "blocks %s",
      (address) => {
        expect(isPublicIpAddress(address)).toBe(false);
      },
    );
  });
});
