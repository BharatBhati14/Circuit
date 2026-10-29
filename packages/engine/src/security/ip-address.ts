import ipaddr from "ipaddr.js";

export function isPublicIpAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
