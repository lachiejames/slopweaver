/**
 * The jar read's two pure halves: where Chrome keeps its profiles on each platform, and what a row becomes.
 *
 * What is deliberately NOT here is the keyring, the file copy and `node:sqlite` — those are the part of this
 * lane that genuinely needs the owner's own machine, and `readOriginCookies` is the one function that composes them.
 * Everything a reader would get wrong is on this side of that line: which rows are dropped and which refuse
 * the whole read, and that `expires_utc` is a BigInt whose value no `number` can hold.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { deriveCookieKey } from "../../../browser/cookieCrypto.js";
import { chromeUserDataRoot, cookieKey, cookiesFromRows, KEYRING_READ_TIMEOUT_MS } from "../../../browser/cookieJar.js";

import { chromeEncrypt, jarRow } from "../../chromeCookieFixture.js";

const PASSWORD = "a-fake-safe-storage-password";
const key = deriveCookieKey({ password: PASSWORD, platform: "darwin" });

describe("chromeUserDataRoot", () => {
  it("finds Chrome's macOS user-data directory under Application Support", () => {
    expect(chromeUserDataRoot({ platform: "darwin" })).toContain("Library/Application Support/Google/Chrome");
  });

  it("finds Chrome's Linux user-data directory under the XDG config root", () => {
    expect(chromeUserDataRoot({ platform: "linux" })).toContain(".config/google-chrome");
  });

  it("gives the two platforms DIFFERENT directories, so neither is a copy of the other", () => {
    expect(chromeUserDataRoot({ platform: "darwin" })).not.toBe(chromeUserDataRoot({ platform: "linux" }));
  });

  // Windows is not an oversight — the jar's encryption is DPAPI there, and this lane cannot read it.
  it("answers with nothing on a platform this lane cannot read a jar on", () => {
    expect(chromeUserDataRoot({ platform: "win32" })).toBe(undefined);
  });

  it("answers with nothing for a platform name it has never heard of", () => {
    expect(chromeUserDataRoot({ platform: "aix" })).toBe(undefined);
  });
});

/**
 * What `execFileSync` throws when its `timeout` kills the child — measured on Node 24.21 against a `sleep` past
 * its bound under the call's `killSignal: "SIGKILL"`: `code` is `ETIMEDOUT`, `signal` `SIGKILL`, `status` null.
 */
function hungChild(): never {
  throw Object.assign(new Error("spawnSync security ETIMEDOUT"), {
    code: "ETIMEDOUT",
    signal: "SIGKILL",
    status: null,
  });
}

describe("cookieKey bounds the keyring read, so an unanswered dialog ends instead of stalling the seat", () => {
  it("answers a keyring read killed at its bound with the named timeout, not the generic refusal", () => {
    expect(unwrapErr(cookieKey({ platform: "darwin", readKeyring: hungChild })).code).toBe("KEY_READ_TIMED_OUT");
  });

  it("names the bound it waited for, so the message's seconds match the code's constant", () => {
    const error = unwrapErr(cookieKey({ platform: "darwin", readKeyring: hungChild }));
    expect(error).toEqual(expect.objectContaining({ timeoutMs: KEYRING_READ_TIMEOUT_MS }));
  });

  it("bounds the read at two minutes, long enough for a person at the screen to answer the dialog", () => {
    expect(KEYRING_READ_TIMEOUT_MS).toBe(120_000);
  });

  it("still answers any other keyring failure as the keyring refusing, with its detail", () => {
    const refused = (): never => {
      throw new Error("security: SecKeychainSearchCopyNext: The specified item could not be found");
    };
    const error = unwrapErr(cookieKey({ platform: "darwin", readKeyring: refused }));
    expect(error.code).toBe("KEY_UNAVAILABLE");
    expect(error.message).toContain("could not be found");
  });

  it("derives the key from a keyring that answers", () => {
    const derived = unwrap(cookieKey({ platform: "darwin", readKeyring: () => `${PASSWORD}\n` }));
    expect(derived.equals(deriveCookieKey({ password: PASSWORD, platform: "darwin" }))).toBe(true);
  });
});

