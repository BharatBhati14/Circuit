import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";

import {
  HostResolutionError,
  InvalidHostnameError,
  UnsafeHostError,
} from "./host-errors.js";
import { isPublicIpAddress } from "./ip-address.js";

export interface PublicHostAddress {
  address: string;
  family: 4 | 6;
}

export async function resolvePublicHost(
  hostname: string,
): Promise<PublicHostAddress[]> {
  // Normalize case and remove trailing dots.
  const normalizedHostname = hostname.toLowerCase().replace(/\.+$/, "");

  if (!normalizedHostname) {
    throw new InvalidHostnameError();
  }

  // IP literals do not require DNS resolution.
  const family = isIP(normalizedHostname);

  if (family !== 0) {
    if (!isPublicIpAddress(normalizedHostname)) {
      throw new UnsafeHostError();
    }

    return [{ address: normalizedHostname, family: family as 4 | 6 }];
  }

  // Reject malformed DNS names before querying DNS.
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
    throw new InvalidHostnameError();
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

    // An absent record for one address family is acceptable.
    if (error.code === "ENODATA") {
      continue;
    }

    throw new HostResolutionError("Failed to resolve hostname", error);
  }

  if (addresses.length === 0) {
    const cause = Object.assign(
      new Error("Hostname resolved to no IP addresses"),
      { code: "ENODATA" },
    );

    throw new HostResolutionError(
      "Hostname resolved to no IP addresses",
      cause,
    );
  }

  // Reject the entire hostname if ANY returned address is non-public.
  if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new UnsafeHostError();
  }

  return addresses;
}
