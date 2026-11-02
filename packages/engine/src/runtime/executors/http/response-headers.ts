type IncomingHttpHeaders = Record<string, string | string[] | undefined>;

export type NormalizedResponseHeaders = Record<string, string | string[]>;

export class InvalidResponseHeadersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResponseHeadersError";

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function normalizeResponseHeaders(
  headers: IncomingHttpHeaders,
): NormalizedResponseHeaders {
  const normalizedHeaders = Object.create(null) as NormalizedResponseHeaders;

  const seenHeaders = new Set<string>();

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    const normalizedName = name.toLowerCase();

    if (seenHeaders.has(normalizedName)) {
      throw new InvalidResponseHeadersError(
        `Duplicate response header detected: ${normalizedName}`,
      );
    }

    seenHeaders.add(normalizedName);

    if (typeof value !== "string" && !Array.isArray(value)) {
      throw new InvalidResponseHeadersError(
        `Invalid value for response header: ${normalizedName}`,
      );
    }

    normalizedHeaders[normalizedName] = value;
  }

  return normalizedHeaders;
}
