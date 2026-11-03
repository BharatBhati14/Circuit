import {
  HostResolutionError,
  InvalidHostnameError,
  UnsafeHostError,
} from "../../../security/host-errors.js";

import { HttpResponseTooLargeError } from "./http-transport.js";

import { HttpRedirectError } from "./redirect-policy.js";

import { InvalidHttpHeadersError } from "../../../security/http-headers.js";

import { InvalidJsonResponseError } from "./response-parser.js";

import { InvalidResponseHeadersError } from "./response-headers.js";

const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

const RETRYABLE_DNS_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ETIMEOUT",
  "ESERVFAIL",
]);

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}

/**
 * Determines whether a transport error represents a temporary failure.
 *
 * Unknown errors are not retryable.
 */
export function isRetryableTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // Permanent validation and security errors.
  if (
    error instanceof InvalidHostnameError ||
    error instanceof UnsafeHostError ||
    error instanceof HttpRedirectError ||
    error instanceof HttpResponseTooLargeError ||
    error instanceof InvalidHttpHeadersError ||
    error instanceof InvalidResponseHeadersError ||
    error instanceof InvalidJsonResponseError
  ) {
    return false;
  }

  // DNS errors need explicit classification.
  if (error instanceof HostResolutionError) {
    return RETRYABLE_DNS_ERROR_CODES.has(error.dnsCode ?? "");
  }

  // Timeout errors are transient.
  if (error.name === "TimeoutError") {
    return true;
  }

  // Explicitly recognized network errors.
  const code = getErrorCode(error);

  if (code) {
    return (
      RETRYABLE_NETWORK_ERROR_CODES.has(code) ||
      RETRYABLE_DNS_ERROR_CODES.has(code)
    );
  }

  return false;
}
