import { describe, expect, it } from "vitest";

import { usableToken, vantaTokenCachePath } from "../../../../atlas/vanta/tokenCache.js";

const SKEW = 60_000;
const NOW = 1_760_000_000_000;

describe("usableToken", () => {
  it("returns a token that is comfortably inside its own lifetime", () => {
    expect(
      usableToken({
        decoded: { accessToken: "tok", expiresAtMs: NOW + 30 * 60_000 },
        nowMs: NOW,
        skewMs: SKEW,
      }),
    ).toEqual({ accessToken: "tok", expiresAtMs: NOW + 30 * 60_000 });
  });

  it("rejects a token inside the refresh skew, so no call ever goes out on one about to lapse", () => {
    expect(usableToken({ decoded: { accessToken: "tok", expiresAtMs: NOW + 30_000 }, nowMs: NOW, skewMs: SKEW })).toBe(
      null,
    );
  });

  it("rejects a token that has already expired", () => {
    expect(usableToken({ decoded: { accessToken: "tok", expiresAtMs: NOW - 1 }, nowMs: NOW, skewMs: SKEW })).toBe(null);
  });

  it("rejects a record whose token is empty or missing", () => {
    expect(usableToken({ decoded: { accessToken: "", expiresAtMs: NOW + 60_000_000 }, nowMs: NOW, skewMs: SKEW })).toBe(
      null,
    );
    expect(usableToken({ decoded: { expiresAtMs: NOW + 60_000_000 }, nowMs: NOW, skewMs: SKEW })).toBe(null);
  });

  it("rejects a record whose expiry is not a number", () => {
    expect(usableToken({ decoded: { accessToken: "tok", expiresAtMs: "soon" }, nowMs: NOW, skewMs: SKEW })).toBe(null);
  });

  it("rejects something that is not a record at all, so a corrupt cache mints rather than throws", () => {
    expect(usableToken({ decoded: "nonsense", nowMs: NOW, skewMs: SKEW })).toBe(null);
    expect(usableToken({ decoded: null, nowMs: NOW, skewMs: SKEW })).toBe(null);
  });
});

describe("vantaTokenCachePath", () => {
  it("puts the file under the state home's own secrets tree, named for the key", () => {
    expect(vantaTokenCachePath({ home: "/tmp/a-home", key: "abc123" })).toBe(
      "/tmp/a-home/secrets/vanta-token/abc123.json",
    );
  });

  it("keeps two credentials on one machine in different files", () => {
    expect(vantaTokenCachePath({ home: "/tmp/a-home", key: "one" })).not.toBe(
      vantaTokenCachePath({ home: "/tmp/a-home", key: "two" }),
    );
  });
});

describe("usableToken, against a corrupt cache", () => {
  it("rejects an infinite expiry, which JSON.parse produces from 1e400", () => {
    const decoded: unknown = JSON.parse('{"accessToken":"expired-token","expiresAtMs":1e400}');
    // Without this, an infinite expiry is never inside the refresh skew, so every process reuses one dead
    // token forever.
    expect(usableToken({ decoded, nowMs: NOW, skewMs: SKEW })).toBe(null);
  });

  it("rejects a NaN expiry", () => {
    expect(usableToken({ decoded: { accessToken: "t", expiresAtMs: Number.NaN }, nowMs: NOW, skewMs: SKEW })).toBe(
      null,
    );
  });
});
