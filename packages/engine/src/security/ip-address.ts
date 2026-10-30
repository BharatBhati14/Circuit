import ipaddr from "ipaddr.js";

export function isPublicIpAddress(address: string): boolean {
  try {
    const parsedAddress = ipaddr.parse(address);

    if (
      parsedAddress instanceof ipaddr.IPv6 &&
      parsedAddress.isIPv4MappedAddress()
    ) {
      return false;
    }

    return parsedAddress.range() === "unicast";
  } catch {
    return false;
  }
}
