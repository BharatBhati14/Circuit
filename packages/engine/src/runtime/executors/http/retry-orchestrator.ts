import type { HttpTransportRequest } from "./http-transport.js";
import {
  executeHttpTransport,
  type HttpTransportResponse,
} from "./http-transport.js";

import {
  DEFAULT_RETRY_POLICY,
  canRetry,
  calculateBackoffDelay,
  isRetryableStatusCode,
  validateRetryPolicy,
  type RetryPolicy,
} from "./retry-policy.js";

import { isRetryableTransportError } from "./retryable-errors.js";
import { canRetryHttpRequest } from "./idempotency-policy.js";

export interface RetryOrchestratorOptions {
  policy?: RetryPolicy;
  transport?: (request: HttpTransportRequest) => Promise<HttpTransportResponse>;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

// export interface HttpTransportResponse {
//   statusCode: number;
//   headers: Record<string, string | string[]>;
//   body: Buffer;
// }

const defaultDelay = (
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason);
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });

export async function executeWithRetry(
  request: HttpTransportRequest,
  options: RetryOrchestratorOptions = {},
): Promise<HttpTransportResponse> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const transport = options.transport ?? executeHttpTransport;
  const delay = options.delay ?? defaultDelay;

  validateRetryPolicy(policy);

  const retrySafety = canRetryHttpRequest(request);

  let attempt = 1;

  while (true) {
    request.signal?.throwIfAborted();

    try {
      const response = await transport(request);

      request.signal?.throwIfAborted();

      if (
        !retrySafety.allowed ||
        !isRetryableStatusCode(response.statusCode) ||
        !canRetry(attempt, policy)
      ) {
        return response;
      }
    } catch (error) {
      // External cancellation must never trigger another attempt.
      if (request.signal?.aborted) {
        throw request.signal.reason ?? error;
      }

      if (
        !retrySafety.allowed ||
        !isRetryableTransportError(error) ||
        !canRetry(attempt, policy)
      ) {
        throw error;
      }
    }

    request.signal?.throwIfAborted();

    const backoffDelay = calculateBackoffDelay(attempt, policy);

    await delay(backoffDelay, request.signal);

    request.signal?.throwIfAborted();

    attempt += 1;
  }
}
