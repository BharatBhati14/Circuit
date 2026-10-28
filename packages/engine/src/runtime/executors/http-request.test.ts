import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeExecutionContext, WorkflowNode } from "@circuit/contracts";
import { HttpRequestExecutor } from "./http-request.js";

const executor = new HttpRequestExecutor();

const context: NodeExecutionContext = {
  executionId: "execution-1",
  workflowId: "workflow-1",
  workflowVersion: 1,
  nodeId: "http-1",
  attempt: 1,
  input: {},
  previousOutputs: {},
};

function createNode(
  config: Record<string, unknown> = {
    method: "GET",
    url: "https://api.example.com/data",
  },
  type: WorkflowNode["type"] = "http_request",
): WorkflowNode {
  return {
    id: "http-1",
    type,
    config,
    position: { x: 0, y: 0 },
  };
}

function mockResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {
    "content-type": "application/json",
  },
): Response {
  return new Response(
    status === 204 || status === 205 || status === 304 ? null : body,
    { status, headers },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HttpRequestExecutor", () => {
  it("parses a successful JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse('{"message":"hello"}')),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status !== "SUCCESS") {
      throw new Error("Expected successful execution");
    }

    expect(result.output).toMatchObject({
      statusCode: 200,
      body: { message: "hello" },
    });
  });

  it("preserves a plain-text response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse("Hello from API", 200, {
          "content-type": "text/plain",
        }),
      ),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status !== "SUCCESS") {
      throw new Error("Expected successful execution");
    }

    expect(result.output.body).toBe("Hello from API");
  });

  it("handles an empty response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse("", 204)));

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status !== "SUCCESS") {
      throw new Error("Expected successful execution");
    }

    expect(result.output.body).toBeNull();
    expect(result.output.statusCode).toBe(204);
  });

  it("returns HTTP 500 as a structured HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse('{"error":"server error"}', 500)),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("SUCCESS");

    if (result.status !== "SUCCESS") {
      throw new Error("Expected HTTP response to be returned");
    }

    expect(result.output).toMatchObject({
      statusCode: 500,
      body: { error: "server error" },
    });
  });

  it("passes configured headers and a serialized JSON body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse('{"created":true}'));

    vi.stubGlobal("fetch", fetchMock);

    const node = createNode({
      method: "POST",
      url: "https://api.example.com/data",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: { name: "Asha" },
      timeoutMs: 5000,
    });

    const result = await executor.execute(node, context);

    expect(result.status).toBe("SUCCESS");
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.example.com/data");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    });
    expect(options.body).toBe('{"name":"Asha"}');
    expect(options.redirect).toBe("manual");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits the body when it is not configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse('{"ok":true}'));

    vi.stubGlobal("fetch", fetchMock);

    await executor.execute(createNode(), context);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(options.body).toBeUndefined();
  });

  it("returns a structured failure for network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Network unavailable")),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") {
      throw new Error("Expected failed execution");
    }

    expect(result.error.code).toBe("HTTP_REQUEST_FAILED");
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).not.toContain("Network unavailable");
  });

  it("returns a structured failure for timeouts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "TimeoutError")),
    );

    const result = await executor.execute(createNode(), context);

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") {
      throw new Error("Expected failed execution");
    }

    expect(result.error.code).toBe("HTTP_REQUEST_TIMEOUT");
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toBe("The HTTP request timed out.");
  });

  it("rejects an incorrect node type", async () => {
    const result = await executor.execute(
      createNode({}, "data_transform"),
      context,
    );

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") {
      throw new Error("Expected failed execution");
    }

    expect(result.error.code).toBe("INVALID_NODE_CONFIG");
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toContain("HttpRequestExecutor");
  });

  it("rejects invalid configuration without calling fetch", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const result = await executor.execute(
      createNode({
        method: "GET",
        url: "ftp://api.example.com/data",
      }),
      context,
    );

    expect(result.status).toBe("FAILED");

    if (result.status !== "FAILED") {
      throw new Error("Expected failed execution");
    }

    expect(result.error.code).toBe("INVALID_NODE_CONFIG");
    expect(result.error.retryable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns valid ISO timestamps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse('{"ok":true}')),
    );

    const result = await executor.execute(createNode(), context);

    expect(Date.parse(result.startedAt)).not.toBeNaN();
    expect(Date.parse(result.finishedAt)).not.toBeNaN();
    expect(() => new Date(result.startedAt).toISOString()).not.toThrow();
    expect(() => new Date(result.finishedAt).toISOString()).not.toThrow();
  });
});
