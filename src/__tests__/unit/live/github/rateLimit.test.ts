import { describe, expect, it } from "vitest";

import { toIngestError } from "../../../../lib/ingestError.js";
import { githubRateLimitOf } from "../../../../live/github/rateLimit.js";

const NOW_MS = Date.parse("2026-09-23T09:44:54.000Z");
/** The reset instant as GitHub's `x-ratelimit-reset` spells it: epoch seconds, as a string header. */
const RESET_EPOCH = String(Date.parse("2026-09-23T10:00:00.000Z") / 1000);

/** A thrown value shaped like `@octokit/graphql`'s `GraphqlResponseError`: HTTP 200, headers, errors, no status. */
function graphqlResponseError({
  headers,
  errors,
}: {
  headers: Record<string, string>;
  errors: readonly { message: string; type?: string }[];
}): Error {
  const message = `Request failed due to following response errors:\n${errors.map((e) => ` - ${e.message}`).join("\n")}`;
  return Object.assign(new Error(message), { data: null, errors, headers, name: "GraphqlResponseError" });
}

function failureOf({ error }: { error: unknown }): ReturnType<typeof toIngestError> {
  return toIngestError({ error, operation: "github.graphql.namedObjectRead", provider: "github" });
}

describe("githubRateLimitOf", () => {
  it("reads the incident's shape — GraphQL over HTTP 200, untyped error entry — as limited, reset from the header", () => {
    const failure = failureOf({
      error: graphqlResponseError({
        errors: [{ message: "API rate limit already exceeded for user ID 275964442." }],
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": RESET_EPOCH },
      }),
    });

    expect(failure.kind).toBe("http");
    expect(githubRateLimitOf({ failure, nowMs: NOW_MS })).toEqual({ resetAt: "2026-09-23T10:00:00.000Z" });
  });

  it("reads a RATE_LIMITED error entry as limited even with neither the header nor GitHub's phrasing", () => {
    const failure = failureOf({
      error: Object.assign(new Error("something else"), { errors: [{ type: "RATE_LIMITED" }] }),
    });

    expect(githubRateLimitOf({ failure, nowMs: NOW_MS })).toEqual({ resetAt: undefined });
  });

  it("reads a REST error's response headers, remaining 0, as limited with that reset", () => {
    const failure = failureOf({
      error: Object.assign(new Error("Forbidden"), {
        response: { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": RESET_EPOCH } },
        status: 403,
      }),
    });

    expect(githubRateLimitOf({ failure, nowMs: NOW_MS })).toEqual({ resetAt: "2026-09-23T10:00:00.000Z" });
  });

  it("measures a Retry-After hint from the caller's clock when no reset header came back", () => {
    const failure = failureOf({
      error: Object.assign(new Error("Too Many Requests"), {
        response: { headers: { "retry-after": "30" } },
        status: 429,
      }),
    });

    expect(failure.kind).toBe("rate-limit");
    expect(githubRateLimitOf({ failure, nowMs: NOW_MS })).toEqual({ resetAt: "2026-09-23T09:45:24.000Z" });
  });

  it("says the reset is unknown, rather than throwing, when a Retry-After lands past every representable date", () => {
    const failure = failureOf({
      error: Object.assign(new Error("Too Many Requests"), {
        response: { headers: { "retry-after": "10000000000000" } },
        status: 429,
      }),
    });

    expect(failure.retryAfterMs).toBe(10_000_000_000_000_000);
    expect(githubRateLimitOf({ failure, nowMs: NOW_MS })).toEqual({ resetAt: undefined });
  });

  it("reads the throttling plugin's own exhausted-retries error by its message, and says the reset is unknown", () => {
    const failure = failureOf({ error: new Error("GraphQL Rate Limit Exceeded") });

    expect(githubRateLimitOf({ failure, nowMs: NOW_MS })).toEqual({ resetAt: undefined });
  });

  it("leaves every other failure alone — a 500, a not-found, a not-found that spent the last quota point or echoes limit-like input", () => {
    const serverError = failureOf({
      error: Object.assign(new Error("Server Error on input 'GraphQL Rate Limit Exceeded'"), { status: 500 }),
    });
    const notFound = failureOf({
      error: graphqlResponseError({
        errors: [{ message: "Could not resolve to a PullRequest with the number of 9.", type: "NOT_FOUND" }],
        headers: { "x-ratelimit-remaining": "4210", "x-ratelimit-reset": RESET_EPOCH },
      }),
    });

    const lastPointNotFound = failureOf({
      error: graphqlResponseError({
        errors: [{ message: "Could not resolve to a PullRequest with the number of 9.", type: "NOT_FOUND" }],
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": RESET_EPOCH },
      }),
    });

    const echoedNotFound = failureOf({
      error: graphqlResponseError({
        errors: [
          {
            message: "Could not resolve to a node with the global id of 'GraphQL Rate Limit Exceeded'.",
            type: "NOT_FOUND",
          },
        ],
        headers: { "x-ratelimit-remaining": "4210", "x-ratelimit-reset": RESET_EPOCH },
      }),
    });

    const mixedEchoedNotFound = failureOf({
      error: graphqlResponseError({
        errors: [
          { message: "Could not resolve node 'GraphQL Rate Limit Exceeded'.", type: "NOT_FOUND" },
          { message: "another non-rate-limit GraphQL error" },
        ],
        headers: { "x-ratelimit-remaining": "4210", "x-ratelimit-reset": RESET_EPOCH },
      }),
    });
    const typedServerError = failureOf({
      error: Object.assign(new Error("Internal Server Error"), { errors: [{ type: "RATE_LIMITED" }], status: 500 }),
    });

    expect(githubRateLimitOf({ failure: serverError, nowMs: NOW_MS })).toBeUndefined();
    expect(githubRateLimitOf({ failure: typedServerError, nowMs: NOW_MS })).toBeUndefined();
    expect(githubRateLimitOf({ failure: echoedNotFound, nowMs: NOW_MS })).toBeUndefined();
    expect(githubRateLimitOf({ failure: mixedEchoedNotFound, nowMs: NOW_MS })).toBeUndefined();
    expect(githubRateLimitOf({ failure: lastPointNotFound, nowMs: NOW_MS })).toBeUndefined();
    expect(githubRateLimitOf({ failure: notFound, nowMs: NOW_MS })).toBeUndefined();
  });
});
