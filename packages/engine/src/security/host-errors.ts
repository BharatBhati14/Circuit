export class InvalidHostnameError extends Error {
  constructor(message = "Invalid hostname") {
    super(message);
    this.name = "InvalidHostnameError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnsafeHostError extends Error {
  constructor(message = "Host resolves to a non-public IP address") {
    super(message);
    this.name = "UnsafeHostError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class HostResolutionError extends Error {
  readonly dnsCode: string | undefined;

  constructor(message = "Failed to resolve hostname", cause?: unknown) {
    super(message, { cause });
    this.name = "HostResolutionError";
    Object.setPrototypeOf(this, new.target.prototype);

    this.dnsCode =
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      typeof cause.code === "string"
        ? cause.code
        : undefined;
  }
}
