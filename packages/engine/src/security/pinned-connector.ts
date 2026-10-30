import { buildConnector } from "undici";
import type { LookupFunction } from "node:net";

import { isPublicIpAddress } from "./ip-address.js";

export function createPinnedConnector(
  hostname: string,
  address: string,
  family: 4 | 6,
) {
  const expectedHostname = hostname.toLowerCase().replace(/\.$/, "");

  if (!isPublicIpAddress(address)) {
    throw new Error("Cannot pin a non-public IP address.");
  }

  const actualFamily = address.includes(":") ? 6 : 4;

  if (actualFamily !== family) {
    throw new Error("Pinned IP address family does not match.");
  }

  const lookup: LookupFunction = (requestedHostname, options, callback) => {
    const normalizedRequestedHostname = requestedHostname
      .toLowerCase()
      .replace(/\.$/, "");

    if (normalizedRequestedHostname !== expectedHostname) {
      callback(
        new Error("Unexpected hostname requested by pinned connector."),
        "",
        0,
      );
      return;
    }

    const requestedFamily =
      typeof options === "number" ? options : (options.family ?? 0);

    if (requestedFamily !== 0 && requestedFamily !== family) {
      callback(
        new Error("Requested address family does not match pinned IP."),
        "",
        0,
      );
      return;
    }

    if (typeof options === "object" && options.all) {
      callback(null, [{ address, family }]);
      return;
    }

    callback(null, address, family);
  };

  return buildConnector({
    allowH2: false,
    lookup,
  });
}
