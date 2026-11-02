import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeHttpTransport,
  HttpResponseTooLargeError,
} from "./http-transport.js";

import { resolvePublicHost } from "../../../security/resolve-public-host.js";
import { createPinnedConnector } from "../../../security/pinned-connector.js";

vi.mock("../../../security/resolve-public-host.js", () => ({
  resolvePublicHost: vi.fn(),
}));

vi.mock("../../../security/pinned-connector.js", () => ({
  createPinnedConnector: vi.fn(() => vi.fn()),
}));

vi.mock("undici", () => {
  const mockRequest = vi.fn();
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const mockDestroy = vi.fn();

  class MockClient {
    request = mockRequest;
    close = mockClose;
    destroy = mockDestroy;

    constructor() {}
  }

  return {
    Client: MockClient,
    __mockRequest: mockRequest,
    __mockClose: mockClose,
    __mockDestroy: mockDestroy,
  };
});

import * as undiciMock from "undici";

const mockedRequest = (
  undiciMock as unknown as {
    __mockRequest: ReturnType<typeof vi.fn>;
  }
).__mockRequest;

const mockedClose = (
  undiciMock as unknown as {
    __mockClose: ReturnType<typeof vi.fn>;
  }
).__mockClose;

const mockedDestroy = (
  undiciMock as unknown as {
    __mockDestroy: ReturnType<typeof vi.fn>;
  }
).__mockDestroy;

const mockedResolvePublicHost = vi.mocked(resolvePublicHost);
const mockedCreatePinnedConnector = vi.mocked(createPinnedConnector);

function createResponse(
  options: {
    statusCode?: number;
    headers?: Record<string, string | string[] | undefined>;
    chunks?: Buffer[];
  } = {},
) {
  return {
    statusCode: options.statusCode ?? 200,
    headers: options.headers ?? {
      "content-type": "application/json",
    },
    body: (async function* () {
      for (const chunk of options.chunks ?? [Buffer.from('{"success":true}')]) {
        yield chunk;
      }
    })(),
  };
}

function createRequest(
  overrides: Partial<{
    url: URL;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
  }> = {},
) {
  return {
    url: new URL("https://api.example.com/users"),
    method: "GET" as const,
    timeoutMs: 10_000,
    ...overrides,
  };
}

