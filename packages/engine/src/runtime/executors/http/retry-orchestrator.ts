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
  delay?: (milliseconds: number) => Promise<void>;
}

// export interface HttpTransportResponse {
//   statusCode: number;
//   headers: Record<string, string | string[]>;
//   body: Buffer;
// }

const defaultDelay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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
    try {
      const response = await transport(request);

      if (
        !retrySafety.allowed ||
        !isRetryableStatusCode(response.statusCode) ||
        !canRetry(attempt, policy)
      ) {
        return response;
      }
    } catch (error) {
      if (
        !retrySafety.allowed ||
        !isRetryableTransportError(error) ||
        !canRetry(attempt, policy)
      ) {
        throw error;
      }
    }

    const backoffDelay = calculateBackoffDelay(attempt, policy);

    await delay(backoffDelay);

    attempt += 1;
  }
}
