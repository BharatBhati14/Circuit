import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HostResolutionError,
  InvalidHostnameError,
  UnsafeHostError,
} from "../../security/host-errors.js";

const {
  clientRequestMock,
  clientCloseMock,
  clientConstructorMock,
  resolvePublicHostMock,
  createPinnedConnectorMock,
} = vi.hoisted(() => ({
  clientRequestMock: vi.fn(),
  clientCloseMock: vi.fn(),
  clientConstructorMock: vi.fn(),
  resolvePublicHostMock: vi.fn(),
  createPinnedConnectorMock: vi.fn(),
}));

const clientDestroyMock = vi.fn();

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();

  return {
    ...actual,
    Client: vi.fn(function () {
      return {
        request: clientRequestMock,
        close: clientCloseMock,
        destroy: clientDestroyMock,
      };
    }),
  };
});

vi.mock("../../security/resolve-public-host.js", () => ({
  resolvePublicHost: resolvePublicHostMock,
}));

vi.mock("../../security/pinned-connector.js", () => ({
  createPinnedConnector: createPinnedConnectorMock,
}));

import type { NodeExecutionContext, WorkflowNode } from "@circuit/contracts";
import { HttpRequestExecutor } from "./http-request.js";

const context: NodeExecutionContext = {
  executionId: "execution-1",
  workflowId: "workflow-1",
  workflowVersion: 1,
  nodeId: "node-1",
  attempt: 1,
  input: {},
  previousOutputs: {},
};

function createNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "node-1",
    type: "http_request",
    config: {
      method: "GET",
      url: "https://example.com",
    },
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function createResponse(
  body: string,
  statusCode = 200,
  headers: Record<string, string> = {
    "content-type": "application/json",
  },
) {
  return {
    statusCode,
    headers,
    body: (async function* () {
      if (body.length > 0) {
        yield Buffer.from(body);
      }
    })(),
  };
}