describe("cookiesFromRows keeps the rows a browser would send to the host", () => {
  it("reads back a value Chrome's own scheme encrypted", () => {
    const rows = [jarRow({ hostKey: ".github.com", key, name: "logged_in", value: "yes" })];
    expect(unwrap(cookiesFromRows({ host: "github.com", key, rows }))[0]!.value).toBe("yes");
  });

  it("carries the row's own name, path and host through unchanged", () => {
    const rows = [jarRow({ hostKey: ".github.com", key, name: "user_session", path: "/gist", value: "abc" })];
    const cookie = unwrap(cookiesFromRows({ host: "gist.github.com", key, rows }))[0]!;
    expect({ domain: cookie.domain, name: cookie.name, path: cookie.path }).toEqual({
      domain: ".github.com",
      name: "user_session",
      path: "/gist",
    });
  });

  it("keeps a dot-prefixed domain row for a subdomain, which is the whole point of the leading dot", () => {
    const rows = [jarRow({ hostKey: ".github.com", key, name: "logged_in", value: "yes" })];
    expect(unwrap(cookiesFromRows({ host: "gist.github.com", key, rows }))).toHaveLength(1);
  });

  it("drops a host-only row when the ask is for a subdomain", () => {
    const rows = [jarRow({ hostKey: "github.com", key, name: "logged_in", value: "yes" })];
    expect(unwrap(cookiesFromRows({ host: "gist.github.com", key, rows }))).toEqual([]);
  });

  it("drops a row filed under an unrelated host", () => {
    const rows = [jarRow({ hostKey: ".linear.app", key, name: "session", value: "nope" })];
    expect(unwrap(cookiesFromRows({ host: "github.com", key, rows }))).toEqual([]);
  });

  // A real jar holds thousands of rows for hundreds of sites. Selecting is the function's actual job.
  it("selects only the applicable rows out of a jar holding several hosts", () => {
    const rows = [
      jarRow({ hostKey: ".linear.app", key, name: "a", value: "1" }),
      jarRow({ hostKey: ".github.com", key, name: "b", value: "2" }),
      jarRow({ hostKey: "www.google.com", key, name: "c", value: "3" }),
      jarRow({ hostKey: "github.com", key, name: "d", value: "4" }),
    ];
    expect(unwrap(cookiesFromRows({ host: "github.com", key, rows })).map((cookie) => cookie.name)).toEqual(["b", "d"]);
  });

  it("answers with nothing when the jar holds no row for the host at all", () => {
    const rows = [jarRow({ hostKey: ".linear.app", key, name: "a", value: "1" })];
    expect(unwrap(cookiesFromRows({ host: "github.com", key, rows }))).toEqual([]);
  });

  it("answers with nothing for an empty jar", () => {
    expect(unwrap(cookiesFromRows({ host: "github.com", key, rows: [] }))).toEqual([]);
  });

  // Chrome wrote rows before it encrypted them. Such a row is not this read's business and is not a failure.
  it("drops a row whose encrypted_value is not bytes, rather than failing the whole read", () => {
    const rows = [
      { ...jarRow({ hostKey: ".github.com", key, name: "old", value: "x" }), encrypted_value: "plaintext" },
      jarRow({ hostKey: ".github.com", key, name: "new", value: "y" }),
    ];
    expect(unwrap(cookiesFromRows({ host: "github.com", key, rows })).map((cookie) => cookie.name)).toEqual(["new"]);
  });
});

