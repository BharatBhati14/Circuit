import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";

import { isPublicIpAddress } from "./ip-address.js";

export interface PublicHostAddress {
  address: string;
  family: 4 | 6;
}

export async function resolvePublicHost(
  hostname: string,
): Promise<PublicHostAddress[]> {
  // Normalize case and remove trailing dots for consistent handling.
  const normalizedHostname = hostname.toLowerCase().replace(/\.+$/, "");

  if (!normalizedHostname) {
    throw new Error("Invalid hostname");
  }

  // IP literals do not require DNS resolution.
  const family = isIP(normalizedHostname);

  if (family !== 0) {
    if (!isPublicIpAddress(normalizedHostname)) {
      throw new Error("Host resolves to a non-public IP address");
    }

    return [{ address: normalizedHostname, family: family as 4 | 6 }];
  }

  // Reject malformed DNS names rather than passing them to the resolver.
  if (
    normalizedHostname.length > 253 ||
    normalizedHostname
      .split(".")
      .some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
  ) {
    throw new Error("Invalid hostname");
  }

  const results = await Promise.allSettled([
    resolve4(normalizedHostname),
    resolve6(normalizedHostname),
  ]);

  const addresses: PublicHostAddress[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const recordFamily = i === 0 ? 4 : 6;

    if (result.status === "fulfilled") {
      for (const address of result.value) {
        addresses.push({ address, family: recordFamily });
      }
      continue;
    }

    const error = result.reason as NodeJS.ErrnoException;

    if (error.code === "ENODATA") {
      continue;
    }

    throw new Error("Failed to resolve hostname", { cause: error });
  }

  if (addresses.length === 0) {
    throw new Error("Hostname resolved to no IP addresses");
  }

  if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("Host resolves to a non-public IP address");
  }

  return addresses;
}
