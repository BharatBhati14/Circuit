import ipaddr from "ipaddr.js";

export function isPublicIpAddress(address: string): boolean {
  try {
    const parsedAddress = ipaddr.process(address);

    return parsedAddress.range() === "unicast";
  } catch {
    return false;
  }
}
