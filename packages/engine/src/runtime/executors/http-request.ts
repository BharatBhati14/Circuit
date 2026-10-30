import type {
  NodeExecutionContext,
  NodeExecutionResult,
  WorkflowNode,
} from "@circuit/contracts";
import { Client } from "undici";

import { InvalidWorkflowError } from "../../errors.js";
import { isPublicIpAddress } from "../../security/ip-address.js";
import { resolvePublicHost } from "../../security/resolve-public-host.js";
import { createPinnedConnector } from "../../security/pinned-connector.js";
import { validateNodeConfig } from "../../validation/node-config.js";
import type { NodeExecutor } from "../types.js";

import {
  HostResolutionError,
  InvalidHostnameError,
  UnsafeHostError,
} from "../../security/host-errors.js";

interface HttpRequestConfig {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "The HTTP request timed out.";
  }

  if (error instanceof Error && error.message === "RESPONSE_TOO_LARGE") {
    return "The HTTP response exceeded the 5 MB size limit.";
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

    let client: Client | undefined;

    try {
      if (node.type !== this.type) {
        throw new InvalidWorkflowError(
          `HttpRequestExecutor cannot execute node type "${node.type}".`,
        );
      }

      validateNodeConfig(node);

      const config = node.config as unknown as HttpRequestConfig;
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

      const hostname = url.hostname
        .toLowerCase()
        .replace(/^\[|\]$/g, "")
        .replace(/\.$/, "");

      const addresses = await resolvePublicHost(hostname);

      const selectedAddress = addresses[0];

      if (!selectedAddress || !isPublicIpAddress(selectedAddress.address)) {
        throw new InvalidWorkflowError(
          "The target hostname does not resolve to a public IP address.",
        );
      }

      const connector = createPinnedConnector(
        hostname,
        selectedAddress.address,
        selectedAddress.family,
      );

      client = new Client(url.origin, {
        connect: connector,
        allowH2: false,
        maxResponseSize: MAX_RESPONSE_SIZE,
        bodyTimeout: config.timeoutMs ?? 10_000,
        headersTimeout: config.timeoutMs ?? 10_000,
      });

      const response = await client.request({
        method: config.method,
        path: `${url.pathname}${url.search}`,
        headers: config.headers,
        ...(config.body !== undefined
          ? { body: JSON.stringify(config.body) }
          : {}),
        signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
      });

      const { statusCode, headers, body } = response;

      const chunks: Buffer[] = [];
      let totalSize = 0;

      for await (const chunk of body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

        totalSize += buffer.length;

        if (totalSize > MAX_RESPONSE_SIZE) {
          throw new Error("RESPONSE_TOO_LARGE");
        }

        chunks.push(buffer);
      }

      const responseText = Buffer.concat(chunks).toString("utf8");

      let responseBody: unknown = responseText;

      if (responseText.length === 0) {
        responseBody = null;
      } else {
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          // Keep non-JSON responses as text.
        }
      }

      return {
        status: "SUCCESS",
        output: {
          statusCode,
          headers,
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

      const responseTooLarge =
        error instanceof Error && error.message === "RESPONSE_TOO_LARGE";

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
          retryable: !responseTooLarge && !dnsFailure && !timedOut,
        },
        startedAt,
        finishedAt,
      };
    } finally {
      if (client) {
        await client.close().catch(() => {
          client?.destroy();
        });
      }
    }
  }
}
