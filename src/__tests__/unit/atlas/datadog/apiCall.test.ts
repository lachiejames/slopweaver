import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  callDatadogApiOperation,
  DATADOG_API_PAGE_SIZE,
  datadogApiBoundFor,
  datadogApiErrorFor,
  datadogApiRequestPath,
} from "../../../../atlas/datadog/apiCall.js";
import {
  type DatadogBoundarySource,
  type DatadogResponseBoundary,
  defineDatadogResponseBoundary,
} from "../../../../atlas/datadog/responseBoundary.js";
import type { DatadogSurfaceRow } from "../../../../atlas/datadog/surfaceRow.js";
import { type RawTransport, rawTransportFrom } from "../../../../datadog/rawTransport.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

/** A registry row, with every field the caller reads spelled and the rest defaulted. */
function row(over: Partial<DatadogSurfaceRow> = {}): DatadogSurfaceRow {
  return {
    deprecated: false,
    disposition: "entity",
    dispositionBecause: null,
    exclusionReason: null,
    kind: "monitor",
    method: "GET",
    name: "v1-monitors-list-monitors",
    operationKey: "v1.MonitorsApi.listMonitors",
    paging: "none",
    path: "/api/v1/monitor",
    spec: "v1",
    unstable: false,
    ...over,
  };
}

/** A transport answering one fixed text, recording exactly what was asked of it. */
function answeringText({ text, status = 200 }: { text: string; status?: number }): {
  transport: RawTransport;
  calls: { method: string; path: string }[];
} {
  const calls: { method: string; path: string }[] = [];
  const transport = rawTransportFrom({
    lastRateLimit: () => null,
    requestRawTextWithStatus: (input) => {
      calls.push({ method: input.method, path: input.path });
      return Promise.resolve(ok({ bodyText: text, rateLimit: null, status }));
    },
  });
  return { calls, transport };
}

/** A transport answering one fixed body as the JSON text Datadog would send. */
function answering({ body }: { body: unknown }): ReturnType<typeof answeringText> {
  return answeringText({ text: JSON.stringify(body) });
}

/** A registry of one small strict boundary for the named operation: a plain fake, never a mock. */
function boundariesFor({
  surface = "v1-monitors-list-monitors",
  source = "measured",
  schema = z.array(z.strictObject({ id: z.number(), name: z.string() })),
}: {
  surface?: string;
  source?: DatadogBoundarySource;
  schema?: z.ZodType;
} = {}): ReadonlyMap<string, DatadogResponseBoundary> {
  return new Map([[surface, defineDatadogResponseBoundary({ schema, source, surface })]]);
}

/** A transport that refuses with one status, so each branch of the classifier is reachable. */
function refusing({
  status,
  resetSeconds = null,
}: {
  status: number | null;
  resetSeconds?: number | null;
}): RawTransport {
  return rawTransportFrom({
    lastRateLimit: () => null,
    requestRawTextWithStatus: () =>
      Promise.resolve(
        err({
          rateLimit:
            resetSeconds === null ? null : { limit: 1000, name: null, period: 3600, remaining: 0, resetSeconds },
          reasons: [`the endpoint answered ${String(status)}`],
          status,
        }),
      ),
  });
}

describe("datadogApiBoundFor", () => {
  it("calls an unpaged operation whole", () => {
    expect(datadogApiBoundFor({ row: row({ paging: "none" }) })).toBe("whole");
  });

  it("calls a size-capped operation capped, because a cap is not a walk", () => {
    expect(datadogApiBoundFor({ row: row({ paging: "limit-only" }) })).toBe("capped");
  });

  it("calls every genuine walk a first page", () => {
    expect(datadogApiBoundFor({ row: row({ paging: "cursor" }) })).toBe("first-page");
    expect(datadogApiBoundFor({ row: row({ paging: "offset" }) })).toBe("first-page");
    expect(datadogApiBoundFor({ row: row({ paging: "page-number" }) })).toBe("first-page");
  });
});

describe("datadogApiRequestPath", () => {
  it("sends the path unchanged when the operation declares no size parameter", () => {
    // A surface absent from the paging table declares neither parameter, which is what an operation that
    // does not page looks like.
    expect(datadogApiRequestPath({ row: row({ name: "v1-hosts-get-host-totals" }) })).toBe("/api/v1/monitor");
  });

  it("appends the operation's OWN size parameter, as the SDK spells it", () => {
    // `v2-audit-list-audit-logs` declares `page[limit]`, which the table carries and the path must escape.
    const path = datadogApiRequestPath({ row: row({ name: "v2-audit-list-audit-logs" }) });
    expect(path).toBe(`/api/v1/monitor?page%5Blimit%5D=${String(DATADOG_API_PAGE_SIZE)}`);
  });
});

