import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  classifyHexStatus,
  createHexClient,
  type HexFetchLike,
  parseHexBody,
  retryAfterSeconds,
  withQuery,
} from "../../../hex/client.js";
import type { HexReadError } from "../../../hex/errors.js";
import { defineBoundary } from "../../../lib/boundary.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/**
 * Narrow one failure to the code the case is about, THROWING when it is another — the error-side twin of
 * `unwrap`, so no assertion below needs a conditional to reach a code-specific field.
 */
function as<TCode extends HexReadError["code"]>({
  error,
  code,
}: {
  error: HexReadError;
  code: TCode;
}): Extract<HexReadError, { code: TCode }> {
  if (error.code !== code) {
    throw new Error(`expected ${code}, got ${error.code}`);
  }
  return error as Extract<HexReadError, { code: TCode }>;
}

/** One canned response, in the shape the injected fetch seam hands back. */
interface Canned {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A fetch seam that answers each call from a queue and records every URL it was given. */
function cannedFetch({ responses, calls }: { responses: Canned[]; calls: string[] }): HexFetchLike {
  return (url) => {
    calls.push(url);
    const next = responses.shift();
    if (next === undefined) {
      throw new Error(`the fake fetch was called for ${url} with no canned response left — the case queued too few`);
    }
    const answer = next;
    return Promise.resolve({
      headers: answer.headers,
      status: answer.status,
      text: () => Promise.resolve(answer.body),
    });
  };
}

/** A sleep seam that records what it was asked to wait rather than waiting. */
function recordingSleep({ waits }: { waits: number[] }): ({ seconds }: { seconds: number }) => Promise<void> {
  return ({ seconds }) => {
    waits.push(seconds);
    return Promise.resolve();
  };
}

const CONFIG = { apiOrigin: "https://app.hex.tech/api", token: "hex-token-value" } as const;
const SCHEMA = defineBoundary({ endpoint: "GET /v1/test", schema: z.strictObject({ id: z.string() }) });

describe("withQuery", () => {
  it("renders every defined parameter and drops the undefined ones", () => {
    expect(withQuery({ path: "/v1/projects", query: { after: undefined, limit: 25 } })).toBe("/v1/projects?limit=25");
  });

  it("leaves a path alone when the query survives empty", () => {
    expect(withQuery({ path: "/v1/projects", query: { after: undefined } })).toBe("/v1/projects");
  });

  it("leaves a path alone when there is no query at all", () => {
    expect(withQuery({ path: "/v1/users/me", query: undefined })).toBe("/v1/users/me");
  });
});

describe("retryAfterSeconds", () => {
  it("reads the lower-cased header", () => {
    expect(retryAfterSeconds({ headers: { "retry-after": "12" } })).toBe(12);
  });

  it("reads the capitalised header too", () => {
    expect(retryAfterSeconds({ headers: { "Retry-After": "3" } })).toBe(3);
  });

  it("answers null for an absent header", () => {
    expect(retryAfterSeconds({ headers: {} })).toBeNull();
  });

  it("answers null for an HTTP-date, which this client deliberately does not parse", () => {
    expect(retryAfterSeconds({ headers: { "retry-after": "Wed, 16 Sep 2026 03:00:00 GMT" } })).toBeNull();
  });
});

describe("classifyHexStatus", () => {
  it("maps 401 to UNAUTHORIZED", () => {
    expect(classifyHexStatus({ path: "/v1/users/me", raw: "bad token", status: 401 }).code).toBe("UNAUTHORIZED");
  });

  it("maps 403 to FORBIDDEN and says a 403 is not a verdict for the workspace", () => {
    const error = classifyHexStatus({ path: "/v1/projects/x", raw: "no", status: 403 });
    expect(error.code).toBe("FORBIDDEN");
    expect(error.message).toContain("not an auth verdict for the workspace");
  });

  it("maps 404 to NOT_FOUND", () => {
    expect(classifyHexStatus({ path: "/v1/projects/x", raw: "gone", status: 404 }).code).toBe("NOT_FOUND");
  });

  it("keeps the status on anything else and refuses to call it empty", () => {
    const error = classifyHexStatus({ path: "/v1/projects", raw: "boom", status: 500 });
    expect(error.code).toBe("REQUEST_FAILED");
    expect(error.message).toContain("NOT empty");
  });
});

describe("parseHexBody", () => {
  it("parses a body the boundary accepts", () => {
    const parsed = parseHexBody({ boundary: SCHEMA, path: "/v1/x", raw: '{"id":"abc"}' });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).id).toBe("abc");
  });

  it("reports a non-JSON body as MALFORMED_RESPONSE carrying the boundary's BOUNDARY_NOT_JSON", () => {
    const parsed = parseHexBody({ boundary: SCHEMA, path: "/v1/x", raw: "<html>" });
    const malformed = as({ code: "MALFORMED_RESPONSE", error: unwrapErr(parsed) });
    expect(malformed.boundaryError.code).toBe("BOUNDARY_NOT_JSON");
    expect(malformed.message).toContain("GET /v1/test answered a body that is not JSON");
  });

