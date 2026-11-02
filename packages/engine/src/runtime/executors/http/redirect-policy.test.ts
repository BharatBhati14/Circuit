import { describe, expect, it } from "vitest";

import {
  MAX_HTTP_REDIRECTS,
  HttpRedirectError,
  assertNoRedirectLoop,
  assertRedirectLimit,
  filterRedirectHeaders,
  getRedirectMethod,
  getRedirectUrl,
  isCrossOrigin,
  isRedirectStatus,
  shouldPreserveRequestBody,
} from "./redirect-policy.js";

function expectRedirectError(
  callback: () => unknown,
  expectedCode: string,
): void {
  try {
    callback();
    throw new Error("Expected callback to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpRedirectError);
    expect(error).toMatchObject({
      code: expectedCode,
    });
  }
}

describe("isRedirectStatus", () => {
  it.each([301, 302, 303, 307, 308])(
    "recognizes %i as a redirect status",
    (statusCode) => {
      expect(isRedirectStatus(statusCode)).toBe(true);
    },
  );

  it.each([200, 201, 204, 400, 404, 500])(
    "does not recognize %i as a redirect status",
    (statusCode) => {
      expect(isRedirectStatus(statusCode)).toBe(false);
    },
  );
});

describe("getRedirectUrl", () => {
  const currentUrl = "https://example.com/api/users";

  it("resolves an absolute redirect URL", () => {
    const result = getRedirectUrl(currentUrl, "https://example.com/login");

    expect(result.href).toBe("https://example.com/login");
  });

  it("resolves a relative redirect URL", () => {
    const result = getRedirectUrl(currentUrl, "/login");

    expect(result.href).toBe("https://example.com/login");
  });

  it("resolves a parent-relative redirect URL", () => {
    const result = getRedirectUrl(currentUrl, "../login");

    expect(result.href).toBe("https://example.com/login");
  });

  it("supports HTTP to HTTPS redirects", () => {
    const result = getRedirectUrl(
      "http://example.com",
      "https://example.com/secure",
    );

    expect(result.protocol).toBe("https:");
  });

  it("rejects missing Location headers", () => {
    expectRedirectError(
      () => getRedirectUrl(currentUrl, undefined),
      "HTTP_REDIRECT_MISSING_LOCATION",
    );
  });

  it("rejects empty Location headers", () => {
    expectRedirectError(
      () => getRedirectUrl(currentUrl, " "),
      "HTTP_REDIRECT_MISSING_LOCATION",
    );
  });

  it("rejects invalid Location URLs", () => {
    expectRedirectError(
      () => getRedirectUrl(currentUrl, "http://[invalid"),
      "HTTP_REDIRECT_INVALID_LOCATION",
    );
  });

  it("rejects non-HTTP protocols", () => {
    expectRedirectError(
      () => getRedirectUrl(currentUrl, "javascript:alert(1)"),
      "HTTP_REDIRECT_UNSUPPORTED_PROTOCOL",
    );
  });

  it("rejects file protocol redirects", () => {
    expectRedirectError(
      () => getRedirectUrl(currentUrl, "file:///etc/passwd"),
      "HTTP_REDIRECT_UNSUPPORTED_PROTOCOL",
    );
  });

  it("rejects embedded credentials", () => {
    expectRedirectError(
      () => getRedirectUrl(currentUrl, "https://username:password@example.com"),
      "HTTP_REDIRECT_CREDENTIALS_BLOCKED",
    );
  });

  it("rejects array-valued Location headers", () => {
    expectRedirectError(
      () => getRedirectUrl(currentUrl, ["/first", "/second"]),
      "HTTP_REDIRECT_MISSING_LOCATION",
    );
  });

  it("blocks HTTPS to HTTP redirects", () => {
    expectRedirectError(
      () =>
        getRedirectUrl(
          "https://example.com/api",
          "http://example.com/redirected",
        ),
      "HTTP_REDIRECT_DOWNGRADE_BLOCKED",
    );
  });

  it("allows HTTP to HTTPS redirects", () => {
    const result = getRedirectUrl(
      "http://example.com/api",
      "https://example.com/secure",
    );

    expect(result.href).toBe("https://example.com/secure");
  });

  it("removes URL fragments from redirect destinations", () => {
    const result = getRedirectUrl(
      "https://example.com/api",
      "/redirected#section",
    );

    expect(result.hash).toBe("");
    expect(result.href).toBe("https://example.com/redirected");
  });
});

describe("getRedirectMethod", () => {
  it("converts POST to GET for 301", () => {
    expect(getRedirectMethod(301, "POST")).toBe("GET");
  });

  it("converts POST to GET for 302", () => {
    expect(getRedirectMethod(302, "POST")).toBe("GET");
  });

  it("converts PUT to GET for 303", () => {
    expect(getRedirectMethod(303, "PUT")).toBe("GET");
  });

  it("converts PATCH to GET for 303", () => {
    expect(getRedirectMethod(303, "PATCH")).toBe("GET");
  });

  it("preserves HEAD for 303", () => {
    expect(getRedirectMethod(303, "HEAD")).toBe("HEAD");
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "HEAD"] as const)(
    "preserves %s for 301",
    (method) => {
      expect(getRedirectMethod(301, method)).toBe(method);
    },
  );

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const)(
    "preserves %s for 307",
    (method) => {
      expect(getRedirectMethod(307, method)).toBe(method);
    },
  );

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const)(
    "preserves %s for 308",
    (method) => {
      expect(getRedirectMethod(308, method)).toBe(method);
    },
  );
});

