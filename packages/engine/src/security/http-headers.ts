const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export const MAX_HTTP_HEADER_COUNT = 50;
export const MAX_HTTP_HEADER_NAME_BYTES = 256;
export const MAX_HTTP_HEADER_VALUE_BYTES = 8 * 1024;
export const MAX_HTTP_HEADERS_TOTAL_BYTES = 32 * 1024;

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

  const entries = Object.entries(headers);

  // Validate header count.
  if (entries.length > MAX_HTTP_HEADER_COUNT) {
    throw new InvalidHttpHeadersError(
      `HTTP headers cannot contain more than ${MAX_HTTP_HEADER_COUNT} entries.`,
    );
  }

  let totalSize = 2; // Final CRLF terminating the header block.

  for (const [name, value] of entries) {
    // Validate header name.
    if (!name || !HEADER_NAME_PATTERN.test(name)) {
      throw new InvalidHttpHeadersError(`Invalid HTTP header name: "${name}".`);
    }

    if (name.toLowerCase() === "host") {
      throw new InvalidHttpHeadersError(
        "The Host header cannot be overridden.",
      );
    }

    const nameBytes = Buffer.byteLength(name, "utf8");

    if (nameBytes > MAX_HTTP_HEADER_NAME_BYTES) {
      throw new InvalidHttpHeadersError(
        `HTTP header name cannot exceed ${MAX_HTTP_HEADER_NAME_BYTES} bytes.`,
      );
    }

    // Validate header value.
    if (typeof value !== "string") {
      throw new InvalidHttpHeadersError(
        `HTTP header "${name}" must have a string value.`,
      );
    }

    if (/[\r\n]/.test(value)) {
      throw new InvalidHttpHeadersError(
        `HTTP header "${name}" contains invalid newline characters.`,
      );
    }

    const valueBytes = Buffer.byteLength(value, "utf8");

    if (valueBytes > MAX_HTTP_HEADER_VALUE_BYTES) {
      throw new InvalidHttpHeadersError(
        `HTTP header "${name}" value cannot exceed ${MAX_HTTP_HEADER_VALUE_BYTES} bytes.`,
      );
    }

    // Account for: name + ": " + value + "\r\n"
    totalSize += nameBytes + valueBytes + 4;

    if (totalSize > MAX_HTTP_HEADERS_TOTAL_BYTES) {
      throw new InvalidHttpHeadersError(
        `Total HTTP header size cannot exceed ${MAX_HTTP_HEADERS_TOTAL_BYTES} bytes.`,
      );
    }
  }
}