describe("HttpRequestExecutor", () => {
  it.each(["Host", "host", "HOST", "hOsT"])(
    "rejects the %s header",
    async (headerName) => {
      const node = createNode({
        config: {
          method: "GET",
          url: "https://example.com",
          headers: {
            [headerName]: "attacker.example.com",
          },
        },
      });

      const result = await executor.execute(node, context);

      expect(result.status).toBe("FAILED");

      if (result.status !== "FAILED") {
        throw new Error("Expected execution to fail");
      }

      expect(result.error).toEqual({
        code: "HTTP_INVALID_HEADERS",
        message: "The Host header cannot be overridden.",
        retryable: false,
      });

      expect(resolvePublicHostMock).not.toHaveBeenCalled();
      expect(clientRequestMock).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid header names before DNS resolution", async () => {
    const node = createNode({
      config: {
        method: "GET",
        url: "https://example.com",
        headers: {
          "invalid header": "value",
        },
      },
    });

    const result = await executor.execute(node, context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") return;

    expect(result.error.code).toBe("HTTP_INVALID_HEADERS");
    expect(result.error.retryable).toBe(false);
    expect(resolvePublicHostMock).not.toHaveBeenCalled();
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  it("rejects CRLF header injection before DNS resolution", async () => {
    const node = createNode({
      config: {
        method: "GET",
        url: "https://example.com",
        headers: {
          "x-custom": "value\r\nInjected: true",
        },
      },
    });

    const result = await executor.execute(node, context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") return;

    expect(result.error.code).toBe("HTTP_INVALID_HEADERS");
    expect(result.error.retryable).toBe(false);
    expect(resolvePublicHostMock).not.toHaveBeenCalled();
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  it("parses JSON responses", async () => {
    clientRequestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "content-type": "application/json",
      },
      body: (async function* () {
        yield Buffer.from('{"message":"hello"}');
      })(),
    });

    const result = await executor.execute(createNode(), context);

    expect(result).toMatchObject({
      status: "SUCCESS",
      output: {
        statusCode: 200,
        body: {
          type: "json",
          value: {
            message: "hello",
          },
        },
      },
    });
  });

  it("parses JSON responses with charset parameters", async () => {
    clientRequestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: (async function* () {
        yield Buffer.from('{"success":true}');
      })(),
    });

    const result = await executor.execute(createNode(), context);

    expect(result).toMatchObject({
      status: "SUCCESS",
      output: {
        body: {
          type: "json",
          value: { success: true },
        },
      },
    });
  });

  it("parses application/problem+json responses", async () => {
    clientRequestMock.mockResolvedValueOnce({
      statusCode: 404,
      headers: {
        "content-type": "application/problem+json",
      },
      body: (async function* () {
        yield Buffer.from('{"title":"Not Found"}');
      })(),
    });

    const result = await executor.execute(createNode(), context);

    expect(result).toMatchObject({
      status: "SUCCESS",
      output: {
        statusCode: 404,
        body: {
          type: "json",
          value: { title: "Not Found" },
        },
      },
    });
  });

  it("returns text responses as text", async () => {
    clientRequestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "content-type": "text/plain",
      },
      body: (async function* () {
        yield Buffer.from("Hello Circuit");
      })(),
    });

    const result = await executor.execute(createNode(), context);

    expect(result).toMatchObject({
      status: "SUCCESS",
      output: {
        body: {
          type: "text",
          value: "Hello Circuit",
        },
      },
    });
  });

  it("returns HTML responses as text", async () => {
    clientRequestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "content-type": "text/html",
      },
      body: (async function* () {
        yield Buffer.from("<h1>Hello</h1>");
      })(),
    });

    const result = await executor.execute(createNode(), context);

    expect(result).toMatchObject({
      status: "SUCCESS",
      output: {
        body: {
          type: "text",
          value: "<h1>Hello</h1>",
        },
      },
    });
  });

  it("returns null for empty responses", async () => {
    clientRequestMock.mockResolvedValueOnce({
      statusCode: 204,
      headers: {},
      body: (async function* () {})(),
    });

    const result = await executor.execute(createNode(), context);

    expect(result).toMatchObject({
      status: "SUCCESS",
      output: {
        statusCode: 204,
        body: {
          type: "empty",
          value: null,
        },
      },
    });
  });

  it("returns binary responses as Base64", async () => {
    clientRequestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "content-type": "application/octet-stream",
      },
      body: (async function* () {
        yield Buffer.from([0, 1, 2, 3]);
      })(),
    });

    const result = await executor.execute(createNode(), context);

    expect(result).toMatchObject({
      status: "SUCCESS",
      output: {
        body: {
          type: "binary",
          value: "AAECAw==",
        },
      },
    });
  });

  it("returns a structured failure for malformed JSON responses", async () => {
    clientRequestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "content-type": "application/json",
      },
      body: (async function* () {
        yield Buffer.from('{"message":');
      })(),
    });

    const result = await executor.execute(createNode(), context);

    expect(result).toMatchObject({
      status: "FAILED",
      error: {
        code: "HTTP_INVALID_JSON_RESPONSE",
        message: "The server returned malformed JSON.",
        retryable: false,
      },
    });
  });

  it("returns a non-retryable failure for an invalid hostname", async () => {
    resolvePublicHostMock.mockRejectedValueOnce(new InvalidHostnameError());

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") {
      throw new Error("Expected execution to fail");
    }

    expect(result.error).toEqual({
      code: "HTTP_INVALID_HOST",
      message: "The target hostname is invalid.",
      retryable: false,
    });

    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  it("blocks requests to non-public IP addresses", async () => {
    resolvePublicHostMock.mockRejectedValueOnce(new UnsafeHostError());

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") {
      throw new Error("Expected execution to fail");
    }

    expect(result.error).toEqual({
      code: "HTTP_SSRF_BLOCKED",
      message:
        "The request was blocked because the target resolves to a non-public IP address.",
      retryable: false,
    });

    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  it("marks temporary DNS failures as retryable", async () => {
    const cause = Object.assign(new Error("Temporary DNS failure"), {
      code: "EAI_AGAIN",
    });

    resolvePublicHostMock.mockRejectedValueOnce(
      new HostResolutionError("Failed to resolve hostname", cause),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") {
      throw new Error("Expected execution to fail");
    }

    expect(result.error).toEqual({
      code: "HTTP_DNS_FAILED",
      message: "The target hostname could not be resolved.",
      retryable: true,
    });

    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  it("marks permanent DNS failures as non-retryable", async () => {
    const cause = Object.assign(new Error("Hostname not found"), {
      code: "ENOTFOUND",
    });

    resolvePublicHostMock.mockRejectedValueOnce(
      new HostResolutionError("Failed to resolve hostname", cause),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") {
      throw new Error("Expected execution to fail");
    }

    expect(result.error).toEqual({
      code: "HTTP_DNS_FAILED",
      message: "The target hostname could not be resolved.",
      retryable: false,
    });

    expect(clientRequestMock).not.toHaveBeenCalled();
  });
  const executor = new HttpRequestExecutor();

  beforeEach(() => {
    vi.clearAllMocks();

    resolvePublicHostMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);

    createPinnedConnectorMock.mockReturnValue(vi.fn());

    clientRequestMock.mockResolvedValue(
      createResponse('{"message":"success"}'),
    );

    clientCloseMock.mockResolvedValue(undefined);
  });

  it("parses a successful JSON response", async () => {
    clientRequestMock.mockResolvedValue(
      createResponse('{"message":"success"}'),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status !== "SUCCESS") return;

    expect(result.output.body).toEqual({
      type: "json",
      value: {
        message: "success",
      },
    });
  });

  it("normalizes response header names to lowercase", async () => {
    clientRequestMock.mockResolvedValueOnce(
      createResponse(JSON.stringify({ message: "success" }), 200, {
        "Content-Type": "application/json",
        "X-Custom-Header": "Circuit",
      }),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status === "SUCCESS") {
      expect(result.output.headers).toMatchObject({
        "content-type": "application/json",
        "x-custom-header": "Circuit",
      });
    }
  });

  it("preserves multiple Set-Cookie response header values", async () => {
    clientRequestMock.mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        "set-cookie": ["session=abc; HttpOnly", "theme=dark; Secure"],
      },
      body: (async function* () {
        yield Buffer.from("{}");
      })(),
    });

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status === "SUCCESS") {
      const headers = result.output.headers as Record<
        string,
        string | string[] | undefined
      >;

      expect(headers["set-cookie"]).toEqual([
        "session=abc; HttpOnly",
        "theme=dark; Secure",
      ]);
    }
  });

  it("uses normalized content-type when parsing response bodies", async () => {
    clientRequestMock.mockResolvedValueOnce(
      createResponse(JSON.stringify({ message: "success" }), 200, {
        "Content-Type": "application/json",
      }),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status === "SUCCESS") {
      expect(result.output.body).toEqual({
        type: "json",
        value: { message: "success" },
      });
    }
  });

  it("returns a non-retryable failure for invalid response headers", async () => {
    clientRequestMock.mockResolvedValueOnce(
      createResponse("{}", 200, {
        "Content-Type": "application/json",
        "content-type": "text/plain",
      } as unknown as Record<string, string>),
    );

    const result = await executor.execute(createNode(), context);

    expect(result).toMatchObject({
      status: "FAILED",
      error: {
        code: "HTTP_INVALID_RESPONSE_HEADERS",
        retryable: false,
      },
    });
  });

  it("preserves a plain-text response", async () => {
    clientRequestMock.mockResolvedValue(
      createResponse("Hello Circuit", 200, {
        "content-type": "text/plain",
      }),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status !== "SUCCESS") return;

    expect(result.output.body).toEqual({
      type: "text",
      value: "Hello Circuit",
    });
  });

  it("handles an empty response body", async () => {
    clientRequestMock.mockResolvedValue(createResponse("", 204));

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status !== "SUCCESS") return;

    expect(result.output.body).toEqual({
      type: "empty",
      value: null,
    });
  });

  it("returns HTTP 500 as a structured HTTP response", async () => {
    clientRequestMock.mockResolvedValue(
      createResponse('{"error":"server error"}', 500),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status !== "SUCCESS") return;

    expect(result.output.statusCode).toBe(500);
    expect(result.output.body).toEqual({
      type: "json",
      value: {
        error: "server error",
      },
    });
  });

  it("passes configured headers and a serialized JSON body", async () => {
    const node = createNode({
      config: {
        method: "POST",
        url: "https://example.com/api",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
        },
        body: {
          name: "Circuit",
        },
      },
    });

    await executor.execute(node, context);

    expect(clientRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/api",
        headers: expect.objectContaining({
          "content-type": "application/json",
          authorization: "Bearer test-token",
        }),
        body: JSON.stringify({
          name: "Circuit",
        }),
      }),
    );
  });

  it("omits the body when it is not configured", async () => {
    await executor.execute(createNode(), context);

    expect(clientRequestMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        body: expect.anything(),
      }),
    );
  });

  it("returns a structured failure for network errors", async () => {
    clientRequestMock.mockRejectedValue(new Error("Connection refused"));

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") return;

    expect(result.error.code).toBe("HTTP_REQUEST_FAILED");
    expect(result.error.retryable).toBe(true);
  });

  it("returns a structured failure for timeouts", async () => {
    const timeoutError = new Error("Request timed out");
    timeoutError.name = "TimeoutError";

    clientRequestMock.mockRejectedValue(timeoutError);

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") return;

    expect(result.error.code).toBe("HTTP_REQUEST_TIMEOUT");
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toBe("The HTTP request timed out.");
  });

  it("rejects an incorrect node type", async () => {
    const node = createNode({
      type: "manual_trigger",
    });

    const result = await executor.execute(node, context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") return;

    expect(result.error.code).toBe("INVALID_NODE_CONFIG");
  });

  it("rejects invalid configuration without making a request", async () => {
    const node = createNode({
      config: {
        method: "INVALID",
        url: "https://example.com",
      },
    });

    const result = await executor.execute(node, context);

    expect(result.status).toBe("FAILED");
    expect(resolvePublicHostMock).not.toHaveBeenCalled();
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  it("returns valid ISO timestamps", async () => {
    const result = await executor.execute(createNode(), context);

    expect(result.startedAt).toBeDefined();
    expect(result.finishedAt).toBeDefined();

    expect(Number.isNaN(Date.parse(result.startedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(result.finishedAt))).toBe(false);
  });

  it("resolves and pins the hostname before making a request", async () => {
    await executor.execute(createNode(), context);

    expect(resolvePublicHostMock).toHaveBeenCalledWith("example.com");

    expect(createPinnedConnectorMock).toHaveBeenCalledWith(
      "example.com",
      "93.184.216.34",
      4,
    );
  });

  it("closes the client after a successful request", async () => {
    await executor.execute(createNode(), context);

    expect(clientCloseMock).toHaveBeenCalledOnce();
  });

  it("closes the client after a failed request", async () => {
    clientRequestMock.mockRejectedValue(new Error("Connection refused"));

    await executor.execute(createNode(), context);

    expect(clientCloseMock).toHaveBeenCalledOnce();
  });

  it("does not make a request when DNS resolution fails", async () => {
    resolvePublicHostMock.mockRejectedValue(
      new Error("Failed to resolve hostname"),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("FAILED");
    expect(clientRequestMock).not.toHaveBeenCalled();
  });
});
