import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildConnectorMock } = vi.hoisted(() => ({
  buildConnectorMock: vi.fn(),
}));

vi.mock("undici", () => ({
  buildConnector: buildConnectorMock,
}));

import { createPinnedConnector } from "./pinned-connector.js";

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

type LookupOptions = {
  family?: number;
  all?: boolean;
};

type CapturedLookup = (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void;

describe("createPinnedConnector", () => {
  let capturedLookup: CapturedLookup;

  beforeEach(() => {
    buildConnectorMock.mockReset();

    buildConnectorMock.mockImplementation((options) => {
      capturedLookup = options.lookup;
      return vi.fn();
    });
  });

  it("pins an IPv4 address", () => {
    createPinnedConnector("example.com", "8.8.8.8", 4);

    const callback = vi.fn();

    capturedLookup("example.com", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });

  it("pins an IPv6 address", () => {
    createPinnedConnector("example.com", "2001:4860:4860::8888", 6);

    const callback = vi.fn();

    capturedLookup("example.com", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, "2001:4860:4860::8888", 6);
  });

  it("supports all: true lookup requests", () => {
    createPinnedConnector("example.com", "8.8.8.8", 4);

    const callback = vi.fn();

    capturedLookup("example.com", { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [
      {
        address: "8.8.8.8",
        family: 4,
      },
    ]);
  });

  it("rejects an unexpected hostname", () => {
    createPinnedConnector("example.com", "8.8.8.8", 4);

    const callback = vi.fn();

    capturedLookup("attacker.com", {}, callback);

    expect(callback).toHaveBeenCalled();

    const error = callback.mock.calls[0][0];

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Unexpected hostname");
  });

  it("does not fall back to normal DNS resolution", () => {
    createPinnedConnector("example.com", "8.8.8.8", 4);

    const callback = vi.fn();

    capturedLookup("example.com", {}, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });

  it("rejects an incompatible address family", () => {
    createPinnedConnector("example.com", "8.8.8.8", 4);

    const callback = vi.fn();

    capturedLookup("example.com", { family: 6 }, callback);

    const error = callback.mock.calls[0][0];

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("address family");
  });

  it("rejects non-public IP addresses", () => {
    expect(() => createPinnedConnector("example.com", "127.0.0.1", 4)).toThrow(
      "non-public IP",
    );
  });

  it("rejects a mismatched IP family", () => {
    expect(() => createPinnedConnector("example.com", "8.8.8.8", 6)).toThrow(
      "family does not match",
    );
  });

  it("normalizes hostname casing and trailing dots", () => {
    createPinnedConnector("Example.COM.", "8.8.8.8", 4);

    const callback = vi.fn();

    capturedLookup("example.com", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });

  it("disables HTTP/2", () => {
    createPinnedConnector("example.com", "8.8.8.8", 4);

    expect(buildConnectorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowH2: false,
      }),
    );
  });
});
