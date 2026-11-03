import { describe, it, expect, vi, afterEach } from "vitest";

import { executeWithRetry } from "./retry-orchestrator.js";

import type {
  HttpTransportRequest,
  HttpTransportResponse,
} from "./http-transport.js";

import { DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry-policy.js";

function createRequest(): HttpTransportRequest {
  return {
    url: new URL("https://example.com"),
    method: "GET",
    timeoutMs: 10_000,
  };
}

function createResponse(statusCode = 200): HttpTransportResponse {
  return {
    statusCode,
    headers: {},
    body: Buffer.from("response"),
  };
}

function createRetryableError(): Error {
  return Object.assign(new Error("Connection refused"), {
    code: "ECONNREFUSED",
  });
}

function createNonRetryableError(): Error {
  return Object.assign(new Error("Invalid hostname"), { code: "ENOTFOUND" });
}

const noDelay = vi.fn(async (_milliseconds: number) => {});

afterEach(() => {
  vi.clearAllMocks();
});

describe("executeWithRetry", () => {
  it("does not retry POST requests without an idempotency key", async () => {
    const transport = vi.fn().mockResolvedValue(createResponse(503));

    const request: HttpTransportRequest = {
      ...createRequest(),
      method: "POST",
    };

    const result = await executeWithRetry(request, {
      transport,
      delay: noDelay,
    });

    expect(result.statusCode).toBe(503);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(noDelay).not.toHaveBeenCalled();
  });

  it("retries POST requests with an idempotency key", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(createResponse(503))
      .mockResolvedValueOnce(createResponse(200));

    const request: HttpTransportRequest = {
      ...createRequest(),
      method: "POST",
      headers: {
        "Idempotency-Key": "request-123",
      },
    };

    const result = await executeWithRetry(request, {
      transport,
      delay: noDelay,
    });

    expect(result.statusCode).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(noDelay).toHaveBeenCalledTimes(1);
  });

  it("does not retry POST requests without a key after a network error", async () => {
    const error = createRetryableError();
    const transport = vi.fn().mockRejectedValue(error);

    const request: HttpTransportRequest = {
      ...createRequest(),
      method: "POST",
    };

    await expect(
      executeWithRetry(request, {
        transport,
        delay: noDelay,
      }),
    ).rejects.toBe(error);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(noDelay).not.toHaveBeenCalled();
  });

  it("does not retry PATCH requests without an idempotency key", async () => {
    const transport = vi.fn().mockResolvedValue(createResponse(503));

    const request: HttpTransportRequest = {
      ...createRequest(),
      method: "PATCH",
    };

    const result = await executeWithRetry(request, {
      transport,
      delay: noDelay,
    });

    expect(result.statusCode).toBe(503);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not execute a request when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Workflow cancelled"));

    const transport = vi.fn().mockResolvedValue(createResponse());

    await expect(
      executeWithRetry(
        {
          ...createRequest(),
          signal: controller.signal,
        },
        { transport, delay: noDelay },
      ),
    ).rejects.toThrow("Workflow cancelled");

    expect(transport).not.toHaveBeenCalled();
  });

  it("cancels during retry backoff", async () => {
    const controller = new AbortController();

    const transport = vi.fn().mockResolvedValue(createResponse(503));

    const delay = vi.fn(async () => {
      controller.abort(new Error("Workflow cancelled"));
    });

    await expect(
      executeWithRetry(
        {
          ...createRequest(),
          signal: controller.signal,
        },
        { transport, delay },
      ),
    ).rejects.toThrow("Workflow cancelled");

    expect(transport).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("returns a successful response on the first attempt", async () => {
    const transport = vi.fn().mockResolvedValue(createResponse());

    const result = await executeWithRetry(createRequest(), {
      transport,
      delay: noDelay,
    });

    expect(result.statusCode).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(noDelay).not.toHaveBeenCalled();
  });

  it("retries a retryable network error and succeeds", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(createRetryableError())
      .mockResolvedValueOnce(createResponse());

    const result = await executeWithRetry(createRequest(), {
      transport,
      delay: noDelay,
    });

    expect(result.statusCode).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(noDelay).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable network error", async () => {
    const error = createNonRetryableError();

    const transport = vi.fn().mockRejectedValue(error);

    await expect(
      executeWithRetry(createRequest(), {
        transport,
        delay: noDelay,
      }),
    ).rejects.toBe(error);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(noDelay).not.toHaveBeenCalled();
  });

  it("retries a retryable HTTP status code", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(createResponse(503))
      .mockResolvedValueOnce(createResponse(200));

    const result = await executeWithRetry(createRequest(), {
      transport,
      delay: noDelay,
    });

    expect(result.statusCode).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(noDelay).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable HTTP status code", async () => {
    const transport = vi.fn().mockResolvedValue(createResponse(400));

    const result = await executeWithRetry(createRequest(), {
      transport,
      delay: noDelay,
    });

    expect(result.statusCode).toBe(400);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(noDelay).not.toHaveBeenCalled();
  });

  it("stops after the maximum number of attempts", async () => {
    const transport = vi.fn().mockResolvedValue(createResponse(503));

    const result = await executeWithRetry(createRequest(), {
      transport,
      delay: noDelay,
    });

    expect(result.statusCode).toBe(503);
    expect(transport).toHaveBeenCalledTimes(DEFAULT_RETRY_POLICY.maxAttempts);

    expect(noDelay).toHaveBeenCalledTimes(DEFAULT_RETRY_POLICY.maxAttempts - 1);
  });

  it("respects a custom retry policy", async () => {
    const policy: RetryPolicy = {
      maxAttempts: 2,
      initialDelayMs: 100,
      maxDelayMs: 500,
      multiplier: 2,
    };

    const transport = vi.fn().mockResolvedValue(createResponse(503));

    const result = await executeWithRetry(createRequest(), {
      policy,
      transport,
      delay: noDelay,
    });

    expect(result.statusCode).toBe(503);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(noDelay).toHaveBeenCalledTimes(1);
  });

  it("uses the calculated backoff delay between attempts", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(createResponse(503))
      .mockResolvedValueOnce(createResponse(503))
      .mockResolvedValueOnce(createResponse(200));

    const delay = vi.fn(async (_milliseconds: number) => {});

    await executeWithRetry(createRequest(), {
      transport,
      delay,
    });

    expect(delay).toHaveBeenCalledTimes(2);

    const firstDelay = delay.mock.calls[0][0];
    const secondDelay = delay.mock.calls[1][0];

    expect(firstDelay).toBeGreaterThanOrEqual(0);
    expect(firstDelay).toBeLessThanOrEqual(1_000);

    expect(secondDelay).toBeGreaterThanOrEqual(0);
    expect(secondDelay).toBeLessThanOrEqual(2_000);
  });

  it("rejects an invalid retry policy before executing transport", async () => {
    const policy: RetryPolicy = {
      maxAttempts: 0,
      initialDelayMs: 1_000,
      maxDelayMs: 10_000,
      multiplier: 2,
    };

    const transport = vi.fn().mockResolvedValue(createResponse());

    await expect(
      executeWithRetry(createRequest(), {
        policy,
        transport,
        delay: noDelay,
      }),
    ).rejects.toThrow("maxAttempts must be a positive integer.");

    expect(transport).not.toHaveBeenCalled();
  });

  it("returns the final retryable HTTP response when attempts are exhausted", async () => {
    const transport = vi.fn().mockResolvedValue(createResponse(503));

    const result = await executeWithRetry(createRequest(), {
      transport,
      delay: noDelay,
    });

    expect(result.statusCode).toBe(503);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("throws the final retryable transport error when attempts are exhausted", async () => {
    const error = createRetryableError();

    const transport = vi.fn().mockRejectedValue(error);

    await expect(
      executeWithRetry(createRequest(), {
        transport,
        delay: noDelay,
      }),
    ).rejects.toBe(error);

    expect(transport).toHaveBeenCalledTimes(3);
    expect(noDelay).toHaveBeenCalledTimes(2);
  });
});
