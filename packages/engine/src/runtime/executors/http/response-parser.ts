export type ParsedResponseBody =
  | {
      type: "json";
      value: unknown;
    }
  | {
      type: "text";
      value: string;
    }
  | {
      type: "empty";
      value: null;
    }
  | {
      type: "binary";
      value: string;
    };

export class InvalidJsonResponseError extends Error {
  constructor(message = "The server returned malformed JSON.") {
    super(message);
    this.name = "InvalidJsonResponseError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";")[0].trim().toLowerCase();

  return (
    mediaType === "application/json" ||
    (mediaType.startsWith("application/") && mediaType.endsWith("+json"))
  );
}

function isTextContentType(contentType: string): boolean {
  const mediaType = contentType.split(";")[0].trim().toLowerCase();

  return mediaType.startsWith("text/");
}

export function parseResponseBody(
  body: Buffer,
  contentType: string | string[] | undefined,
): ParsedResponseBody {
  if (body.length === 0) {
    return {
      type: "empty",
      value: null,
    };
  }

  const normalizedContentType = Array.isArray(contentType)
    ? (contentType[0] ?? "")
    : (contentType ?? "");

  if (isJsonContentType(normalizedContentType)) {
    try {
      const parsed: unknown = JSON.parse(body.toString("utf8"));

      return {
        type: "json",
        value: parsed,
      };
    } catch {
      throw new InvalidJsonResponseError();
    }
  }

  if (isTextContentType(normalizedContentType)) {
    return {
      type: "text",
      value: body.toString("utf8"),
    };
  }

  return {
    type: "binary",
    value: body.toString("base64"),
  };
}
