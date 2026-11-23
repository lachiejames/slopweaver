import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VantaHttpErrors, vantaHttpErrorLines } from "../../../../atlas/vanta/httpErrors.js";
import {
  createVantaTokenProvider,
  noteIfUnauthorized,
  VANTA_OAUTH_TOKEN_BOUNDARY,
  VANTA_ONE_TOKEN_PER_APP_NOTE,
} from "../../../../atlas/vanta/oauth.js";
import type { VantaTransport } from "../../../../atlas/vanta/transport.js";
import { logger } from "../../../../lib/logger.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

describe("noteIfUnauthorized", () => {
  it("appends the one-token-per-app note to a 401", () => {
    const error = VantaHttpErrors.httpStatus({ safePath: "/v1/controls", status: 401 });
    expect(noteIfUnauthorized({ error })).toEqual([...vantaHttpErrorLines({ error }), VANTA_ONE_TOKEN_PER_APP_NOTE]);
  });

  it("leaves an unrelated status untouched", () => {
    const error = VantaHttpErrors.httpStatus({ safePath: "/v1/controls", status: 500 });
    expect(noteIfUnauthorized({ error })).toEqual(["/v1/controls returned HTTP 500"]);
  });

  // The witnesses for deciding on the typed status rather than the sentence. On main the note was chosen by
  // `errors.some((e) => e.includes("HTTP 401"))`, so a reworded 401 lost it and a path naming "HTTP 401" gained it.
  it("still notes a 401 whose sentence no longer says HTTP 401", () => {
    const error = { ...VantaHttpErrors.httpStatus({ safePath: "/v1/controls", status: 401 }), reasons: ["refused"] };
    expect(noteIfUnauthorized({ error })).toEqual(["refused", VANTA_ONE_TOKEN_PER_APP_NOTE]);
  });

  it("does not note a 500 whose path happens to read HTTP 401", () => {
    const error = VantaHttpErrors.httpStatus({ safePath: "/v1/HTTP 401", status: 500 });
    expect(noteIfUnauthorized({ error })).toEqual(["/v1/HTTP 401 returned HTTP 500"]);
  });

  it("passes a printed-only lines failure through unnoted", () => {
    expect(noteIfUnauthorized({ error: ["x returned HTTP 401"] })).toEqual(["x returned HTTP 401"]);
  });
});

function transportMinting({ accessToken, expiresIn }: { accessToken: string; expiresIn: number }): VantaTransport {
  return {
    request: async (): Promise<Result<{ status: number; headers: Record<string, string>; body: string }>> =>
      ok({
        body: JSON.stringify({ access_token: accessToken, expires_in: expiresIn, token_type: "Bearer" }),
        headers: {},
        status: 200,
      }),
  };
}

describe("createVantaTokenProvider", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-oauth-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("mints and returns a fresh token", async () => {
    const provider = createVantaTokenProvider({
      credentials: { clientId: "c1", clientSecret: "s1" },
      home,
      logger,
      transport: transportMinting({ accessToken: "tok-1", expiresIn: 3600 }),
    });
    const result = await provider.getToken();
    expect(unwrap(result)).toBe("tok-1");
  });

  it("reuses a cached token before it is within the refresh skew of expiring", async () => {
    let mints = 0;
    const transport: VantaTransport = {
      request: async () => {
        mints += 1;
        return ok({
          body: JSON.stringify({ access_token: `tok-${String(mints)}`, expires_in: 3600, token_type: "Bearer" }),
          headers: {},
          status: 200,
        });
      },
    };
    let clockMs = 0;
    const provider = createVantaTokenProvider({
      credentials: { clientId: "c1", clientSecret: "s1" },
      home,
      logger,
      now: () => clockMs,
      transport,
    });
    const first = unwrap(await provider.getToken());
    clockMs += 1_000; // well within the hour-long token's life
    const second = unwrap(await provider.getToken());
    expect(first).toBe(second);
    expect(mints).toBe(1);
  });

  it("re-mints once the cached token is within the refresh skew of expiring", async () => {
    let mints = 0;
    const transport: VantaTransport = {
      request: async () => {
        mints += 1;
        return ok({
          body: JSON.stringify({ access_token: `tok-${String(mints)}`, expires_in: 3600, token_type: "Bearer" }),
          headers: {},
          status: 200,
        });
      },
    };
    let clockMs = 0;
    const provider = createVantaTokenProvider({
      credentials: { clientId: "c1", clientSecret: "s1" },
      home,
      logger,
      now: () => clockMs,
      transport,
    });
    const first = unwrap(await provider.getToken());
    clockMs += 3600 * 1000; // past expiry
    const second = unwrap(await provider.getToken());
    expect(first).toBe("tok-1");
    expect(second).toBe("tok-2");
    expect(mints).toBe(2);
  });

  it("propagates a mint failure", async () => {
    const failing: VantaTransport = { request: async () => err(["oauth endpoint down"]) };
    const provider = createVantaTokenProvider({
      credentials: { clientId: "c1", clientSecret: "s1" },
      home,
      logger,
      transport: failing,
    });
    const result = await provider.getToken();
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(["oauth endpoint down"]);
  });

  it("refuses a mint response that is not valid JSON", async () => {
    const badBody: VantaTransport = { request: async () => ok({ body: "not json", headers: {}, status: 200 }) };
    const provider = createVantaTokenProvider({
      credentials: { clientId: "c1", clientSecret: "s1" },
      home,
      logger,
      transport: badBody,
    });
    const result = await provider.getToken();
    expect(unwrapErr(result)).toEqual(VantaHttpErrors.bodyNotJson({ surface: "the token endpoint" }));
  });

  it("refuses a drifted mint response by drift kind alone, never quoting a key the provider wrote", async () => {
    const body = String.raw`{"access_token":"tok","expires_in":3600,"token_type":"Bearer","s3cr3t":"reflected"}`;
    const drifted: VantaTransport = { request: async () => ok({ body, headers: {}, status: 200 }) };
    const provider = createVantaTokenProvider({
      credentials: { clientId: "c1", clientSecret: "s3cr3t" },
      home,
      logger,
      transport: drifted,
    });
    const result = await provider.getToken();
    expect(Object.keys(JSON.parse(body))).toContain("s3cr3t");
    expect(unwrapErr(result)).toEqual(
      VantaHttpErrors.bodyUnreadable({ issues: [{ message: "new", path: [] }], surface: "the token endpoint" }),
    );
    expect(JSON.stringify(unwrapErr(result))).not.toContain("s3cr3t");
  });

  it("names a declared key the mint response dropped", async () => {
    const body = String.raw`{"access_token":"tok","token_type":"Bearer"}`;
    const dropped: VantaTransport = { request: async () => ok({ body, headers: {}, status: 200 }) };
    const provider = createVantaTokenProvider({
      credentials: { clientId: "c1", clientSecret: "s1" },
      home,
      logger,
      transport: dropped,
    });
    expect(unwrapErr(await provider.getToken())).toEqual(
      VantaHttpErrors.bodyUnreadable({
        issues: [{ message: "missing", path: ["expires_in"] }],
        surface: "the token endpoint",
      }),
    );
  });
});

describe("VANTA_OAUTH_TOKEN_BOUNDARY", () => {
  it("names the token endpoint, which is not under /v1", () => {
    expect(VANTA_OAUTH_TOKEN_BOUNDARY.endpoint).toBe("POST /oauth/token");
  });
});
