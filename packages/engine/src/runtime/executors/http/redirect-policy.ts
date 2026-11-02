export const MAX_HTTP_REDIRECTS = 5;

export const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export class HttpRedirectError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "HttpRedirectError";

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isRedirectStatus(statusCode: number): boolean {
  return REDIRECT_STATUS_CODES.has(statusCode);
}

export function getRedirectUrl(
  currentUrl: string,
  location: string | string[] | undefined,
): URL {
  if (typeof location !== "string" || location.trim().length === 0) {
    throw new HttpRedirectError(
      "Redirect response is missing a valid Location header.",
      "HTTP_REDIRECT_MISSING_LOCATION",
    );
  }

  let redirectUrl: URL;

  try {
    redirectUrl = new URL(location, currentUrl);
  } catch {
    throw new HttpRedirectError(
      "Redirect response contains an invalid Location URL.",
      "HTTP_REDIRECT_INVALID_LOCATION",
    );
  }

  redirectUrl.hash = "";

  if (!["http:", "https:"].includes(redirectUrl.protocol)) {
    throw new HttpRedirectError(
      "Redirects to non-HTTP protocols are not allowed.",
      "HTTP_REDIRECT_UNSUPPORTED_PROTOCOL",
    );
  }

  const current = new URL(currentUrl);

  if (current.protocol === "https:" && redirectUrl.protocol === "http:") {
    throw new HttpRedirectError(
      "HTTPS to HTTP redirects are not allowed.",
      "HTTP_REDIRECT_DOWNGRADE_BLOCKED",
    );
  }

  if (redirectUrl.username || redirectUrl.password) {
    throw new HttpRedirectError(
      "Redirect URLs must not contain embedded credentials.",
      "HTTP_REDIRECT_CREDENTIALS_BLOCKED",
    );
  }

  return redirectUrl;
}

export function getRedirectMethod(
  statusCode: number,
  currentMethod: HttpMethod,
): HttpMethod {
  if (statusCode === 303) {
    return currentMethod === "HEAD" ? "HEAD" : "GET";
  }

  if ((statusCode === 301 || statusCode === 302) && currentMethod === "POST") {
    return "GET";
  }

  return currentMethod;
}

export function shouldPreserveRequestBody(
  statusCode: number,
  currentMethod: HttpMethod,
): boolean {
  const nextMethod = getRedirectMethod(statusCode, currentMethod);

  return nextMethod === currentMethod;
}

export function filterRedirectHeaders(
  headers: Record<string, string>,
  isCrossOrigin: boolean,
): Record<string, string> {
  if (!isCrossOrigin) {
    return { ...headers };
  }

  const sensitiveHeaders = new Set([
    "authorization",
    "cookie",
    "proxy-authorization",
    // "www-authenticate",
    // "proxy-authenticate",
  ]);

  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !sensitiveHeaders.has(name.toLowerCase()),
    ),
  );
}

export function assertRedirectLimit(redirectCount: number): void {
  if (redirectCount >= MAX_HTTP_REDIRECTS) {
    throw new HttpRedirectError(
      `The HTTP request exceeded the maximum of ${MAX_HTTP_REDIRECTS} redirects.`,
      "HTTP_TOO_MANY_REDIRECTS",
    );
  }
}

export function assertNoRedirectLoop(
  visitedUrls: Set<string>,
  nextUrl: URL,
): void {
  const normalizedUrl = new URL(nextUrl.href);
  normalizedUrl.hash = "";

  const normalizedHref = normalizedUrl.href;

  if (visitedUrls.has(normalizedHref)) {
    throw new HttpRedirectError(
      "The HTTP request encountered a redirect loop.",
      "HTTP_REDIRECT_LOOP",
    );
  }

  visitedUrls.add(normalizedHref);
}

export function isCrossOrigin(currentUrl: URL, nextUrl: URL): boolean {
  return currentUrl.origin !== nextUrl.origin;
}
