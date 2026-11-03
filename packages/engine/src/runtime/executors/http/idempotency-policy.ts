import type { HttpTransportRequest } from "./http-transport.js";

const IDEMPOTENT_METHODS = new Set(["GET", "PUT", "DELETE"]);

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export interface IdempotencyPolicyResult {
  allowed: boolean;
  reason?: string;
}

export function hasIdempotencyKey(
  headers: HttpTransportRequest["headers"],
): boolean {
  if (!headers) return false;

  return Object.entries(headers).some(
    ([name, value]) =>
      name.toLowerCase() === IDEMPOTENCY_KEY_HEADER &&
      typeof value === "string" &&
      value.trim().length > 0,
  );
}

export function canRetryHttpRequest(
  request: HttpTransportRequest,
): IdempotencyPolicyResult {
  const method = request.method.toUpperCase();

  if (IDEMPOTENT_METHODS.has(method)) {
    return { allowed: true };
  }

  if (method === "POST" || method === "PATCH") {
    if (hasIdempotencyKey(request.headers)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `${method} requests require an Idempotency-Key header for automatic retries.`,
    };
  }

  return {
    allowed: false,
    reason: `Automatic retries are not supported for ${method} requests.`,
  };
}
