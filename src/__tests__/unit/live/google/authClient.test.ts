/**
 * Unit: the Google auth client refreshes a cached access token AHEAD of its expiry, and only because the grant
 * carries one. Driven over the real `OAuth2Client` (through `makeGoogleAuthClient`, so the `googleapis-common`
 * copy), with a plain fake `fetch` installed as the transporter's fetch implementation — a seam, not a mock —
 * answering the token endpoint, so no call leaves the process.
 *
 * The library judges expiry against `Date.now()` and its own `eagerRefreshThresholdMillis`, so the clock is
 * fixed with Vitest's fake timers and restored after every test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok } from "../../../../lib/result.js";
import { makeGoogleAuthClient } from "../../../../live/google/authClient.js";
import { GOOGLE_TOKEN_ENDPOINT } from "../../../../live/google/oauth.js";
import type { GoogleGrant } from "../../../../secrets/googleGrant.js";

/** The fixed instant every case judges expiry against. */
const NOW_MS = Date.parse("2026-11-05T08:00:00.000Z");

const BASE: GoogleGrant = {
  accessToken: "at-cached",
  account: "owner@example.com",
  grantedAtIso: "2026-11-05T07:00:00.000Z",
  refreshToken: "rt-1",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Build a client over a fake token endpoint, recording every request URL and every persisted grant. */
function harness({ grant }: { grant: GoogleGrant }): {
  readonly auth: ReturnType<typeof makeGoogleAuthClient>;
  readonly requests: string[];
  readonly persisted: GoogleGrant[];
} {
  const requests: string[] = [];
  const persisted: GoogleGrant[] = [];
  const auth = makeGoogleAuthClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    grant,
    persist: ({ grant: written }) => {
      persisted.push(written);
      return ok("/home/secrets/gmail-oauth.json");
    },
  });
  const fakeFetch: typeof fetch = async (input) => {
    requests.push(input instanceof Request ? input.url : String(input));
    return new Response(JSON.stringify({ access_token: "at-fresh", expires_in: 3600, token_type: "Bearer" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  auth.transporter.defaults.fetchImplementation = fakeFetch;
  return { auth, persisted, requests };
}

describe("makeGoogleAuthClient refresh", () => {
  it("judges expiry against a five-minute eager window — the boundary the cases below sit either side of", () => {
    const { auth } = harness({ grant: BASE });

    expect(auth.eagerRefreshThresholdMillis).toBe(300_000);
  });

  it("refreshes a token still valid for 60 s, BEFORE it expires, and persists the new token and expiry", async () => {
    const { auth, persisted, requests } = harness({ grant: { ...BASE, expiryMs: NOW_MS + 60_000 } });

    const token = await auth.getAccessToken();

    expect(token.token).toBe("at-fresh");
    expect(requests).toStrictEqual([GOOGLE_TOKEN_ENDPOINT]);
    expect(persisted).toStrictEqual([{ ...BASE, accessToken: "at-fresh", expiryMs: NOW_MS + 3_600_000 }]);
  });

  it("carries the refresh token's recorded lapse onto the grant it persists after a refresh", async () => {
    const lapsing = { ...BASE, expiryMs: NOW_MS + 60_000, refreshTokenExpiresAtIso: "2026-11-12T07:00:00.000Z" };
    const { auth, persisted } = harness({ grant: lapsing });

    await auth.getAccessToken();

    expect(persisted).toStrictEqual([{ ...lapsing, accessToken: "at-fresh", expiryMs: NOW_MS + 3_600_000 }]);
  });

  it("hands back the cached token with no refresh while it has ten minutes left", async () => {
    const { auth, persisted, requests } = harness({ grant: { ...BASE, expiryMs: NOW_MS + 600_000 } });

    const token = await auth.getAccessToken();

    expect(token.token).toBe("at-cached");
    expect(requests).toStrictEqual([]);
    expect(persisted).toStrictEqual([]);
  });

  it("never refreshes a cached token whose grant carries NO expiry — the shape a fresh grant used to store", async () => {
    const { auth, persisted, requests } = harness({ grant: BASE });

    const token = await auth.getAccessToken();

    expect(token.token).toBe("at-cached");
    expect(requests).toStrictEqual([]);
    expect(persisted).toStrictEqual([]);
  });
});
