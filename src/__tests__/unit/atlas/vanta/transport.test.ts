/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  isVantaHttpError,
  VantaHttpErrors,
  type VantaTransportFailure,
  vantaTransportFailureLines,
} from "../../../../atlas/vanta/httpErrors.js";
import {
  createVantaTransport,
  VANTA_API_HOST,
  type VantaFetchLike,
  type VantaRawResponse,
  type VantaSleepLike,
} from "../../../../atlas/vanta/transport.js";
import { logger } from "../../../../lib/logger.js";
import { type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

const noSleep: VantaSleepLike = async () => undefined;

/** A failed request's typed error and the lines it prints, for a result the test expects to have failed. */
function failureOf({ result }: { result: Result<VantaRawResponse, VantaTransportFailure> }): {
  readonly code: string;
  readonly lines: readonly string[];
} {
  const error = unwrapErr(result);
  const lines = vantaTransportFailureLines({ error });
  if (!isVantaHttpError(error)) {
    return { code: "LINES", lines };
  }
  return { code: error.code, lines };
}

function okFetch({ body }: { body: string }): VantaFetchLike {
  return async () => ({ headers: {}, status: 200, text: async () => body });
}

describe("createVantaTransport", () => {
  it("returns the body on a 2xx response", async () => {
    const transport = createVantaTransport({ fetchImpl: okFetch({ body: '{"ok":true}' }), logger, sleep: noSleep });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/controls" });
    expect(unwrap(result).body).toBe('{"ok":true}');
    expect(unwrap(result).status).toBe(200);
  });

  it("returns a Result when the headers arrive but the body cannot be read, rather than throwing", async () => {
    const fetchImpl: VantaFetchLike = async () => ({
      headers: {},
      status: 200,
      text: async () => {
        throw new Error("The operation was aborted");
      },
    });
    const transport = createVantaTransport({ fetchImpl, logger, sleep: noSleep });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/event-logs" });
    const failure = failureOf({ result });
    expect(failure.code).toBe("BODY_UNREAD");
    expect(failure.lines[0]).toContain("returned headers but its body could not be read");
  });

  it("addresses only the pinned Vanta host", async () => {
    let calledUrl = "";
    const fetchImpl: VantaFetchLike = async (url) => {
      calledUrl = url;
      return { headers: {}, status: 200, text: async () => "{}" };
    };
    const transport = createVantaTransport({ fetchImpl, logger, sleep: noSleep });
    await transport.request({ headers: {}, method: "GET", path: "/v1/controls" });
    expect(calledUrl).toBe(`https://${VANTA_API_HOST}/v1/controls`);
  });

  it("refuses a redirect rather than following it", async () => {
    const fetchImpl: VantaFetchLike = async () => ({ headers: {}, status: 302, text: async () => "" });
    const transport = createVantaTransport({ fetchImpl, logger, sleep: noSleep });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/controls" });
    const failure = failureOf({ result });
    expect(failure.code).toBe("REDIRECT_REFUSED");
    expect(failure.lines.some((line) => line.includes("refuses to follow"))).toBe(true);
  });

  it("retries a 500 and eventually succeeds", async () => {
    let attempt = 0;
    const fetchImpl: VantaFetchLike = async () => {
      attempt += 1;
      return attempt < 2
        ? { headers: {}, status: 500, text: async () => "server error" }
        : { headers: {}, status: 200, text: async () => '{"ok":true}' };
    };
    const transport = createVantaTransport({ fetchImpl, logger, sleep: noSleep });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/controls" });
    expect(unwrap(result).body).toBe('{"ok":true}');
    expect(attempt).toBe(2);
  });

  it("does not retry a 401 — it is a credential problem, not a transient fault", async () => {
    let attempt = 0;
    const fetchImpl: VantaFetchLike = async () => {
      attempt += 1;
      return { headers: {}, status: 401, text: async () => "nope" };
    };
    const transport = createVantaTransport({ fetchImpl, logger, sleep: noSleep });
    const result = await transport.request({
      headers: { authorization: "Bearer secret-token" },
      method: "GET",
      path: "/v1/controls",
    });
    expect(unwrapErr(result)).toEqual(VantaHttpErrors.httpStatus({ safePath: "/v1/controls", status: 401 }));
    expect(attempt).toBe(1);
    expect(failureOf({ result }).lines.some((line) => line.includes("entitlement or credential problem"))).toBe(true);
  });

  // A failure REASON is published: it reaches a coverage cell, a gap and the manifest's lastAttempt.reasons,
  // all committed to the generation. So the provider's own error text must not be in one at all. Redacting
  // it was never enough, because redaction only removes the credentials this process SENT, and the risk is
  // whatever the server chose to RETURN.
  it("keeps the provider's error body out of the reasons it publishes", async () => {
    const providerBody = "token was: secret-token, and user ada@example.invalid failed";
    const fetchImpl: VantaFetchLike = async () => ({ headers: {}, status: 401, text: async () => providerBody });
    const transport = createVantaTransport({ fetchImpl, logger, sleep: noSleep });
    const result = await transport.request({
      headers: { authorization: "Bearer secret-token" },
      method: "GET",
      path: "/v1/controls",
    });
    const message = failureOf({ result }).lines.join(" ");
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(providerBody).toContain("secret-token");
    expect(providerBody).toContain("ada@example.invalid");
    expect(message).not.toContain("secret-token");
    expect(message).not.toContain("ada@example.invalid");
    expect(message).toBe(
      "/v1/controls returned HTTP 401 this is an entitlement or credential problem, not a transient fault",
    );
  });

  // Dropped from the artifact, not from the operator: the body still reaches the log, with the credentials
  // this process sent replaced first.
  it("logs the error body so it stays diagnosable, with the sent credential redacted", async () => {
    const lines: string[] = [];
    const capturing = { ...logger, warn: ({ msg }: { msg: string }) => lines.push(msg) };
    const fetchImpl: VantaFetchLike = async () => ({
      headers: {},
      status: 401,
      text: async () => "token was: secret-token",
    });
    const transport = createVantaTransport({ fetchImpl, logger: capturing, sleep: noSleep });
    await transport.request({
      headers: { authorization: "Bearer secret-token" },
      method: "GET",
      path: "/v1/controls",
    });
    const logged = lines.join(" ");
    expect(logged).toContain("[REDACTED]");
    expect(logged).not.toContain("secret-token");
  });

  // The token mint's body carries the client id and secret. A reflection of one could arrive in an encoding no
  // exact-text redactor enumerates (`\/` here), so a request that declares its body's secrets logs no body at all.
  it("withholds the whole failing body of a request that declared credentials, logging only its length", async () => {
    const lines: string[] = [];
    const capturing = { ...logger, warn: ({ msg }: { msg: string }) => lines.push(msg) };
    const providerBody = String.raw`{"error":"bad client cid-1234 secret abcd\/efgh"}`;
    const fetchImpl: VantaFetchLike = async () => ({ headers: {}, status: 400, text: async () => providerBody });
    const transport = createVantaTransport({ fetchImpl, logger: capturing, sleep: noSleep });
    await transport.request({
      body: '{"client_id":"cid-1234","client_secret":"abcd/efgh"}',
      headers: { "content-type": "application/json" },
      method: "POST",
      path: "/oauth/token",
      sensitiveValues: ["cid-1234", "abcd/efgh"],
    });
    expect(providerBody).toContain(String.raw`abcd\/efgh`);
    expect(lines).toEqual([
      `/oauth/token responded: [body withheld: ${String(providerBody.length)} chars — this request sent declared credentials, which a reflection could carry in any encoding]`,
    ]);
  });

  it("keeps a declared-credential request's thrown fetch and body-read messages out of the published reason", async () => {
    const thrown = 'request failed with body {"client_secret":"abcd/efgh"}';
    const unreachable = createVantaTransport({
      fetchImpl: async () => {
        throw new TypeError(thrown);
      },
      logger,
      sleep: noSleep,
    });
    const unreadBody = createVantaTransport({
      fetchImpl: async () => ({
        headers: {},
        status: 400,
        text: async () => {
          throw new TypeError(thrown);
        },
      }),
      logger,
      sleep: noSleep,
    });
    const mint = {
      body: '{"client_secret":"abcd/efgh"}',
      headers: {},
      method: "POST",
      path: "/oauth/token",
      retryPolicy: "never",
      sensitiveValues: ["abcd/efgh"],
    } as const;
    expect(thrown).toContain("abcd/efgh");
    expect(failureOf({ result: await unreachable.request(mint) }).lines).toEqual([
      "the request to /oauth/token never reached api.vanta.com: TypeError (message withheld: this request sent declared credentials)",
    ]);
    expect(failureOf({ result: await unreadBody.request(mint) }).lines).toEqual([
      "/oauth/token returned headers but its body could not be read: TypeError (message withheld: this request sent declared credentials)",
    ]);
  });

  it("names no found host in a declared-credential request's dead-host refusal, in any case, without sending", async () => {
    let fetched = 0;
    const transport = createVantaTransport({
      fetchImpl: async () => {
        fetched += 1;
        return { headers: {}, status: 200, text: async () => "{}" };
      },
      logger,
      sleep: noSleep,
    });
    const secret = "APP.AP1.DATADOGHQ.COM";
    const body = JSON.stringify({ client_secret: secret });
    const result = await transport.request({
      body,
      headers: {},
      method: "POST",
      path: "/oauth/token",
      retryPolicy: "never",
      sensitiveValues: [secret],
    });
    const lines = failureOf({ result }).lines;
    expect(body).toContain(secret);
    expect(fetched).toBe(0);
    expect(lines.filter((line) => line.toLowerCase().includes(secret.toLowerCase()))).toEqual([]);
    expect(lines[0]).toContain(
      "(the host and where it was found are withheld: this request sent declared credentials).",
    );
  });

  it("names no path in a declared-credential request's dead-host refusal when the host sits in the path", async () => {
    let fetched = 0;
    const transport = createVantaTransport({
      fetchImpl: async () => {
        fetched += 1;
        return { headers: {}, status: 200, text: async () => "{}" };
      },
      logger,
      sleep: noSleep,
    });
    const path = "/v1/app.ap1.datadoghq.com/x";
    const result = await transport.request({
      body: "{}",
      headers: {},
      method: "POST",
      path,
      retryPolicy: "never",
      sensitiveValues: ["unrelated-secret"],
    });
    const lines = failureOf({ result }).lines;
    expect(fetched).toBe(0);
    expect(path).toMatch(/app\.ap1\.datadoghq\.com/);
    expect(lines.filter((line) => /app\.ap1\.datadoghq\.com/i.test(line))).toEqual([]);
    expect(lines[0]).toContain("vanta POST blocked because");
  });

  it("still names the path in a dead-host refusal for a request that declares no credential", async () => {
    const transport = createVantaTransport({
      fetchImpl: async () => ({ headers: {}, status: 200, text: async () => "{}" }),
      logger,
      sleep: noSleep,
    });
    const result = await transport.request({
      body: "{}",
      headers: {},
      method: "POST",
      path: "/v1/app.ap1.datadoghq.com/x",
      retryPolicy: "never",
    });
    expect(failureOf({ result }).lines[0]).toContain("vanta POST /v1/app.ap1.datadoghq.com/x blocked because");
  });

  it("names a declared-credential request's thrown error only by a known class, never by a name the thrower set", async () => {
    const renamed = new Error("network failure");
    renamed.name = "abcd/efgh";
    const transport = createVantaTransport({
      fetchImpl: async () => {
        throw renamed;
      },
      logger,
      sleep: noSleep,
    });
    const result = await transport.request({
      body: '{"client_secret":"abcd/efgh"}',
      headers: {},
      method: "POST",
      path: "/oauth/token",
      retryPolicy: "never",
      sensitiveValues: ["abcd/efgh"],
    });
    expect(renamed.name).toBe("abcd/efgh");
    expect(failureOf({ result }).lines).toEqual([
      "the request to /oauth/token never reached api.vanta.com: Error (message withheld: this request sent declared credentials)",
    ]);
  });

  // The log keeps only the body's first 400 characters; a token longer than that only matches whole before the cut.
  it("redacts a reflected bearer token longer than the logged slice of the body", async () => {
    const lines: string[] = [];
    const capturing = { ...logger, warn: ({ msg }: { msg: string }) => lines.push(msg) };
    const longToken = "S".repeat(512);
    const fetchImpl: VantaFetchLike = async () => ({ headers: {}, status: 401, text: async () => longToken });
    const transport = createVantaTransport({ fetchImpl, logger: capturing, sleep: noSleep });
    await transport.request({ headers: { authorization: `Bearer ${longToken}` }, method: "GET", path: "/v1/controls" });
    const logged = lines.join(" ");
    expect(longToken.length).toBe(512);
    expect(logged).toContain("[REDACTED]");
    expect(logged).not.toContain("SSSS");
  });

  it("classifies a network failure as retryable, then reports it if retries are exhausted", async () => {
    const fetchImpl: VantaFetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    const transport = createVantaTransport({ fetchImpl, logger, sleep: noSleep });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/controls" });
    const failure = failureOf({ result });
    expect(failure.code).toBe("UNREACHABLE");
    expect(failure.lines[0]).toContain("never reached");
  });
});

describe("retry backoff", () => {
  /** A fetch answering each status in order, then 200 for every later call. */
  function sequenceFetch({
    statuses,
    headers = {},
  }: {
    statuses: readonly number[];
    headers?: Readonly<Record<string, string>>;
  }): VantaFetchLike {
    let call = 0;
    return async () => {
      const status = statuses[call];
      call += 1;
      if (status === undefined) {
        return { headers: {}, status: 200, text: async () => '{"ok":true}' };
      }
      return { headers, status, text: async () => "slow down" };
    };
  }

  /**
   * A sleep recording only RETRY waits. The same seam also carries the per-process pacing, which is at most
   * 1.3s, and an injected sleep never advances `Date.now()` so pacing calls appear between attempts; every
   * retry wait asserted here is at least 2s, so a strict `> 1.3` keeps exactly the backoff.
   */
  function recordingSleep({ retryWaits }: { retryWaits: number[] }): VantaSleepLike {
    return async ({ seconds }) => {
      if (seconds > 1.3) {
        retryWaits.push(seconds);
      }
    };
  }

  // A sync once exhausted 2s/4s/8s on every rate-limited surface: fourteen seconds cannot outlast a budget that
  // refills over a minute, so a 429 with no Retry-After waits long enough for the last retry to land in a new one.
  it("backs a 429 with no Retry-After off 15s, 30s, 60s — past a one-minute rate window", async () => {
    const retryWaits: number[] = [];
    const transport = createVantaTransport({
      fetchImpl: sequenceFetch({ statuses: [429, 429, 429] }),
      logger,
      sleep: recordingSleep({ retryWaits }),
    });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/vulnerable-assets" });
    expect(unwrap(result).status).toBe(200);
    expect(retryWaits).toEqual([15, 30, 60]);
  });

  it("keeps the 2s, 4s, 8s ladder for a server fault", async () => {
    const retryWaits: number[] = [];
    const transport = createVantaTransport({
      fetchImpl: sequenceFetch({ statuses: [503, 503, 503] }),
      logger,
      sleep: recordingSleep({ retryWaits }),
    });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/controls" });
    expect(unwrap(result).status).toBe(200);
    expect(retryWaits).toEqual([2, 4, 8]);
  });

  it("still lets a 429's own Retry-After decide the wait", async () => {
    const retryWaits: number[] = [];
    const transport = createVantaTransport({
      fetchImpl: sequenceFetch({ headers: { "Retry-After": "5" }, statuses: [429] }),
      logger,
      sleep: recordingSleep({ retryWaits }),
    });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/controls" });
    expect(unwrap(result).status).toBe(200);
    expect(retryWaits).toEqual([5]);
  });

  // `parseInt` once read "5garbage" as a 5-second Retry-After.
  it("ignores a malformed Retry-After and takes the 429 backoff", async () => {
    const retryWaits: number[] = [];
    const transport = createVantaTransport({
      fetchImpl: sequenceFetch({ headers: { "Retry-After": "5garbage" }, statuses: [429] }),
      logger,
      sleep: recordingSleep({ retryWaits }),
    });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/controls" });
    expect(unwrap(result).status).toBe(200);
    expect(retryWaits).toEqual([15]);
  });

  // The body-read failure path once dropped the headers that had already arrived.
  it("honours a 429's Retry-After even when its body cannot be read", async () => {
    const retryWaits: number[] = [];
    let call = 0;
    const fetchImpl: VantaFetchLike = async () => {
      call += 1;
      if (call > 1) {
        return { headers: {}, status: 200, text: async () => '{"ok":true}' };
      }
      return {
        headers: { "Retry-After": "5" },
        status: 429,
        text: async () => {
          throw new Error("The operation was aborted");
        },
      };
    };
    const transport = createVantaTransport({ fetchImpl, logger, sleep: recordingSleep({ retryWaits }) });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/controls" });
    expect(unwrap(result).status).toBe(200);
    expect(retryWaits).toEqual([5]);
  });

  it("reports a 429 that outlasts every retry as rate limited, after all three waits", async () => {
    const retryWaits: number[] = [];
    const transport = createVantaTransport({
      fetchImpl: sequenceFetch({ statuses: [429, 429, 429, 429] }),
      logger,
      sleep: recordingSleep({ retryWaits }),
    });
    const result = await transport.request({ headers: {}, method: "GET", path: "/v1/vulnerable-assets" });
    expect(failureOf({ result }).lines).toEqual([
      "/v1/vulnerable-assets was rate limited and the retries were exhausted",
    ]);
    expect(retryWaits).toEqual([15, 30, 60]);
  });
});

describe("retryPolicy", () => {
  /** A fetch that fails the first call with a retryable 500 and succeeds on every later one. */
  function flakyFetch({ attempts }: { attempts: number[] }): VantaFetchLike {
    return async () => {
      attempts.push(attempts.length);
      const first = attempts.length === 1;
      return { headers: {}, status: first ? 500 : 200, text: async () => (first ? "upstream" : '{"ok":true}') };
    };
  }

  it("retries a retryable fault by default, which is what every read and every older write gets", async () => {
    const attempts: number[] = [];
    const transport = createVantaTransport({ fetchImpl: flakyFetch({ attempts }), logger, sleep: noSleep });
    const result = await transport.request({ headers: {}, method: "POST", path: "/v1/documents" });
    expect(unwrap(result).status).toBe(200);
    expect(attempts.length).toBe(2);
  });

  it('retries the same way when the caller spells the default "standard"', async () => {
    const attempts: number[] = [];
    const transport = createVantaTransport({ fetchImpl: flakyFetch({ attempts }), logger, sleep: noSleep });
    const result = await transport.request({
      headers: {},
      method: "POST",
      path: "/v1/documents",
      retryPolicy: "standard",
    });
    expect(unwrap(result).status).toBe(200);
    expect(attempts.length).toBe(2);
  });

  // A group-membership call that LANDS and then times out would be re-sent, and the replay's per-person
  // results would say "already in that group" for work the first call really did — a failure that did not
  // happen. So the two legs pass "never" and an ambiguous fault is reported as ambiguous.
  it('sends a "never" request exactly once and reports the fault rather than replaying it', async () => {
    const attempts: number[] = [];
    const transport = createVantaTransport({ fetchImpl: flakyFetch({ attempts }), logger, sleep: noSleep });
    const result = await transport.request({
      headers: {},
      method: "POST",
      path: "/v1/groups/g1/add-people",
      retryPolicy: "never",
    });
    expect(unwrapErr(result)).toEqual(
      VantaHttpErrors.httpStatus({ safePath: "/v1/groups/g1/add-people", status: 500 }),
    );
    expect(failureOf({ result }).lines).toEqual(["/v1/groups/g1/add-people returned HTTP 500"]);
    expect(attempts.length).toBe(1);
  });

  it('never re-sends a "never" request whose connection failed outright either', async () => {
    const attempts: number[] = [];
    const fetchImpl: VantaFetchLike = async () => {
      attempts.push(attempts.length);
      throw new Error("socket hang up");
    };
    const transport = createVantaTransport({ fetchImpl, logger, sleep: noSleep });
    const result = await transport.request({
      headers: {},
      method: "POST",
      path: "/v1/groups/g1/remove-people",
      retryPolicy: "never",
    });
    const failure = failureOf({ result });
    expect(failure.code).toBe("UNREACHABLE");
    expect(failure.lines[0]).toContain("never reached");
    expect(attempts.length).toBe(1);
  });
});