describe("shouldPreserveRequestBody", () => {
  it("does not preserve the body when POST changes to GET for 301", () => {
    expect(shouldPreserveRequestBody(301, "POST")).toBe(false);
  });

  it("does not preserve the body when POST changes to GET for 302", () => {
    expect(shouldPreserveRequestBody(302, "POST")).toBe(false);
  });

  it("does not preserve the body for 303", () => {
    expect(shouldPreserveRequestBody(303, "POST")).toBe(false);
  });

  it("preserves the body for 307", () => {
    expect(shouldPreserveRequestBody(307, "POST")).toBe(true);
  });

  it("preserves the body for 308", () => {
    expect(shouldPreserveRequestBody(308, "POST")).toBe(true);
  });
});

describe("filterRedirectHeaders", () => {
  const headers = {
    Authorization: "Bearer secret",
    Cookie: "session=abc",
    "Proxy-Authorization": "Basic secret",
    "Content-Type": "application/json",
    "X-Custom-Header": "Circuit",
  };

  it("preserves all headers for same-origin redirects", () => {
    const result = filterRedirectHeaders(headers, false);

    expect(result).toEqual(headers);
  });

  it("removes sensitive headers for cross-origin redirects", () => {
    const result = filterRedirectHeaders(headers, true);

    expect(result).toEqual({
      "Content-Type": "application/json",
      "X-Custom-Header": "Circuit",
    });
  });

  it("filters sensitive headers case-insensitively", () => {
    const result = filterRedirectHeaders(
      {
        authorization: "secret",
        COOKIE: "session=abc",
        "pRoXy-AuThOrIzAtIoN": "secret",
        Accept: "application/json",
      },
      true,
    );

    expect(result).toEqual({
      Accept: "application/json",
    });
  });

  it("does not mutate the original headers object", () => {
    const original = { ...headers };

    filterRedirectHeaders(headers, true);

    expect(headers).toEqual(original);
  });
});

describe("assertRedirectLimit", () => {
  it("allows redirect attempts below the limit", () => {
    expect(() => assertRedirectLimit(0)).not.toThrow();
    expect(() => assertRedirectLimit(MAX_HTTP_REDIRECTS - 1)).not.toThrow();
  });

  it("rejects redirect attempts above the limit", () => {
    expectRedirectError(
      () => assertRedirectLimit(MAX_HTTP_REDIRECTS + 1),
      "HTTP_TOO_MANY_REDIRECTS",
    );
  });

  it("rejects redirect attempts above the limit", () => {
    expectRedirectError(
      () => assertRedirectLimit(MAX_HTTP_REDIRECTS + 1),
      "HTTP_TOO_MANY_REDIRECTS",
    );
  });
});

describe("assertNoRedirectLoop", () => {
  it("allows a URL that has not been visited", () => {
    const visitedUrls = new Set<string>();
    const nextUrl = new URL("https://example.com/page");

    expect(() => assertNoRedirectLoop(visitedUrls, nextUrl)).not.toThrow();

    expect(visitedUrls.has(nextUrl.href)).toBe(true);
  });

  it("rejects a URL that has already been visited", () => {
    const nextUrl = new URL("https://example.com/page");
    const visitedUrls = new Set([nextUrl.href]);

    expectRedirectError(
      () => assertNoRedirectLoop(visitedUrls, nextUrl),
      "HTTP_REDIRECT_LOOP",
    );
  });

  it("allows different URLs on the same origin", () => {
    const visitedUrls = new Set(["https://example.com/page-one"]);

    expect(() =>
      assertNoRedirectLoop(
        visitedUrls,
        new URL("https://example.com/page-two"),
      ),
    ).not.toThrow();
  });

  it("detects redirect loops even when URL fragments differ", () => {
    const visitedUrls = new Set(["https://example.com/page"]);

    expectRedirectError(
      () =>
        assertNoRedirectLoop(
          visitedUrls,
          new URL("https://example.com/page#different"),
        ),
      "HTTP_REDIRECT_LOOP",
    );
  });
});

describe("isCrossOrigin", () => {
  it("returns false for URLs with the same origin", () => {
    expect(
      isCrossOrigin(
        new URL("https://example.com/page-one"),
        new URL("https://example.com/page-two"),
      ),
    ).toBe(false);
  });

  it("returns true for different hostnames", () => {
    expect(
      isCrossOrigin(
        new URL("https://example.com"),
        new URL("https://other.com"),
      ),
    ).toBe(true);
  });

  it("returns true for different protocols", () => {
    expect(
      isCrossOrigin(
        new URL("http://example.com"),
        new URL("https://example.com"),
      ),
    ).toBe(true);
  });

  it("returns true for different ports", () => {
    expect(
      isCrossOrigin(
        new URL("https://example.com:443"),
        new URL("https://example.com:8443"),
      ),
    ).toBe(true);
  });
});
