/**
 * Unit: the read-only rail on the Make SDK. Real SDK write and run methods are called on a {@link ReadOnlyMake}
 * and each is refused before a request is built — the refusal is the witness that nothing reached the network,
 * because a request that got past the rail would fail with a network or auth error instead.
 */
import { describe, expect, it } from "vitest";

import { ReadOnlyMake, railedOptions } from "../../../../atlas/make/client.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A client on a real zone with a token that is not a credential. Every call here must be refused locally. */
function railed(): ReadOnlyMake {
  return new ReadOnlyMake("not-a-token", "eu2.make.com", {
    retry: { maxRetries: 0, onRateLimit: false, onServerError: false },
  });
}

describe("ReadOnlyMake", () => {
  it("refuses running a scenario", async () => {
    await expect(railed().scenarios.run(1000)).rejects.toThrow(
      "the Make atlas is read-only: refused POST /scenarios/1000/run before sending — only GET leaves this door",
    );
  });

  it("refuses creating a scenario", async () => {
    await expect(
      railed().scenarios.create({ blueprint: "{}", scheduling: '{"type":"on-demand"}', teamId: 10 }),
    ).rejects.toThrow("refused POST /scenarios");
  });

  it("refuses deleting a connection", async () => {
    await expect(railed().connections.delete(500)).rejects.toThrow("refused DELETE /connections/500");
  });

  it("refuses a URL off the configured zone even for a GET", async () => {
    await expect(railed().fetch("https://elsewhere.example/api/v2/users/me")).rejects.toThrow(
      "only a path on the configured zone is read",
    );
    await expect(railed().fetch("//elsewhere.example/api/v2/users/me")).rejects.toThrow(
      "only a path on the configured zone is read",
    );
  });

  it("refuses a URL that is not a string, so a URL-like object cannot answer the rail one way and send another", async () => {
    const lying: Pick<string, "charAt" | "startsWith" | "toString"> = {
      charAt: () => "h",
      startsWith: (prefix) => prefix === "/",
      toString: () => "https://elsewhere.example/api/v2/users/me",
    };
    await expect(railed().fetch(lying)).rejects.toThrow(
      "refused the request to a URL that is not a string before sending — only a string path on the configured zone is read",
    );
  });

  it("refuses to be built for a host off the published zones", () => {
    expect(() => new ReadOnlyMake("not-a-token", "make.example.org")).toThrow(
      "zone make.example.org is not a published Make zone",
    );
  });

  it("pins its zone, protocol and API version so nothing can redirect it after construction", () => {
    const client = railed();
    expect(() => Object.assign(client, { zone: "make.example.org" })).toThrow(TypeError);
    expect(() => Object.assign(client, { protocol: "http" })).toThrow(TypeError);
    expect(() => Object.defineProperty(client, "zone", { get: () => "make.example.org" })).toThrow(TypeError);
    expect([client.zone, client.protocol, client.version]).toStrictEqual(["eu2.make.com", "https", 2]);
  });
});

describe("railedOptions", () => {
  it("reads the method once and sends GET, so a getter cannot answer GET to the rail and POST to the SDK", () => {
    let reads = 0;
    const options = {
      get method(): string {
        reads += 1;
        return reads === 1 ? "GET" : "POST";
      },
    };
    const sent = unwrap(railedOptions({ options, protocol: "https", url: "/users/me", zone: "eu2.make.com" }));
    expect([sent.method, sent.method, reads]).toStrictEqual(["GET", "GET", 1]);
  });

  it("refuses an http protocol and an off-zone host", () => {
    const base = { options: undefined, url: "/users/me" };
    expect(unwrapErr(railedOptions({ ...base, protocol: "http", zone: "eu2.make.com" })).message).toContain(
      "protocol http is not https",
    );
    expect(unwrapErr(railedOptions({ ...base, protocol: "https", zone: "make.example.org" })).message).toContain(
      "zone make.example.org is not a published Make zone",
    );
  });
});
