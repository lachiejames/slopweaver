/**
 * The transport seam, driven by a plain fake function rather than a mock.
 *
 * Two properties are load-bearing and neither is obvious from reading the calls: the probe never sends an
 * `Authorization` header even when a key exists (so the map is the same on every install), and a probe
 * treats a 401 as the answer it wanted while a content read treats it as a failure.
 */
import { describe, expect, it } from "vitest";

import {
  boundedErrorBody,
  WORKOS_ERROR_BODY_LIMIT,
  type WorkosFetch,
  type WorkosHttpResponse,
  workosProbe,
  workosRead,
} from "../../../../atlas/workos/client.js";
import { unwrap } from "../../../../lib/result.js";

/** A fake transport that records what it was asked for and answers a fixed response. */
function recordingFetch({ response }: { response: WorkosHttpResponse }): {
  fetch: WorkosFetch;
  seen: { url: string; method: string; headers: Readonly<Record<string, string>> }[];
} {
  const seen: { url: string; method: string; headers: Readonly<Record<string, string>> }[] = [];
  return {
    fetch: ({ url, method, headers }) => {
      seen.push({ headers, method, url });
      return Promise.resolve(response);
    },
    seen,
  };
}

describe("workosProbe", () => {
  it("sends the method and path against the origin the atlas owns", async () => {
    const { fetch, seen } = recordingFetch({ response: { status: 401, text: "{}" } });
    await workosProbe({ fetch, httpMethod: "POST", path: "/organizations" });
    expect(seen[0]?.url).toBe("https://api.workos.com/organizations");
    expect(seen[0]?.method).toBe("POST");
  });

  it("sends NO authorization header, so a configured key cannot change the map's shape", async () => {
    const { fetch, seen } = recordingFetch({ response: { status: 401, text: "{}" } });
    await workosProbe({ fetch, httpMethod: "GET", path: "/events" });
    expect(Object.keys(seen[0]!.headers)).toEqual(["accept"]);
  });

  it("returns a 401 as a SUCCESS, because a refusal is the answer a probe wanted", async () => {
    const { fetch } = recordingFetch({ response: { status: 401, text: '{"message":"Unauthorized"}' } });
    const probed = await workosProbe({ fetch, httpMethod: "GET", path: "/events" });
    expect(probed.isOk()).toBe(true);
    expect(unwrap(probed).status).toBe(401);
  });

  it("types a transport throw rather than letting it escape", async () => {
    const fetch: WorkosFetch = () => Promise.reject(new Error("ECONNRESET"));
    const probed = await workosProbe({ fetch, httpMethod: "GET", path: "/events" });
    expect(probed.isErr()).toBe(true);
    expect(probed._unsafeUnwrapErr().code).toBe("TRANSPORT_FAILED");
  });
});

describe("workosRead", () => {
  it("authenticates with a bearer key", async () => {
    const { fetch, seen } = recordingFetch({ response: { status: 200, text: '{"data":[]}' } });
    await workosRead({ apiKey: "sk_test", fetch, path: "/organizations" });
    expect(seen[0]?.headers["authorization"]).toBe("Bearer sk_test");
  });

  it("returns the body's text on 200, for the endpoint's own boundary to read", async () => {
    const { fetch } = recordingFetch({ response: { status: 200, text: '{"data":[{"id":"org_1"}]}' } });
    const read = await workosRead({ apiKey: "sk_test", fetch, path: "/organizations" });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toBe('{"data":[{"id":"org_1"}]}');
  });

  // The opposite contract to the probe's, and the reason the two are separate functions: reading a 401 as
  // "the tenant has no organisations" is how an atlas publishes an empty generation off a rejected key.
  it("treats a 401 as a FAILURE, carrying the status", async () => {
    const { fetch } = recordingFetch({ response: { status: 401, text: '{"message":"Unauthorized"}' } });
    const read = await workosRead({ apiKey: "sk_bad", fetch, path: "/organizations" });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().code).toBe("HTTP_STATUS");
  });

  // Which shape a 200 must have is the endpoint's: `contentBoundaries.test.ts` refuses a body that is not one.
  it("leaves a 200 body uninterpreted, even one that is not a JSON object", async () => {
    const { fetch } = recordingFetch({ response: { status: 200, text: "[]" } });
    const read = await workosRead({ apiKey: "sk_test", fetch, path: "/organizations" });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toBe("[]");
  });

  // Measured: a sync reported only `…/organization_memberships?limit=100 answered HTTP 400`, which named
  // the status and left the REASON — the listing wanting a filter — to be looked up in WorkOS's docs.
  it("carries the refusing endpoint's own body, so a 400 says what it wanted", async () => {
    const { fetch } = recordingFetch({
      response: {
        status: 400,
        text: '{"code":"invalid_request","message":"Either organization_id or user_id is required."}',
      },
    });
    const read = await workosRead({ apiKey: "sk_test", fetch, path: "/user_management/organization_memberships" });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().message).toContain("Either organization_id or user_id is required.");
  });

  it("says a refusal sent nothing, rather than trailing off after the status", async () => {
    const { fetch } = recordingFetch({ response: { status: 502, text: "" } });
    const read = await workosRead({ apiKey: "sk_test", fetch, path: "/organizations" });
    expect(read._unsafeUnwrapErr().message).toBe(
      "https://api.workos.com/organizations answered HTTP 502 with an empty body",
    );
  });
});

describe("boundedErrorBody", () => {
  it("collapses whitespace, so an indented envelope spends its budget on the message", () => {
    expect(boundedErrorBody({ text: '{\n  "message":   "no"\n}\n' })).toBe('{ "message": "no" }');
  });

  it("marks a truncation rather than trailing off mid-word", () => {
    const bounded = boundedErrorBody({ text: "x".repeat(WORKOS_ERROR_BODY_LIMIT + 50) });
    expect(bounded).toBe(
      `${"x".repeat(WORKOS_ERROR_BODY_LIMIT)}… (truncated at ${String(WORKOS_ERROR_BODY_LIMIT)} characters)`,
    );
  });

  it("leaves a body exactly at the bound whole", () => {
    expect(boundedErrorBody({ text: "y".repeat(WORKOS_ERROR_BODY_LIMIT) })).toBe("y".repeat(WORKOS_ERROR_BODY_LIMIT));
  });

  it("answers an empty string for a body that is nothing but whitespace", () => {
    expect(boundedErrorBody({ text: "  \n\t " })).toBe("");
  });
});
