import { describe, expect, it } from "vitest";

import { createVantaManageClient } from "../../../../atlas/vanta/client.js";
import { VantaHttpErrors, type VantaTransportFailure } from "../../../../atlas/vanta/httpErrors.js";
import type { VantaTokenProvider } from "../../../../atlas/vanta/oauth.js";
import { VantaSurfaceErrors } from "../../../../atlas/vanta/surfaceErrors.js";
import type { VantaRawResponse, VantaTransport } from "../../../../atlas/vanta/transport.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

function tokenProvider({ token }: { token: string }): VantaTokenProvider {
  return { getToken: async () => ok(token) };
}

function controlsPage({ ids }: { ids: readonly string[] }): {
  results: {
    data: unknown[];
    pageInfo: { endCursor: null; hasNextPage: false; hasPreviousPage: false; startCursor: null };
  };
} {
  return {
    results: {
      data: ids.map((id) => ({
        creationDate: null,
        customFields: [],
        description: "d",
        domains: [],
        externalId: null,
        id,
        modificationDate: null,
        name: "n",
        owner: null,
        role: null,
        source: "Custom",
      })),
      pageInfo: { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null },
    },
  };
}

describe("createVantaManageClient", () => {
  it("lists controls, sending the resolved bearer token", async () => {
    let sentAuth = "";
    const transport: VantaTransport = {
      request: async (init): Promise<Result<VantaRawResponse>> => {
        sentAuth = init.headers["authorization"]!;
        return ok({ body: JSON.stringify(controlsPage({ ids: ["c1", "c2"] })), headers: {}, status: 200 });
      },
    };
    const client = createVantaManageClient({ tokenProvider: tokenProvider({ token: "tok-abc" }), transport });
    const result = await client.listControlsActive();
    expect(unwrap(result).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(sentAuth).toBe("Bearer tok-abc");
  });

  it("propagates a token-resolution failure", async () => {
    const transport: VantaTransport = { request: async () => ok({ body: "{}", headers: {}, status: 200 }) };
    const client = createVantaManageClient({ tokenProvider: { getToken: async () => err(["no token"]) }, transport });
    const result = await client.listControlsActive();
    expect(unwrapErr(result)).toEqual(VantaSurfaceErrors.detailUnreadable({ reasons: ["no token"] }));
  });

  it("grades a refused status from its typed code, whatever its sentence says", async () => {
    const transport: VantaTransport = {
      request: async () => err(VantaHttpErrors.httpStatus({ safePath: "/v1/controls", status: 403 })),
    };
    const client = createVantaManageClient({ tokenProvider: tokenProvider({ token: "t" }), transport });
    const result = await client.listControlsActive();
    expect(unwrapErr(result).code).toBe("API_SCOPE_REFUSED");
  });

  it("refuses a page body that fails schema validation", async () => {
    const transport: VantaTransport = {
      request: async () =>
        ok({ body: JSON.stringify({ results: { data: "not-an-array", pageInfo: {} } }), headers: {}, status: 200 }),
    };
    const client = createVantaManageClient({ tokenProvider: tokenProvider({ token: "unrelated-token" }), transport });
    const result = await client.listControlsActive();
    expect(unwrapErr(result).code).toBe("SCHEMA_DRIFT");
    expect(unwrapErr(result).reasons[0]).toContain("cannot read");
  });

  it("redacts the bearer token from a failed page's errors", async () => {
    const fromTransport = ["saw token Bearer tok-secret in the trace"];
    const transport: VantaTransport = { request: async () => err(fromTransport) };
    const client = createVantaManageClient({ tokenProvider: tokenProvider({ token: "tok-secret" }), transport });
    const result = await client.listControlsActive();
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(fromTransport.join(" ")).toContain("tok-secret");
    expect(unwrapErr(result).reasons.join(" ")).not.toContain("tok-secret");
    expect(unwrapErr(result).message).not.toContain("tok-secret");
  });

  it("getTestEntitySample refuses a limit outside 1..10", async () => {
    const transport: VantaTransport = { request: async () => ok({ body: "{}", headers: {}, status: 200 }) };
    const client = createVantaManageClient({ tokenProvider: tokenProvider({ token: "t" }), transport });
    const result = await client.getTestEntitySample({ limit: 11, testId: "t1" });
    expect(unwrapErr(result)).toEqual(["test entity sample limit must be an integer from 1 to 10"]);
  });

  it("listTestEntities sends entityStatus in the query and reads every row of the page", async () => {
    const paths: string[] = [];
    const entity = {
      createdDate: null,
      deactivatedReason: "archived",
      displayName: "repo",
      entityStatus: "DEACTIVATED",
      id: "e1",
      lastUpdatedDate: null,
      responseType: "Repository",
    };
    const transport: VantaTransport = {
      request: async (init): Promise<Result<VantaRawResponse>> => {
        paths.push(init.path);
        return ok({
          body: JSON.stringify({
            results: {
              data: [entity],
              pageInfo: { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null },
            },
          }),
          headers: {},
          status: 200,
        });
      },
    };
    const client = createVantaManageClient({ tokenProvider: tokenProvider({ token: "t" }), transport });
    const result = await client.listTestEntities({ entityStatus: "DEACTIVATED", testId: "t1" });
    expect(unwrap(result)).toEqual([entity]);
    expect(paths).toEqual(["/v1/tests/t1/entities?pageSize=100&entityStatus=DEACTIVATED"]);
  });

  it("getControl fetches a single object by its endpoint", async () => {
    const detail = {
      creationDate: null,
      customFields: [],
      description: "d",
      domains: [],
      externalId: null,
      id: "c1",
      modificationDate: null,
      name: "n",
      note: null,
      numDocumentsPassing: 0,
      numDocumentsTotal: 0,
      numTestsPassing: 0,
      numTestsTotal: 0,
      owner: null,
      role: null,
      source: "Custom",
      status: "OK",
    };
    const transport: VantaTransport = {
      request: async () => ok({ body: JSON.stringify(detail), headers: {}, status: 200 }),
    };
    const client = createVantaManageClient({ tokenProvider: tokenProvider({ token: "t" }), transport });
    const result = await client.getControl({ controlId: "c1" });
    expect(unwrap(result).id).toBe("c1");
  });
});

describe("listChildSurface and the declared per-parent ceiling", () => {
  const token = "tok";
  const surface = "integration-resource-kinds";
  const requested = "/v1/integrations/i2/resource-kinds?pageSize=100";

  /** A transport that answers one canned failure, whatever is asked of it. */
  function refusing({ failure }: { failure: VantaTransportFailure }): VantaTransport {
    return { request: async (): Promise<Result<VantaRawResponse, VantaTransportFailure>> => err(failure) };
  }

  it("reads the provider's bound from a typed first-page status refusal", async () => {
    const client = createVantaManageClient({
      tokenProvider: tokenProvider({ token }),
      transport: refusing({ failure: VantaHttpErrors.httpStatus({ safePath: requested, status: 422 }) }),
    });
    const answered = await client.listChildSurface({ parentId: "i2", surface });
    expect(unwrap(answered)).toEqual({ because: `${requested} returned HTTP 422`, boundedByProvider: true });
  });

  it("still reads the bound when the token equals a path segment and redaction rewrote the sentence", async () => {
    // Codex's counterexample against the sentence match: the transport redacts the token out of the path, so
    // the printed line no longer equals the one the client builds. The typed status is untouched by that.
    const client = createVantaManageClient({
      tokenProvider: tokenProvider({ token: "i2" }),
      transport: refusing({
        failure: VantaHttpErrors.httpStatus({
          safePath: "/v1/integrations/[REDACTED]/resource-kinds?pageSize=100",
          status: 422,
        }),
      }),
    });
    const answered = await client.listChildSurface({ parentId: "i2", surface });
    // Both halves: the bound is read, and its reason carries the redacted path, never the token.
    expect(unwrap(answered)).toEqual({
      because: "/v1/integrations/[REDACTED]/resource-kinds?pageSize=100 returned HTTP 422",
      boundedByProvider: true,
    });
  });

  it("redacts a token out of the bound's whole reason, its status suffix included", async () => {
    const client = createVantaManageClient({
      tokenProvider: tokenProvider({ token: "HTTP 422" }),
      transport: refusing({ failure: VantaHttpErrors.httpStatus({ safePath: requested, status: 422 }) }),
    });
    const answered = await client.listChildSurface({ parentId: "i2", surface });
    expect(unwrap(answered)).toEqual({ because: `${requested} returned [REDACTED]`, boundedByProvider: true });
  });

  it("does NOT read a bound out of a DIFFERENT parent's typed refusal", async () => {
    const failure = VantaHttpErrors.httpStatus({
      safePath: "/v1/integrations/i9/resource-kinds?pageSize=100",
      status: 422,
    });
    const client = createVantaManageClient({
      tokenProvider: tokenProvider({ token }),
      transport: refusing({ failure }),
    });
    const answered = await client.listChildSurface({ parentId: "i2", surface });
    expect(unwrapErr(answered).reasons).toEqual(["/v1/integrations/i9/resource-kinds?pageSize=100 returned HTTP 422"]);
  });

  it("does NOT read a bound out of a printed-only line that is word for word the status sentence", async () => {
    // The witness that the decision reads the code: on main this exact sentence WAS the bound.
    const failure = [`${requested} returned HTTP 422`];
    const client = createVantaManageClient({
      tokenProvider: tokenProvider({ token }),
      transport: refusing({ failure }),
    });
    const answered = await client.listChildSurface({ parentId: "i2", surface });
    expect(unwrapErr(answered).reasons).toEqual(failure);
  });

  it("does NOT read a bound out of a body-read failure, whatever its cause says", async () => {
    const failure = VantaHttpErrors.bodyUnread({ cause: new Error("returned HTTP 422"), safePath: requested });
    const client = createVantaManageClient({
      tokenProvider: tokenProvider({ token }),
      transport: refusing({ failure }),
    });
    const answered = await client.listChildSurface({ parentId: "i2", surface });
    expect(unwrapErr(answered).code).toBe("DETAIL_UNREADABLE");
  });

  it("does NOT read a bound out of a different status", async () => {
    const failure = VantaHttpErrors.httpStatus({ safePath: requested, status: 500 });
    const client = createVantaManageClient({
      tokenProvider: tokenProvider({ token }),
      transport: refusing({ failure }),
    });
    const answered = await client.listChildSurface({ parentId: "i2", surface });
    expect(unwrapErr(answered).reasons).toEqual([`${requested} returned HTTP 500`]);
  });

  it("does NOT read a bound out of a TOKEN failure, which never reached the provider at all", async () => {
    // Token acquisition returns before `transport.request` is called, so its failure is not the provider
    // answering — it is this atlas failing to ask, even when it is the same typed status.
    let asked = false;
    const client = createVantaManageClient({
      tokenProvider: {
        getToken: async () => err(VantaHttpErrors.httpStatus({ safePath: requested, status: 422 })),
      },
      transport: {
        request: async (): Promise<Result<VantaRawResponse>> => {
          asked = true;
          return err(["unreachable"]);
        },
      },
    });
    const answered = await client.listChildSurface({ parentId: "i2", surface });
    expect(unwrapErr(answered).reasons).toEqual([`${requested} returned HTTP 422`]);
    expect(asked).toBe(false);
  });

  it("does NOT read a bound on a surface that declares none", async () => {
    const failure = VantaHttpErrors.httpStatus({ safePath: "/v1/vendors/v1/assessments?pageSize=100", status: 422 });
    const client = createVantaManageClient({
      tokenProvider: tokenProvider({ token }),
      transport: refusing({ failure }),
    });
    const answered = await client.listChildSurface({ parentId: "v1", surface: "vendor-assessments" });
    expect(unwrapErr(answered).reasons).toEqual(["/v1/vendors/v1/assessments?pageSize=100 returned HTTP 422"]);
  });
});
