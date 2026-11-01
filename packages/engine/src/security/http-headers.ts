const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export class InvalidHttpHeadersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHttpHeadersError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function validateHttpHeaders(headers?: Record<string, string>): void {
  if (headers === undefined) {
    return;
  }

  if (
    typeof headers !== "object" ||
    headers === null ||
    Array.isArray(headers)
  ) {
    throw new InvalidHttpHeadersError("HTTP headers must be an object.");
  }

  for (const [name, value] of Object.entries(headers)) {
    // Header names must follow HTTP token syntax.
    if (!name || !HEADER_NAME_PATTERN.test(name)) {
      throw new InvalidHttpHeadersError(`Invalid HTTP header name: "${name}".`);
    }

    // The Host header must be controlled by the HTTP client.
    if (name.toLowerCase() === "host") {
      throw new InvalidHttpHeadersError(
        "The Host header cannot be overridden.",
      );
    }

    // Runtime validation: TypeScript types do not validate JSON input.
    if (typeof value !== "string") {
      throw new InvalidHttpHeadersError(
        `HTTP header "${name}" must have a string value.`,
      );
    }

    // Prevent CRLF header injection.
    if (/[\r\n]/.test(value)) {
      throw new InvalidHttpHeadersError(
        `HTTP header "${name}" contains invalid newline characters.`,
      );
    }
  }
}
