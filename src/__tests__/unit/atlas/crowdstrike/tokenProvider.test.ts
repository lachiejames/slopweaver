import { describe, expect, it } from "vitest";

import type { CrowdstrikeCredentials } from "../../../../atlas/crowdstrike/credentialFiles.js";
import { CrowdstrikeErrors } from "../../../../atlas/crowdstrike/errors.js";
import {
  createTokenProvider,
  isTokenUsable,
  type MintedToken,
  REFRESH_SKEW_MS,
  readMintedToken,
  type TokenMinter,
} from "../../../../atlas/crowdstrike/tokenProvider.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const CREDENTIALS: CrowdstrikeCredentials = {
  apiHost: "https://api.us-2.example.test",
  clientId: "id",
  clientSecret: "secret",
};

/** Synthetic, and never a real token — it exists so a failure message can be checked for echoing one. */
const MINTED_TOKEN = "crowdstrike-bearer-synthetic-0000";

/** A minter that counts its calls and hands back successive tokens — a fake, not a mock. */
function countingMinter({ lifetimeMs }: { lifetimeMs: number }): { minter: TokenMinter; calls: () => number } {
  let calls = 0;
  const minter: TokenMinter = async () => {
    calls += 1;
    return ok({ accessToken: `token-${calls}`, expiresAtMs: NOW + lifetimeMs });
  };
  return { calls: () => calls, minter };
}

const NOW = 1_800_000_000_000;

describe("isTokenUsable", () => {
  it("rejects a held token of null", () => {
    expect(isTokenUsable({ nowMs: NOW, token: null })).toBe(false);
  });

  it("accepts a token with life beyond the skew", () => {
    const token: MintedToken = { accessToken: "t", expiresAtMs: NOW + REFRESH_SKEW_MS + 1 };
    expect(isTokenUsable({ nowMs: NOW, token })).toBe(true);
  });

  it("RETIRES a token inside the skew, so no request outlives its own bearer", () => {
    const token: MintedToken = { accessToken: "t", expiresAtMs: NOW + REFRESH_SKEW_MS - 1 };
    expect(isTokenUsable({ nowMs: NOW, token })).toBe(false);
  });

  it("rejects an already-expired token", () => {
    expect(isTokenUsable({ nowMs: NOW, token: { accessToken: "t", expiresAtMs: NOW - 1 } })).toBe(false);
  });
});

describe("createTokenProvider", () => {
  it("mints once and reuses while the token is live", async () => {
    const { calls, minter } = countingMinter({ lifetimeMs: 1_799_000 });
    const provider = createTokenProvider({ credentials: CREDENTIALS, mint: minter });
    expect(unwrap(await provider.token({ nowMs: NOW }))).toBe("token-1");
    expect(unwrap(await provider.token({ nowMs: NOW + 1000 }))).toBe("token-1");
    expect(calls()).toBe(1);
    expect(provider.mintCount()).toBe(1);
  });

  it("RE-MINTS mid-run once the held token falls inside the skew", async () => {
    const { calls, minter } = countingMinter({ lifetimeMs: 1_799_000 });
    const provider = createTokenProvider({ credentials: CREDENTIALS, mint: minter });
    expect(unwrap(await provider.token({ nowMs: NOW }))).toBe("token-1");
    const past = NOW + 1_799_000 - REFRESH_SKEW_MS + 1;
    expect(unwrap(await provider.token({ nowMs: past }))).toBe("token-2");
    expect(calls()).toBe(2);
  });

  it("mints once for a concurrent fan-out rather than once per caller", async () => {
    const { calls, minter } = countingMinter({ lifetimeMs: 1_799_000 });
    const provider = createTokenProvider({ credentials: CREDENTIALS, mint: minter });
    const tokens = await Promise.all([
      provider.token({ nowMs: NOW }),
      provider.token({ nowMs: NOW }),
      provider.token({ nowMs: NOW }),
    ]);
    expect(tokens.map((result) => unwrap(result))).toEqual(["token-1", "token-1", "token-1"]);
    expect(calls()).toBe(1);
  });

  it("mints again after invalidate, which is the one 401 retry", async () => {
    const { calls, minter } = countingMinter({ lifetimeMs: 1_799_000 });
    const provider = createTokenProvider({ credentials: CREDENTIALS, mint: minter });
    await provider.token({ nowMs: NOW });
    provider.invalidate();
    expect(unwrap(await provider.token({ nowMs: NOW }))).toBe("token-2");
    expect(calls()).toBe(2);
  });

  it("propagates a mint failure without counting it as a mint", async () => {
    const failing: TokenMinter = async () =>
      err(CrowdstrikeErrors.authFailed({ reason: "answered HTTP 400", remintAttempted: false }));
    const provider = createTokenProvider({ credentials: CREDENTIALS, mint: failing });
    const error = unwrapErr(await provider.token({ nowMs: NOW }));
    expect(error.code).toBe("AUTH_FAILED");
    expect(provider.mintCount()).toBe(0);
  });
});

