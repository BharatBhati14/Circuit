export interface RetryPolicy {
  /**
   * Total number of attempts, including the initial request.
   */
  maxAttempts: number;

  /**
   * Initial backoff delay in milliseconds.
   */
  initialDelayMs: number;

  /**
   * Maximum backoff delay in milliseconds.
   */
  maxDelayMs: number;

  /**
   * Exponential backoff multiplier.
   */
  multiplier: number;
}

export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy> = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 10_000,
  multiplier: 2,
};

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Validates a retry policy.
 */
export function validateRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer.");
  }

  if (!Number.isFinite(policy.initialDelayMs) || policy.initialDelayMs < 0) {
    throw new Error("initialDelayMs must be a non-negative finite number.");
  }

  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < 0) {
    throw new Error("maxDelayMs must be a non-negative finite number.");
  }

  if (!Number.isFinite(policy.multiplier) || policy.multiplier < 1) {
    throw new Error(
      "multiplier must be a finite number greater than or equal to 1.",
    );
  }

  if (policy.maxDelayMs < policy.initialDelayMs) {
    throw new Error(
      "maxDelayMs must be greater than or equal to initialDelayMs.",
    );
  }
}

/**
 * Determines whether an HTTP status code is retryable.
 */
export function isRetryableStatusCode(statusCode: number): boolean {
  return RETRYABLE_STATUS_CODES.has(statusCode);
}

/**
 * Determines whether another attempt is permitted.
 *
 * attempt is one-based:
 * 1 = initial request
 * 2 = first retry
 * 3 = second retry
 */
export function canRetry(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): boolean {
  validateRetryPolicy(policy);

  if (!Number.isInteger(attempt) || attempt < 1) {
    return false;
  }

  return attempt < policy.maxAttempts;
}

/**
 * Calculates the exponential backoff ceiling for a retry.
 *
 * retryNumber is one-based:
 * 1 = first retry
 * 2 = second retry
 */
export function calculateBackoffCeiling(
  retryNumber: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number {
  validateRetryPolicy(policy);

  if (!Number.isInteger(retryNumber) || retryNumber < 1) {
    throw new Error("retryNumber must be a positive integer.");
  }

  const delay =
    policy.initialDelayMs * Math.pow(policy.multiplier, retryNumber - 1);

  return Math.min(delay, policy.maxDelayMs);
}

/**
 * Calculates a full-jitter backoff delay.
 *
 * Returns a random delay between zero and the calculated ceiling.
 * random must return a number in the range [0, 1).
 */
export function calculateBackoffDelay(
  retryNumber: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const ceiling = calculateBackoffCeiling(retryNumber, policy);
  const randomValue = random();

  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new Error("Random value must be in the range [0, 1).");
  }

  return Math.floor(randomValue * (ceiling + 1));
}