describe("datadogApiErrorFor — the status decides, never the prose", () => {
  it("reads 401 as a credential this site does not accept", () => {
    const error = datadogApiErrorFor({
      failure: { rateLimit: null, reasons: ["HTTP 401"], status: 401 },
      surface: "s",
    });
    expect(error.code).toBe("UNAUTHORISED");
  });

  it("reads 403 as a permission boundary rather than a broken key", () => {
    const error = datadogApiErrorFor({
      failure: { rateLimit: null, reasons: ["HTTP 403"], status: 403 },
      surface: "s",
    });
    expect(error.code).toBe("FORBIDDEN");
    expect(error.message).toContain("permission boundary");
  });

  it("carries Datadog's own reset seconds onto a 429", () => {
    const error = datadogApiErrorFor({
      failure: {
        rateLimit: { limit: 1000, name: null, period: 3600, remaining: 0, resetSeconds: 42 },
        reasons: ["HTTP 429"],
        status: 429,
      },
      surface: "s",
    });
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.message).toContain("42s");
  });

  it("reads a request that never reached Datadog as a transport failure", () => {
    const error = datadogApiErrorFor({
      failure: { rateLimit: null, reasons: ["connect ECONNREFUSED"], status: null },
      surface: "s",
    });
    expect(error.code).toBe("TRANSPORT_FAILED");
  });

  it("reads a v2 missing-parameter 400 as a request this pass cannot build, naming the parameter", () => {
    const error = datadogApiErrorFor({
      failure: {
        rateLimit: null,
        reasons: [
          '/api/v2/annotation returned HTTP 400: {"errors":[{"detail":"missing parameter \\"page_id\\" in \\"query\\""}]}',
        ],
        status: 400,
      },
      surface: "s",
    });
    expect(error.code).toBe("MISSING_PARAMETER");
    expect(error.message).toContain("`page_id`");
    expect(error.message).toContain("NOT an empty product");
  });

  it("reads the other spelling Datadog uses for the same thing", () => {
    const error = datadogApiErrorFor({
      failure: {
        rateLimit: null,
        reasons: ["HTTP 400: missing required query param 'user_handle'"],
        status: 400,
      },
      surface: "s",
    });
    expect(error.code).toBe("MISSING_PARAMETER");
    expect(error.message).toContain("`user_handle`");
  });

  it("keeps a 400 that is NOT about a missing parameter out of that class", () => {
    const error = datadogApiErrorFor({
      failure: { rateLimit: null, reasons: ['HTTP 400: {"detail":"unknown facet: \\"\\""}'], status: 400 },
      surface: "s",
    });
    expect(error.code).toBe("TRANSPORT_FAILED");
  });

  it("reads a 501 as a bound of the SITE rather than of this organisation's data", () => {
    const error = datadogApiErrorFor({
      failure: { rateLimit: null, reasons: ["HTTP 501"], status: 501 },
      surface: "s",
    });
    expect(error.code).toBe("NOT_IMPLEMENTED");
    expect(error.message).toContain("No permission grant changes that");
  });

  it("reads a 404 as a transport failure rather than as an empty product", () => {
    const error = datadogApiErrorFor({
      failure: { rateLimit: null, reasons: ["HTTP 404"], status: 404 },
      surface: "s",
    });
    expect(error.code).toBe("TRANSPORT_FAILED");
  });
});

