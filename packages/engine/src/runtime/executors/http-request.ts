import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";

import { InvalidWorkflowError } from "../../errors.js";

import { validateNodeConfig } from "../../validation/node-config.js";
import type { NodeExecutor } from "../types.js";

import {
  InvalidHttpHeadersError,
  validateHttpHeaders,
} from "../../security/http-headers.js";

import {
  InvalidJsonResponseError,
  parseResponseBody,
} from "./http/response-parser.js";
import {
  InvalidResponseHeadersError,
  normalizeResponseHeaders,
} from "./http/response-headers.js";

import {
  executeHttpTransport,
  HttpResponseTooLargeError,
} from "./http/http-transport.js";

import {
  HostResolutionError,
  InvalidHostnameError,
  UnsafeHostError,
} from "../../security/host-errors.js";
import { HttpRedirectError } from "./http/redirect-policy.js";
import { isRetryableTransportError } from "./http/retryable-errors.js";

interface HttpRequestConfig {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

// const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "The HTTP request timed out.";
  }

  if (error instanceof HttpResponseTooLargeError) {
    return error.message;
  }

  return "The HTTP request failed due to a network or request error.";
}

export class HttpRequestExecutor implements NodeExecutor {
  readonly type = "http_request" as const;

  async execute(
    node: WorkflowNode,
    _context: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const startedAt = new Date().toISOString();

    // let client: Client | undefined;

    try {
      if (node.type !== this.type) {
        throw new InvalidWorkflowError(
          `HttpRequestExecutor cannot execute node type "${node.type}".`,
        );
      }

      validateNodeConfig(node);

      const config = node.config as unknown as HttpRequestConfig;

      validateHttpHeaders(config.headers);

      const url = new URL(config.url);

      if (!["http:", "https:"].includes(url.protocol)) {
        throw new InvalidWorkflowError(
          "Only HTTP and HTTPS URLs are supported.",
        );
      }

      if (url.username || url.password) {
        throw new InvalidWorkflowError(
          "URLs must not contain embedded credentials.",
        );
      }

      const response = await executeHttpTransport({
        url,
        method: config.method,
        headers: config.headers,
        body:
          config.body !== undefined ? JSON.stringify(config.body) : undefined,
        timeoutMs: config.timeoutMs ?? 10_000,
      });

      const normalizedHeaders = normalizeResponseHeaders(response.headers);

      const responseBody = parseResponseBody(
        response.body,
        normalizedHeaders["content-type"],
      );

      return {
        status: "SUCCESS",
        output: {
          statusCode: response.statusCode,
          headers: normalizedHeaders,
          body: responseBody,
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();

      if (error instanceof InvalidWorkflowError) {
        return {
          status: "FAILED",
          error: {
            code: "INVALID_NODE_CONFIG",
            message: error.message,
            retryable: false,
          },
          startedAt,
          finishedAt,
        };
      }

      if (error instanceof HttpRedirectError) {
        return {
          status: "FAILED",
          error: {
            code: error.code,
            message: error.message,
            retryable: false,
          },
          startedAt,
          finishedAt,
        };
      }

      if (error instanceof InvalidHttpHeadersError) {
        return {
          status: "FAILED",
          error: {
            code: "HTTP_INVALID_HEADERS",
            message: error.message,
            retryable: false,
          },
          startedAt,
          finishedAt,
        };
      }

      if (error instanceof InvalidResponseHeadersError) {
        return {
          status: "FAILED",
          error: {
            code: "HTTP_INVALID_RESPONSE_HEADERS",
            message: error.message,
            retryable: false,
          },
          startedAt,
          finishedAt,
        };
      }

      if (error instanceof InvalidJsonResponseError) {
        return {
          status: "FAILED",
          error: {
            code: "HTTP_INVALID_JSON_RESPONSE",
            message: error.message,
            retryable: false,
          },
          startedAt,
          finishedAt,
        };
      }

      if (error instanceof InvalidHostnameError) {
        return {
          status: "FAILED",
          error: {
            code: "HTTP_INVALID_HOST",
            message: "The target hostname is invalid.",
            retryable: false,
          },
          startedAt,
          finishedAt,
        };
      }

      if (error instanceof UnsafeHostError) {
        return {
          status: "FAILED",
          error: {
            code: "HTTP_SSRF_BLOCKED",
            message:
              "The request was blocked because the target resolves to a non-public IP address.",
            retryable: false,
          },
          startedAt,
          finishedAt,
        };
      }

      if (error instanceof HostResolutionError) {
        const retryableDnsCodes = ["EAI_AGAIN", "ETIMEOUT", "ESERVFAIL"];

        return {
          status: "FAILED",
          error: {
            code: "HTTP_DNS_FAILED",
            message: "The target hostname could not be resolved.",
            retryable: retryableDnsCodes.includes(error.dnsCode ?? ""),
          },
          startedAt,
          finishedAt,
        };
      }

      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");

      const responseTooLarge = error instanceof HttpResponseTooLargeError;

      const dnsFailure =
        error instanceof Error &&
        (error.name === "DNSResolutionError" ||
          ["ENOTFOUND", "ENODATA", "EAI_AGAIN"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          ));

      return {
        status: "FAILED",
        error: {
          code: timedOut
            ? "HTTP_REQUEST_TIMEOUT"
            : responseTooLarge
              ? "HTTP_RESPONSE_TOO_LARGE"
              : dnsFailure
                ? "HTTP_DNS_FAILED"
                : "HTTP_REQUEST_FAILED",
          message: getErrorMessage(error),
          retryable: isRetryableTransportError(error),
        },
        startedAt,
        finishedAt,
      };
    }
  }
}