  it("keeps the boundary's drift whole, naming a new field by path", () => {
    const parsed = parseHexBody({ boundary: SCHEMA, path: "/v1/x", raw: '{"id":"abc","secret":"s"}' });
    const malformed = as({ code: "MALFORMED_RESPONSE", error: unwrapErr(parsed) });
    expect(malformed.boundaryError).toEqual({
      code: "BOUNDARY_SHAPE_CHANGED",
      drift: [{ detail: 'new field "secret"', kind: "new", path: "secret" }],
      endpoint: "GET /v1/test",
      message: 'GET /v1/test answered a shape this version does not read — refused, not guessed: new field "secret"',
    });
    expect(malformed.message).toContain('new field "secret"');
  });
});

describe("createHexClient", () => {
  it("sends the bearer token to the pinned origin and parses a 200", async () => {
    const calls: string[] = [];
    const client = createHexClient({
      config: CONFIG,
      fetch: cannedFetch({ calls, responses: [{ body: '{"id":"p1"}', headers: {}, status: 200 }] }),
      sleep: recordingSleep({ waits: [] }),
    });
    const read = await client.get({ path: "/v1/projects/p1", boundary: SCHEMA });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read).id).toBe("p1");
    expect(calls).toEqual(["https://app.hex.tech/api/v1/projects/p1"]);
  });

  it("hands a 2xx body back from getText unchanged, JSON or not", async () => {
    const calls: string[] = [];
    const client = createHexClient({
      config: CONFIG,
      fetch: cannedFetch({ calls, responses: [{ body: "plain <text>", headers: {}, status: 200 }] }),
      sleep: recordingSleep({ waits: [] }),
    });
    const read = await client.getText({ path: "/v1/context/topics", query: { limit: 3 } });
    expect(unwrap(read)).toEqual({ bodyText: "plain <text>", status: 200 });
    expect(calls).toEqual(["https://app.hex.tech/api/v1/context/topics?limit=3"]);
  });

  it("refuses a path outside /v1/ before making any call at all", async () => {
    const calls: string[] = [];
    const client = createHexClient({
      config: CONFIG,
      fetch: cannedFetch({ calls, responses: [] }),
      sleep: recordingSleep({ waits: [] }),
    });
    const read = await client.get({ path: "/v2/secret", boundary: SCHEMA });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("REQUEST_FAILED");
    expect(calls).toEqual([]);
  });

  it("retries a 429 ONCE, waiting what Retry-After asked, then succeeds", async () => {
    const calls: string[] = [];
    const waits: number[] = [];
    const client = createHexClient({
      config: CONFIG,
      fetch: cannedFetch({
        calls,
        responses: [
          { body: "slow down", headers: { "retry-after": "7" }, status: 429 },
          { body: '{"id":"p1"}', headers: {}, status: 200 },
        ],
      }),
      sleep: recordingSleep({ waits }),
    });
    const read = await client.get({ path: "/v1/projects/p1", boundary: SCHEMA });
    expect(read.isOk()).toBe(true);
    expect(waits).toEqual([7]);
    expect(calls.length).toBe(2);
  });

  it("caps the honoured Retry-After rather than sleeping as long as Hex asks", async () => {
    const waits: number[] = [];
    const client = createHexClient({
      config: CONFIG,
      fetch: cannedFetch({
        calls: [],
        responses: [
          { body: "slow down", headers: { "retry-after": "9999" }, status: 429 },
          { body: '{"id":"p1"}', headers: {}, status: 200 },
        ],
      }),
      sleep: recordingSleep({ waits }),
    });
    await client.get({ path: "/v1/projects/p1", boundary: SCHEMA });
    expect(waits).toEqual([60]);
  });

  it("reports RATE_LIMITED after a second 429 rather than looping", async () => {
    const calls: string[] = [];
    const client = createHexClient({
      config: CONFIG,
      fetch: cannedFetch({
        calls,
        responses: [
          { body: "slow", headers: { "retry-after": "2" }, status: 429 },
          { body: "slow", headers: { "retry-after": "4" }, status: 429 },
        ],
      }),
      sleep: recordingSleep({ waits: [] }),
    });
    const read = await client.get({ path: "/v1/projects", boundary: SCHEMA });
    expect(read.isErr()).toBe(true);
    expect(as({ code: "RATE_LIMITED", error: unwrapErr(read) }).retryAfterSeconds).toBe(4);
    expect(calls.length).toBe(2);
  });

  it("carries a thrown transport failure as REQUEST_FAILED with no status", async () => {
    const client = createHexClient({
      config: CONFIG,
      fetch: () => Promise.reject(new Error("socket hang up")),
      sleep: recordingSleep({ waits: [] }),
    });
    const read = await client.get({ path: "/v1/users/me", boundary: SCHEMA });
    expect(read.isErr()).toBe(true);
    expect(as({ code: "REQUEST_FAILED", error: unwrapErr(read) }).status).toBeNull();
  });
});
