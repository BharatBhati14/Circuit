import { Client } from "undici";

import { isPublicIpAddress } from "../../../security/ip-address.js";
import {
  HostResolutionError,
  InvalidHostnameError,
  UnsafeHostError,
} from "../../../security/host-errors.js";
import { createPinnedConnector } from "../../../security/pinned-connector.js";
import { resolvePublicHost } from "../../../security/resolve-public-host.js";
import {
  assertNoRedirectLoop,
  assertRedirectLimit,
  filterRedirectHeaders,
  getRedirectMethod,
  getRedirectUrl,
  isCrossOrigin,
  isRedirectStatus,
  shouldPreserveRequestBody,
} from "./redirect-policy.js";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 10_000;

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpTransportRequest {
  url: URL;
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface HttpTransportResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export class HttpResponseTooLargeError extends Error {
  constructor() {
    super("The HTTP response exceeded the 5 MB size limit.");
    this.name = "HttpResponseTooLargeError";

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isUndiciResponseTooLargeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "UND_ERR_RES_EXCEEDED_MAX_SIZE"
  );
}

function validateTransportUrl(url: URL): void {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new InvalidHostnameError("Only HTTP and HTTPS URLs are supported.");
  }

  if (url.username || url.password) {
    throw new InvalidHostnameError(
      "URLs must not contain embedded credentials.",
    );
  }
}

async function executeSingleHttpTransport(
  request: HttpTransportRequest,
): Promise<HttpTransportResponse> {
  let client: Client | undefined;

  try {
    request.signal?.throwIfAborted();

    validateTransportUrl(request.url);

    const hostname = request.url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");

    const addresses = await resolvePublicHost(hostname);

    request.signal?.throwIfAborted();

    const selectedAddress = addresses[0];

    if (!selectedAddress || !isPublicIpAddress(selectedAddress.address)) {
      throw new UnsafeHostError(
        "The target hostname does not resolve to a public IP address.",
      );
    }

    const connector = createPinnedConnector(
      hostname,
      selectedAddress.address,
      selectedAddress.family,
    );

    const timeoutMs = request.timeoutMs || DEFAULT_TIMEOUT_MS;

    client = new Client(request.url.origin, {
      connect: connector,
      allowH2: false,
      maxResponseSize: MAX_RESPONSE_SIZE,
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
    });

    const response = await client.request({
      method: request.method,
      path: `${request.url.pathname}${request.url.search}`,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      signal: request.signal ?? AbortSignal.timeout(timeoutMs),
    });

    const chunks: Buffer[] = [];
    let totalSize = 0;

    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      totalSize += buffer.length;

      if (totalSize > MAX_RESPONSE_SIZE) {
        throw new HttpResponseTooLargeError();
      }

      chunks.push(buffer);
    }

    return {
      statusCode: response.statusCode,
      headers: response.headers,
      body: Buffer.concat(chunks),
    };
  } catch (error) {
    if (isUndiciResponseTooLargeError(error)) {
      throw new HttpResponseTooLargeError();
    }

    throw error;
  } finally {
    if (client) {
      await client.close().catch(() => {
        client?.destroy();
      });
    }
  }
}

export async function executeHttpTransport(
  request: HttpTransportRequest,
): Promise<HttpTransportResponse> {
  const timeoutMs = request.timeoutMs || DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  const signal = request.signal
    ? AbortSignal.any([request.signal, timeoutSignal])
    : timeoutSignal;

  let currentRequest: HttpTransportRequest = {
    ...request,
    timeoutMs,
    signal,
    headers: { ...request.headers },
  };

  let redirectCount = 0;

  const visitedUrls = new Set<string>();
  visitedUrls.add(currentRequest.url.href);

  while (true) {
    const remainingTimeoutMs = deadline - Date.now();

    if (remainingTimeoutMs <= 0) {
      const error = new Error("The HTTP request timed out.");
      error.name = "TimeoutError";
      throw error;
    }

    signal.throwIfAborted();

    const response = await executeSingleHttpTransport({
      ...currentRequest,
      timeoutMs: remainingTimeoutMs,
    });

    signal.throwIfAborted();

    if (!isRedirectStatus(response.statusCode)) {
      return response;
    }

    const location = response.headers.location;

    const nextUrl = getRedirectUrl(currentRequest.url.href, location);

    assertRedirectLimit(redirectCount);

    assertNoRedirectLoop(visitedUrls, nextUrl);

    const nextMethod = getRedirectMethod(
      response.statusCode,
      currentRequest.method,
    );

    const preserveBody = shouldPreserveRequestBody(
      response.statusCode,
      currentRequest.method,
    );

    const crossOrigin = isCrossOrigin(currentRequest.url, nextUrl);

    const nextHeaders = filterRedirectHeaders(
      currentRequest.headers ?? {},
      crossOrigin,
    );

    if (!preserveBody) {
      for (const header of [
        "content-type",
        "content-length",
        "content-encoding",
        "transfer-encoding",
      ]) {
        for (const existingHeader of Object.keys(nextHeaders)) {
          if (existingHeader.toLowerCase() === header) {
            delete nextHeaders[existingHeader];
          }
        }
      }
    }

    currentRequest = {
      ...currentRequest,
      url: nextUrl,
      method: nextMethod as HttpTransportRequest["method"],
      headers: nextHeaders,
      body: preserveBody ? currentRequest.body : undefined,
    };

    redirectCount += 1;
  }
}
