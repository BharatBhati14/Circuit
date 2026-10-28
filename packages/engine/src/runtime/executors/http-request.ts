import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";
import { InvalidWorkflowError } from "../../errors.js";
import { validateNodeConfig } from "../../validation/node-config.js";
import type { NodeExecutor } from "../types.js";

interface HttpRequestConfig {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "The HTTP request timed out.";
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

    try {
      if (node.type !== this.type) {
        throw new InvalidWorkflowError(
          `HttpRequestExecutor cannot execute node type "${node.type}".`,
        );
      }

      validateNodeConfig(node);

      const config = node.config as unknown as HttpRequestConfig;

      const response = await fetch(config.url, {
        method: config.method,
        headers: config.headers,
        ...(config.body !== undefined
          ? { body: JSON.stringify(config.body) }
          : {}),
        signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
        redirect: "manual",
      });

      const responseText = await response.text();

      let body: unknown = responseText;

      if (responseText.length > 0) {
        try {
          body = JSON.parse(responseText);
        } catch {
          // Preserve non-JSON response bodies as text.
        }
      } else {
        body = null;
      }

      const output: Record<string, unknown> = {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      };

      return {
        status: "SUCCESS",
        output,
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

      const timedOut = error instanceof Error && error.name === "TimeoutError";

      return {
        status: "FAILED",
        error: {
          code: timedOut ? "HTTP_REQUEST_TIMEOUT" : "HTTP_REQUEST_FAILED",
          message: getErrorMessage(error),
          retryable: true,
        },
        startedAt,
        finishedAt,
      };
    }
  }
}