describe("cookiesFromRows refuses rather than half-answering when a value will not decrypt", () => {
  it("fails the whole read on a row for this host that will not decrypt", () => {
    const other = deriveCookieKey({ password: "a-different-chrome-install", platform: "darwin" });
    const rows = [jarRow({ hostKey: ".github.com", key: other, name: "logged_in", value: "yes" })];
    expect(unwrapErr(cookiesFromRows({ host: "github.com", key, rows })).code).toBe("KEY_WRONG");
  });

  // The falsifiable half: a partial answer would have returned the first row and hidden the second.
  it("returns nothing at all, not the rows that happened to come first", () => {
    const other = deriveCookieKey({ password: "a-different-chrome-install", platform: "darwin" });
    const rows = [
      jarRow({ hostKey: ".github.com", key, name: "first", value: "readable" }),
      jarRow({ hostKey: ".github.com", key: other, name: "second", value: "not" }),
    ];
    expect(unwrapErr(cookiesFromRows({ host: "github.com", key, rows })).code).toBe("KEY_WRONG");
  });

  it("does not fail on an undecryptable row filed under ANOTHER host, which was never this read's business", () => {
    const other = deriveCookieKey({ password: "a-different-chrome-install", platform: "darwin" });
    const rows = [
      jarRow({ hostKey: ".linear.app", key: other, name: "theirs", value: "not" }),
      jarRow({ hostKey: ".github.com", key, name: "ours", value: "yes" }),
    ];
    expect(unwrap(cookiesFromRows({ host: "github.com", key, rows })).map((cookie) => cookie.name)).toEqual(["ours"]);
  });

  it("names the unknown version prefix rather than decrypting whatever follows it", () => {
    const rows = [
      {
        ...jarRow({ hostKey: ".github.com", key, name: "logged_in", value: "yes" }),
        encrypted_value: new Uint8Array(Buffer.concat([Buffer.from("v20", "latin1"), Buffer.alloc(32)])),
      },
    ];
    expect(unwrapErr(cookiesFromRows({ host: "github.com", key, rows })).message).toContain("v20");
  });

  // The one thing that must never happen: a refusal that quotes what it could not read.
  it("never carries a cookie VALUE into the error it returns", () => {
    const other = deriveCookieKey({ password: "a-different-chrome-install", platform: "darwin" });
    const rows = [jarRow({ hostKey: ".github.com", key: other, name: "logged_in", value: "a-secret-value" })];
    expect(unwrapErr(cookiesFromRows({ host: "github.com", key, rows })).message).not.toContain("a-secret-value");
  });
});

describe("cookiesFromRows reads the columns SQLite hands back as BigInt", () => {
  // MEASURED, and it is why the jar read sets `setReadBigInts(true)`: microseconds since 1601 is past
  // Number.MAX_SAFE_INTEGER for every live cookie, and node:sqlite refuses such a value outright.
  it("converts a real expiry, which is a bigint no number can hold", () => {
    const rows = [
      jarRow({ expiresUtc: 13459480961651281n, hostKey: ".github.com", key, name: "logged_in", value: "yes" }),
    ];
    expect(unwrap(cookiesFromRows({ host: "github.com", key, rows }))[0]!.expires).toBe(1_815_007_361);
  });

  it("reports a session cookie as -1, which is what Chrome's own 0 means", () => {
    const rows = [jarRow({ expiresUtc: 0n, hostKey: ".github.com", key, name: "logged_in", value: "yes" })];
    expect(unwrap(cookiesFromRows({ host: "github.com", key, rows }))[0]!.expires).toBe(-1);
  });

  it("reads the httpOnly and secure flags out of their bigint columns", () => {
    const rows = [
      jarRow({ hostKey: ".github.com", httpOnly: true, key, name: "logged_in", secure: false, value: "yes" }),
    ];
    const cookie = unwrap(cookiesFromRows({ host: "github.com", key, rows }))[0]!;
    expect({ httpOnly: cookie.httpOnly, secure: cookie.secure }).toEqual({ httpOnly: true, secure: false });
  });

  it("reads both flags set, so neither is passing by sharing the other's default", () => {
    const rows = [
      jarRow({ hostKey: ".github.com", httpOnly: true, key, name: "logged_in", secure: true, value: "yes" }),
    ];
    const cookie = unwrap(cookiesFromRows({ host: "github.com", key, rows }))[0]!;
    expect({ httpOnly: cookie.httpOnly, secure: cookie.secure }).toEqual({ httpOnly: true, secure: true });
  });
});

describe("the fixture encrypts what Chrome encrypts", () => {
  // Falsifiable witness for every test above: if `chromeEncrypt` stopped matching Chrome's format, the
  // prefix check is what would catch it rather than a suite that agrees with itself.
  it("writes Chrome's own v10 prefix", () => {
    const blob = chromeEncrypt({ hostKey: ".github.com", key, plaintext: "yes" });
    expect(blob.subarray(0, 3).toString("latin1")).toBe("v10");
  });

  it("spends 32 bytes on the host digest, so a one-byte value still fills two cipher blocks", () => {
    const blob = chromeEncrypt({ hostKey: ".github.com", key, plaintext: "y" });
    expect(blob.byteLength).toBe(3 + 48);
  });
});
