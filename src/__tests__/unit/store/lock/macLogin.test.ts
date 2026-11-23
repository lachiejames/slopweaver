/**
 * The lock's Mac-login helpers: the connection fields a login is tried with, the hosts a URL reaches as the store
 * client reads them, and whether an address is this Mac's own.
 */
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { connectionHosts, hasBracketedHost, isOwnAddress, loginOptions } from "../../../../store/lock/macLogin.js";

describe("connectionHosts", () => {
  it("reads a single-host URL's host, IPv6 brackets removed", () => {
    expect(connectionHosts({ url: "postgresql://acme@[::1]:55322/acme" })).toEqual(["::1"]);
  });

  it("reads every host of a postgres.js host list, in the order the client tries them", () => {
    expect(connectionHosts({ url: "postgresql://acme@127.0.0.1:1,localhost:55322/acme" })).toEqual([
      "127.0.0.1",
      "localhost",
    ]);
  });

  it("reads a URL with no port the way the client does", () => {
    expect(connectionHosts({ url: "postgresql://acme@db.acme.example/acme" })).toEqual(["db.acme.example"]);
  });

  it("answers null only for a string the client cannot parse either", () => {
    expect(connectionHosts({ url: "not a url" })).toBe(null);
  });

  // MEASURED on the pinned postgres.js: a raw
  // `postgresql://postgres:postgres@127.0.0.1:55444/postgres?host=127.0.0.1&port=<stack port>` refused with
  // ECONNREFUSED 127.0.0.1:55444, never reaching the stack — the query string names no host the client uses.
  it("reads hosts as the store client does, which ignores a host or port in the query string", async () => {
    const url = "postgresql://acme@127.0.0.1:55444/acme?host=192.0.2.1&port=55322";
    const client = postgres(url, { max: 1 });
    expect({ host: client.options.host, port: client.options.port }).toEqual({ host: ["127.0.0.1"], port: [55444] });
    await client.end({ timeout: 0 });
    expect(connectionHosts({ url })).toEqual(["127.0.0.1"]);
  });
});

describe("hasBracketedHost", () => {
  it("is true only for a bracketed IPv6 host, the one shape the lock splits itself", () => {
    expect(hasBracketedHost({ url: "postgresql://acme@[::1]:55322/acme" })).toBe(true);
    expect(hasBracketedHost({ url: "postgresql://acme@127.0.0.1:55322/acme" })).toBe(false);
    expect(hasBracketedHost({ url: "postgresql://acme@127.0.0.1:1,127.0.0.1:2/acme" })).toBe(false);
    expect(hasBracketedHost({ url: "not a url" })).toBe(false);
  });

  // Why the probe hands every other URL to the client raw: the client decodes the user and password but NOT the
  // database, where splitting the URL here decodes all three — so a probe built from split fields could try another
  // database than the store connects to. Red here means the client changed; re-read tryLogin.
  it("the store client keeps a percent-encoded database name as written", async () => {
    const client = postgres("postgresql://acme@127.0.0.1:55444/%61cme", { max: 1 });
    expect(client.options.database).toBe("%61cme");
    await client.end({ timeout: 0 });
    expect(loginOptions({ url: "postgresql://acme@127.0.0.1:55444/%61cme" })!.database).toBe("acme");
  });
});

describe("isOwnAddress", () => {
  const own = ["192.0.2.10", "fe80::1"];

  it("counts every IPv4 loopback address as this Mac", () => {
    expect(isOwnAddress({ address: "127.0.0.1", own })).toBe(true);
    expect(isOwnAddress({ address: "127.8.9.10", own })).toBe(true);
  });

  it("counts the IPv6 loopback in both spellings and a mapped IPv4 loopback as this Mac", () => {
    expect(isOwnAddress({ address: "::1", own })).toBe(true);
    expect(isOwnAddress({ address: "0:0:0:0:0:0:0:1", own })).toBe(true);
    expect(isOwnAddress({ address: "::ffff:127.0.0.1", own })).toBe(true);
  });

  it("counts an address one of this Mac's interfaces holds", () => {
    expect(isOwnAddress({ address: "192.0.2.10", own })).toBe(true);
    expect(isOwnAddress({ address: "::ffff:192.0.2.10", own })).toBe(true);
  });

  it("does not count another host's address", () => {
    expect(isOwnAddress({ address: "198.51.100.7", own })).toBe(false);
    expect(isOwnAddress({ address: "2001:db8::7", own })).toBe(false);
  });
});

describe("loginOptions", () => {
  it("strips the brackets from an IPv6 loopback, which the client's own URL parser cannot read", () => {
    expect(loginOptions({ url: "postgresql://postgres:postgres@[::1]:55322/postgres" })).toEqual({
      database: "postgres",
      host: "::1",
      password: "postgres",
      port: 55322,
      username: "postgres",
    });
  });

  it("decodes an encoded database name", () => {
    expect(loginOptions({ url: "postgresql://u:p@127.0.0.1:1/my%20db" })).toEqual({
      database: "my db",
      host: "127.0.0.1",
      password: "p",
      port: 1,
      username: "u",
    });
  });

  it("is null for a string that is not a URL, or one with no port or database", () => {
    expect(loginOptions({ url: "not a url" })).toBe(null);
    expect(loginOptions({ url: "postgresql://u:p@127.0.0.1/x" })).toBe(null);
    expect(loginOptions({ url: "postgresql://u:p@127.0.0.1:1/" })).toBe(null);
  });
});