/** A token answer's body, as Falcon sends one. */
const answer = ({ fields }: { fields: Record<string, unknown> }): string => JSON.stringify(fields);

describe("readMintedToken", () => {
  it("measures expiry from when the request was SENT, not from when it was parsed", () => {
    const text = answer({ fields: { access_token: "t", expires_in: 1799, token_type: "bearer" } });
    const token = unwrap(readMintedToken({ requestedAtMs: NOW, text }));
    expect(token).toEqual({ accessToken: "t", expiresAtMs: NOW + 1_799_000 });
  });

  it("refuses a response with no access token, naming the field", () => {
    const text = answer({ fields: { expires_in: 1799 } });
    expect(unwrapErr(readMintedToken({ requestedAtMs: NOW, text })).message).toContain(
      'field "access_token" is missing',
    );
  });

  it("refuses an empty access token, because there is nothing to send", () => {
    const text = answer({ fields: { access_token: "", expires_in: 1799 } });
    expect(unwrapErr(readMintedToken({ requestedAtMs: NOW, text })).message).toContain('field "access_token" changed');
  });

  it("refuses a token whose life is unknown or not positive, rather than assuming one", () => {
    const absent = answer({ fields: { access_token: "t" } });
    const zero = answer({ fields: { access_token: "t", expires_in: 0 } });
    expect(unwrapErr(readMintedToken({ requestedAtMs: NOW, text: absent })).message).toContain(
      'field "expires_in" is missing',
    );
    expect(unwrapErr(readMintedToken({ requestedAtMs: NOW, text: zero })).message).toContain(
      'field "expires_in" changed',
    );
  });

  it("refuses a key Falcon added, by name, rather than reading past it", () => {
    const text = answer({ fields: { access_token: "t", expires_in: 1799, scope: "hosts:read" } });
    const error = unwrapErr(readMintedToken({ requestedAtMs: NOW, text }));
    expect(error.code).toBe("AUTH_FAILED");
    expect(error.message).toContain('new field "scope"');
  });

  it("names a rename as one, so the edit that fixes it is obvious", () => {
    const text = answer({ fields: { access_tokens: "t", expires_in: 1799 } });
    expect(unwrapErr(readMintedToken({ requestedAtMs: NOW, text })).message).toContain(
      'field "access_token" renamed to "access_tokens"?',
    );
  });

  it("refuses a body that is not JSON", () => {
    expect(unwrapErr(readMintedToken({ requestedAtMs: NOW, text: "<html>" })).message).toContain(
      "answered a body that is not JSON",
    );
  });

  it("never quotes the response body in a failure, because that is where a credential echoes back", () => {
    // The body carries a real-shaped token AND still fails, which is the only arrangement that can catch an
    // echo: a body with no credential in it is absent from the message for free
    // (`.claude/rules/testing.md`'s falsifiable-witness rule).
    const text = answer({ fields: { access_token: MINTED_TOKEN, expires_in: 0, token_typ: "bearer" } });
    const error = unwrapErr(readMintedToken({ requestedAtMs: NOW, text }));
    expect(text).toContain(MINTED_TOKEN);
    expect(error.message).toContain('field "expires_in" changed');
    expect(error.message).not.toContain(MINTED_TOKEN);
  });
});
