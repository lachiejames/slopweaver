import { describe, expect, it } from "vitest";
import { z } from "zod";

import { vantaPageEnvelopeSchema } from "../../../../atlas/vanta/apiSchemas.js";
import { VantaHttpErrors, type VantaTransportFailure } from "../../../../atlas/vanta/httpErrors.js";
import type { VantaManageEndpoint } from "../../../../atlas/vanta/inventory.js";
import type { VantaTokenProvider } from "../../../../atlas/vanta/oauth.js";
import { vantaPagedBoundary } from "../../../../atlas/vanta/pageBoundary.js";
import { VantaSurfaceErrors } from "../../../../atlas/vanta/surfaceErrors.js";
import { pageQuery, singleSurfaceLister } from "../../../../atlas/vanta/surfaceWalk.js";
import type { VantaRawResponse, VantaTransport } from "../../../../atlas/vanta/transport.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

const ENDPOINT: VantaManageEndpoint = { fixedQuery: {}, method: "GET", path: "/v1/things" };
const PAGE_BOUNDARY = vantaPagedBoundary({
  endpoint: "GET /v1/things",
  pageSchema: vantaPageEnvelopeSchema({ dataSchema: z.strictObject({ id: z.string() }) }),
});

/** One page body: the ids, and a cursor when another page follows. */
function pageBody({ ids, next }: { ids: readonly string[]; next: string | null }): VantaRawResponse {
  const pageInfo = { endCursor: next, hasNextPage: next !== null, hasPreviousPage: false, startCursor: null };
  return { body: JSON.stringify({ results: { data: ids.map((id) => ({ id })), pageInfo } }), headers: {}, status: 200 };
}

/** A token provider answering from a list, one answer per call, so a walk can lose its token mid-way. */
function tokensInTurn({ answers }: { answers: readonly Result<string>[] }): VantaTokenProvider {
  let call = 0;
  return { getToken: async () => answers[call++]! };
}

/** A transport answering from a list, one answer per request, recording each path it was asked for. */
function transportInTurn({
  answers,
  paths,
}: {
  answers: readonly Result<VantaRawResponse, VantaTransportFailure>[];
  paths: string[];
}): VantaTransport {
  return {
    request: async (init) => {
      paths.push(init.path);
      return answers[paths.length - 1]!;
    },
  };
}

type Refusal = { readonly failure: VantaTransportFailure; readonly requestsSent: number };

/** Walk one surface, collecting every refusal the walk reports. */
async function walk({
  tokenProvider,
  transport,
  refusals,
}: {
  tokenProvider: VantaTokenProvider;
  transport: VantaTransport;
  refusals: Refusal[];
}) {
  return singleSurfaceLister({
    endpoint: ENDPOINT,
    onRefusal: ({ failure, requestsSent }) => {
      refusals.push({ failure, requestsSent });
    },
    pageBoundary: PAGE_BOUNDARY,
    providerId: (item) => item.id,
    surface: "things",
    tokenProvider,
    transport,
  })();
}

describe("pageQuery", () => {
  it("asks for the maximum page size, and continues from a cursor when there is one", () => {
    expect(pageQuery({ cursor: null, endpoint: ENDPOINT })).toBe("/v1/things?pageSize=100");
    expect(pageQuery({ cursor: "c1", endpoint: ENDPOINT })).toBe("/v1/things?pageSize=100&pageCursor=c1");
  });
});

describe("singleSurfaceLister", () => {
  it("walks every page, presenting a token for each", async () => {
    const paths: string[] = [];
    const result = await walk({
      refusals: [],
      tokenProvider: tokensInTurn({ answers: [ok("t1"), ok("t2")] }),
      transport: transportInTurn({
        answers: [ok(pageBody({ ids: ["a"], next: "c1" })), ok(pageBody({ ids: ["b"], next: null }))],
        paths,
      }),
    });
    expect(unwrap(result).map((item) => item.id)).toEqual(["a", "b"]);
    expect(paths).toEqual(["/v1/things?pageSize=100", "/v1/things?pageSize=100&pageCursor=c1"]);
  });

  it("refuses a page carrying a field the endpoint does not declare, naming the field and never its value", async () => {
    const drifted: VantaRawResponse = {
      body: JSON.stringify({
        results: {
          data: [{ colour: "provider-value-7f3a", id: "a" }],
          pageInfo: { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null },
        },
      }),
      headers: {},
      status: 200,
    };
    expect(drifted.body).toContain("provider-value-7f3a");
    const result = await walk({
      refusals: [],
      tokenProvider: tokensInTurn({ answers: [ok("t1")] }),
      transport: transportInTurn({ answers: [ok(drifted)], paths: [] }),
    });
    expect(unwrapErr(result).reasons).toEqual([
      "things (GET /v1/things) returned a page this package cannot read:",
      '  new field "results.data[0].colour"',
    ]);
  });

  it("reports a refusal the provider answered, with how many requests went out", async () => {
    const refusals: Refusal[] = [];
    const refused = VantaHttpErrors.httpStatus({ safePath: "/v1/things?pageSize=100&pageCursor=c1", status: 403 });
    const result = await walk({
      refusals,
      tokenProvider: tokensInTurn({ answers: [ok("t1"), ok("t2")] }),
      transport: transportInTurn({ answers: [ok(pageBody({ ids: ["a"], next: "c1" })), err(refused)], paths: [] }),
    });
    expect(refusals).toEqual([{ failure: refused, requestsSent: 2 }]);
    expect(unwrapErr(result).code).toBe("API_SCOPE_REFUSED");
  });

  it("never reports a later page's token failure as the provider's refusal", async () => {
    const refusals: Refusal[] = [];
    const paths: string[] = [];
    const result = await walk({
      refusals,
      tokenProvider: tokensInTurn({ answers: [ok("t1"), err(["the mint lock is held by another process"])] }),
      transport: transportInTurn({ answers: [ok(pageBody({ ids: ["a"], next: "c1" }))], paths }),
    });
    // One request went out, for page one: a caller told of this failure with one request sent would read it
    // as the provider refusing page one.
    expect(paths).toEqual(["/v1/things?pageSize=100"]);
    expect(refusals).toEqual([]);
    expect(unwrapErr(result)).toEqual(
      VantaSurfaceErrors.detailUnreadable({ reasons: ["the mint lock is held by another process"] }),
    );
  });

  it("never reports a first page's token failure, when nothing was asked at all", async () => {
    const refusals: Refusal[] = [];
    const paths: string[] = [];
    const result = await walk({
      refusals,
      tokenProvider: tokensInTurn({ answers: [err(["no credentials"])] }),
      transport: transportInTurn({ answers: [], paths }),
    });
    expect(paths).toEqual([]);
    expect(refusals).toEqual([]);
    expect(unwrapErr(result)).toEqual(VantaSurfaceErrors.detailUnreadable({ reasons: ["no credentials"] }));
  });

  it("redacts every token the walk presented from the lines it returns", async () => {
    const result = await walk({
      refusals: [],
      tokenProvider: tokensInTurn({ answers: [ok("t1-secret"), ok("t2-secret")] }),
      transport: transportInTurn({
        answers: [ok(pageBody({ ids: ["a"], next: "c1" })), err(["page two echoed t1-secret and t2-secret"])],
        paths: [],
      }),
    });
    expect(unwrapErr(result).reasons).toEqual(["page two echoed [REDACTED] and [REDACTED]"]);
  });
});