describe("executeHttpTransport", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("executes an HTTP request successfully", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockResolvedValue(createResponse());

    const result = await executeHttpTransport(createRequest());

    expect(result.statusCode).toBe(200);
    expect(result.body.toString()).toBe('{"success":true}');
    expect(result.headers["content-type"]).toBe("application/json");
  });

  it("resolves the hostname before connecting", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockResolvedValue(createResponse());

    await executeHttpTransport(createRequest());

    expect(mockedResolvePublicHost).toHaveBeenCalledWith("api.example.com");
  });

  it("creates a pinned connector using the validated IP", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockResolvedValue(createResponse());

    await executeHttpTransport(createRequest());

    expect(mockedCreatePinnedConnector).toHaveBeenCalledWith(
      "api.example.com",
      "93.184.216.34",
      4,
    );
  });

  it("rejects when DNS returns no addresses", async () => {
    mockedResolvePublicHost.mockResolvedValue([]);

    await expect(executeHttpTransport(createRequest())).rejects.toThrow();
  });

  it("propagates DNS resolution errors", async () => {
    mockedResolvePublicHost.mockRejectedValue(new Error("DNS failure"));

    await expect(executeHttpTransport(createRequest())).rejects.toThrow(
      "DNS failure",
    );
  });

  it("sends the configured HTTP method", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockResolvedValue(createResponse());

    await executeHttpTransport(
      createRequest({
        method: "POST",
      }),
    );

    expect(mockedRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("sends custom headers", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockResolvedValue(createResponse());

    const headers = {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    };

    await executeHttpTransport(
      createRequest({
        headers,
      }),
    );

    expect(mockedRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers,
      }),
    );
  });

  it("sends the request body", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockResolvedValue(createResponse());

    await executeHttpTransport(
      createRequest({
        method: "POST",
        body: '{"name":"Circuit"}',
      }),
    );

    expect(mockedRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '{"name":"Circuit"}',
      }),
    );
  });

  it("preserves query parameters in the request path", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockResolvedValue(createResponse());

    await executeHttpTransport(
      createRequest({
        url: new URL("https://api.example.com/users?page=2&limit=10"),
      }),
    );

    expect(mockedRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/users?page=2&limit=10",
      }),
    );
  });

  it("converts POST to GET on a 301 redirect and removes the body", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);

    mockedRequest
      .mockResolvedValueOnce(
        createResponse({
          statusCode: 301,
          headers: { location: "/redirected" },
          chunks: [],
        }),
      )
      .mockResolvedValueOnce(createResponse());

    await executeHttpTransport(
      createRequest({
        method: "POST",
        body: '{"name":"Circuit"}',
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token",
        },
      }),
    );

    const secondRequest = mockedRequest.mock.calls[1]?.[0];

    expect(secondRequest.method).toBe("GET");
    expect(secondRequest.body).toBeUndefined();
    expect(secondRequest.headers).toEqual({
      authorization: "Bearer token",
    });
  });

  it("converts POST to GET on a 302 redirect and removes the body", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);

    mockedRequest
      .mockResolvedValueOnce(
        createResponse({
          statusCode: 302,
          headers: { location: "/redirected" },
          chunks: [],
        }),
      )
      .mockResolvedValueOnce(createResponse());

    await executeHttpTransport(
      createRequest({
        method: "POST",
        body: '{"name":"Circuit"}',
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token",
        },
      }),
    );

    const secondRequest = mockedRequest.mock.calls[1]?.[0];

    expect(secondRequest.method).toBe("GET");
    expect(secondRequest.body).toBeUndefined();
    expect(secondRequest.headers).toEqual({
      authorization: "Bearer token",
    });
  });

  it("converts PUT to GET on a 303 redirect and removes the body", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);

    mockedRequest
      .mockResolvedValueOnce(
        createResponse({
          statusCode: 303,
          headers: { location: "/redirected" },
          chunks: [],
        }),
      )
      .mockResolvedValueOnce(createResponse());

    await executeHttpTransport(
      createRequest({
        method: "POST",
        body: '{"name":"Circuit"}',
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token",
        },
      }),
    );

    const secondRequest = mockedRequest.mock.calls[1]?.[0];

    expect(secondRequest.method).toBe("GET");
    expect(secondRequest.body).toBeUndefined();
    expect(secondRequest.headers).toEqual({
      authorization: "Bearer token",
    });
  });

  it("preserves method and body on a 307 redirect", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);

    mockedRequest
      .mockResolvedValueOnce(
        createResponse({
          statusCode: 307,
          headers: { location: "/redirected" },
          chunks: [],
        }),
      )
      .mockResolvedValueOnce(createResponse());

    await executeHttpTransport(
      createRequest({
        method: "POST",
        body: '{"name":"Circuit"}',
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const secondRequest = mockedRequest.mock.calls[1]?.[0];

    expect(secondRequest.method).toBe("POST");
    expect(secondRequest.body).toBe('{"name":"Circuit"}');
    expect(secondRequest.headers).toEqual({
      "content-type": "application/json",
    });
  });

  it("preserves method and body on a 308 redirect", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);

    mockedRequest
      .mockResolvedValueOnce(
        createResponse({
          statusCode: 308,
          headers: { location: "/redirected" },
          chunks: [],
        }),
      )
      .mockResolvedValueOnce(createResponse());

    await executeHttpTransport(
      createRequest({
        method: "POST",
        body: '{"name":"Circuit"}',
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const secondRequest = mockedRequest.mock.calls[1]?.[0];

    expect(secondRequest.method).toBe("POST");
    expect(secondRequest.body).toBe('{"name":"Circuit"}');
    expect(secondRequest.headers).toEqual({
      "content-type": "application/json",
    });
  });

  it("rejects redirect loops", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);

    mockedRequest.mockResolvedValueOnce(
      createResponse({
        statusCode: 302,
        headers: { location: "/users" },
        chunks: [],
      }),
    );

    await expect(executeHttpTransport(createRequest())).rejects.toMatchObject({
      code: "HTTP_REDIRECT_LOOP",
    });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects exceeding the maximum limit", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ]);

    let redirectNumber = 0;

    mockedRequest.mockImplementation(async () => {
      redirectNumber += 1;

      return createResponse({
        statusCode: 302,
        headers: {
          location: `/next-${redirectNumber}`,
        },
        chunks: [],
      });
    });

    await expect(executeHttpTransport(createRequest())).rejects.toMatchObject({
      code: "HTTP_TOO_MANY_REDIRECTS",
    });

    expect(mockedRequest).toHaveBeenCalledTimes(6);
  });

  it("follows a redirect and returns the final response", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest
      .mockResolvedValueOnce(
        createResponse({
          statusCode: 302,
          headers: {
            location: "/new-location",
          },
          chunks: [],
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          statusCode: 200,
          headers: {
            "content-type": "application/json",
          },
          chunks: [Buffer.from('{"redirected":true}')],
        }),
      );

    const result = await executeHttpTransport(createRequest());

    expect(result.statusCode).toBe(200);
    expect(result.body.toString()).toBe('{"redirected":true}');
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(mockedResolvePublicHost).toHaveBeenCalledTimes(2);
  });

  it("strips sensitive headers on cross-origin redirects", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest
      .mockResolvedValueOnce(
        createResponse({
          statusCode: 302,
          headers: {
            location: "https://other.example.com/users",
          },
          chunks: [],
        }),
      )
      .mockResolvedValueOnce(createResponse());

    await executeHttpTransport(
      createRequest({
        headers: {
          authorization: "Bearer secret-token",
          cookie: "session=secret",
          "proxy-authorization": "Basic secret",
          "content-type": "application/json",
          "x-api-version": "1",
        },
      }),
    );

    expect(mockedRequest).toHaveBeenCalledTimes(2);

    const secondRequest = mockedRequest.mock.calls[1]?.[0];

    expect(secondRequest.headers).toEqual({
      "content-type": "application/json",
      "x-api-version": "1",
    });

    expect(mockedResolvePublicHost).toHaveBeenCalledTimes(2);

    expect(mockedCreatePinnedConnector).toHaveBeenCalledTimes(2);
  });

  it("rejects responses exceeding 5 MB", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockResolvedValue(
      createResponse({
        chunks: [Buffer.alloc(5 * 1024 * 1024), Buffer.from("x")],
      }),
    );

    await expect(executeHttpTransport(createRequest())).rejects.toBeInstanceOf(
      HttpResponseTooLargeError,
    );
  });

  it("closes the client after successful execution", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockResolvedValue(createResponse());

    await executeHttpTransport(createRequest());

    expect(mockedClose).toHaveBeenCalledTimes(1);
  });

  it("closes the client after request failure", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockRejectedValue(new Error("Network failure"));

    await expect(executeHttpTransport(createRequest())).rejects.toThrow(
      "Network failure",
    );

    expect(mockedClose).toHaveBeenCalledTimes(1);
  });

  it("destroys the client when graceful close fails", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockResolvedValue(createResponse());

    mockedClose.mockRejectedValueOnce(new Error("Close failed"));

    await executeHttpTransport(createRequest());

    expect(mockedDestroy).toHaveBeenCalledTimes(1);
  });

  it("does not connect when the URL protocol is unsupported", async () => {
    await expect(
      executeHttpTransport(
        createRequest({
          url: new URL("ftp://example.com/file"),
        }),
      ),
    ).rejects.toThrow();

    expect(mockedResolvePublicHost).not.toHaveBeenCalled();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("rejects URLs containing embedded credentials", async () => {
    await expect(
      executeHttpTransport(
        createRequest({
          url: new URL("https://user:password@example.com"),
        }),
      ),
    ).rejects.toThrow();

    expect(mockedResolvePublicHost).not.toHaveBeenCalled();
  });

  it("aborts the request when the configured timeout is reached", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    mockedRequest.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }

          signal.addEventListener(
            "abort",
            () => {
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );

    await expect(
      executeHttpTransport(
        createRequest({
          timeoutMs: 10,
        }),
      ),
    ).rejects.toMatchObject({
      name: "TimeoutError",
    });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedClose).toHaveBeenCalledTimes(1);
  });

  it("normalizes Undici response-size errors", async () => {
    mockedResolvePublicHost.mockResolvedValue([
      {
        address: "93.184.216.34",
        family: 4,
      },
    ]);

    const undiciError = Object.assign(
      new Error("Response content exceeded max size"),
      {
        name: "ResponseExceededMaxSizeError",
        code: "UND_ERR_RES_EXCEEDED_MAX_SIZE",
      },
    );

    mockedRequest.mockResolvedValue({
      statusCode: 200,
      headers: {
        "content-type": "text/plain",
      },
      body: (async function* () {
        throw undiciError;
      })(),
    });

    await expect(executeHttpTransport(createRequest())).rejects.toBeInstanceOf(
      HttpResponseTooLargeError,
    );

    expect(mockedClose).toHaveBeenCalledTimes(1);
  });
});