describe("callDatadogApiOperation", () => {
  it("keeps the admitted body verbatim and states what bounds it and where its boundary came from", async () => {
    const { transport } = answering({ body: [{ id: 1, name: "a monitor" }] });
    const observed = unwrap(await callDatadogApiOperation({ boundaries: boundariesFor(), row: row(), transport }));
    expect(observed).toEqual({
      bodies: [[{ id: 1, name: "a monitor" }]],
      bound: "whole",
      boundarySource: "measured",
      pagingParameter: "id_offset",
      status: 200,
    });
  });

  it("carries a names-only boundary's source onto the observation, so coverage can say it is owed", async () => {
    const { transport } = answering({ body: [{ id: 1, name: "a monitor" }] });
    const boundaries = boundariesFor({ source: "spec-names-only" });
    const observed = unwrap(await callDatadogApiOperation({ boundaries, row: row(), transport }));
    expect(observed.boundarySource).toBe("spec-names-only");
  });

  it("refuses a field Datadog added as a changed body shape, naming the field and never keeping the body", async () => {
    const { transport } = answering({ body: [{ id: 1, name: "a monitor", owner: "sentinel-value-9f3c" }] });
    const error = unwrapErr(await callDatadogApiOperation({ boundaries: boundariesFor(), row: row(), transport }));
    expect(error.code).toBe("BODY_SHAPE_CHANGED");
    expect(error.message).toContain("owner");
    expect(error.message).not.toContain("sentinel-value-9f3c");
  });

  it("carries the paging parameter a follow-on walk will have to send", async () => {
    const { transport } = answering({ body: { data: [] } });
    const surface = "v2-audit-list-audit-logs";
    const boundaries = boundariesFor({
      schema: z.strictObject({ data: z.array(z.strictObject({ id: z.string() })) }),
      surface,
    });
    const observed = unwrap(
      await callDatadogApiOperation({ boundaries, row: row({ name: surface, paging: "cursor" }), transport }),
    );
    expect(observed.bound).toBe("first-page");
    expect(observed.pagingParameter).toBe("page[cursor]");
  });

  it("refuses an operation the specification declares as a file unread, even when its bytes are JSON and a boundary would admit them", async () => {
    const surface = "v2-csmthreats-download-csmthreats-policy";
    const { transport } = answering({ body: { looks: "like json" } });
    const error = unwrapErr(
      await callDatadogApiOperation({
        boundaries: boundariesFor({ schema: z.strictObject({ looks: z.string() }), surface }),
        row: row({ name: surface, path: "/api/v2/remote_config/products/cws/policy/download" }),
        transport,
      }),
    );
    expect(error.code).toBe("UNEXPECTED_SHAPE");
    expect(error.message).toBe(
      "v2-csmthreats-download-csmthreats-policy answered with a shape this surface does not admit: /api/v2/remote_config/products/cws/policy/download answered HTTP 200, and the specification declares a file (application/zip), which this pass does not read",
    );
  });

  it("refuses an operation no boundary is declared for, rather than keeping what it answered", async () => {
    const { transport } = answering({ body: [] });
    const error = unwrapErr(await callDatadogApiOperation({ boundaries: new Map(), row: row(), transport }));
    expect(error.code).toBe("UNEXPECTED_SHAPE");
    expect(error.message).toBe(
      "v1-monitors-list-monitors answered with a shape this surface does not admit: /api/v1/monitor?page_size=100 answered HTTP 200, and no response boundary is declared for it, so nothing it answers is admitted",
    );
  });

  it("refuses a boundary keyed to this operation that declares another, even when that other one admits the body", async () => {
    const { transport } = answering({ body: [{ foreign: true }] });
    const foreign = defineDatadogResponseBoundary({
      schema: z.array(z.strictObject({ foreign: z.boolean() })),
      source: "measured",
      surface: "different-operation",
    });
    const boundaries = new Map([["v1-monitors-list-monitors", foreign]]);
    const error = unwrapErr(await callDatadogApiOperation({ boundaries, row: row(), transport }));
    expect(error.code).toBe("UNEXPECTED_SHAPE");
    expect(error.message).toBe(
      "v1-monitors-list-monitors answered with a shape this surface does not admit: /api/v1/monitor?page_size=100 answered HTTP 200, and the boundary keyed to it declares `different-operation` instead, so nothing it answers is admitted",
    );
  });

  it("reads through the generated registry by default, which refuses a key the specification never declared", async () => {
    const totals = row({ name: "v1-hosts-get-host-totals", path: "/api/v1/hosts/totals" });
    const admitted = unwrap(
      await callDatadogApiOperation({
        row: totals,
        transport: answering({ body: { total_active: 3, total_up: 4 } }).transport,
      }),
    );
    expect(admitted.bodies).toEqual([{ total_active: 3, total_up: 4 }]);
    expect(admitted.boundarySource).toBe("measured");
    const refused = unwrapErr(
      await callDatadogApiOperation({ row: totals, transport: answering({ body: { total_down: 1 } }).transport }),
    );
    expect(refused.code).toBe("BODY_SHAPE_CHANGED");
    expect(refused.message).toContain("total_down");
  });

  it("issues the row's own method and path", async () => {
    const { calls, transport } = answering({ body: {} });
    // An operation absent from the paging table, so the path is issued exactly as the registry holds it.
    await callDatadogApiOperation({
      row: row({ name: "v1-hosts-get-host-totals", path: "/api/v2/teams" }),
      transport,
    });
    expect(calls).toEqual([{ method: "GET", path: "/api/v2/teams" }]);
  });

  it("reads a 2xx body that is not JSON as a SHAPE problem, never as an empty answer, without echoing it", async () => {
    const { transport } = answeringText({ text: "<html>sentinel-value-9f3c</html>" });
    const error = unwrapErr(await callDatadogApiOperation({ row: row(), transport }));
    expect(error.code).toBe("UNEXPECTED_SHAPE");
    expect(error.message).toBe(
      "v1-monitors-list-monitors answered with a shape this surface does not admit: /api/v1/monitor?page_size=100 answered HTTP 200 with a body that is not JSON",
    );
    expect(error.message).not.toContain("sentinel-value-9f3c");
  });

  it("turns a refusal into the typed error rather than into an empty answer", async () => {
    const error = unwrapErr(await callDatadogApiOperation({ row: row(), transport: refusing({ status: 403 }) }));
    expect(error.code).toBe("FORBIDDEN");
    expect(error.surface).toBe("v1-monitors-list-monitors");
  });

  it("refuses a mutating method the registry should never have admitted, rather than issuing it", async () => {
    const { calls, transport } = answering({ body: {} });
    const error = unwrapErr(await callDatadogApiOperation({ row: row({ method: "DELETE" }), transport }));
    expect(error.code).toBe("SURFACE_REFUSED");
    expect(calls).toEqual([]);
  });
});
