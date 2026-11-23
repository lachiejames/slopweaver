import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BoundaryErrors, defineBoundary } from "#lib/boundary.js";
import { unwrapErr } from "#lib/result.js";

import {
  isVantaHttpError,
  VantaHttpErrors,
  vantaHttpErrorLines,
  vantaIssueLines,
  vantaTransportFailureLines,
} from "../../../../atlas/vanta/httpErrors.js";

describe("VantaHttpErrors — transport", () => {
  it("refuses a redirect in two lines, naming only the redacted path", () => {
    const error = VantaHttpErrors.redirectRefused({ safePath: "/v1/controls?pageSize=100", status: 302 });
    expect(error.code).toBe("REDIRECT_REFUSED");
    expect(vantaHttpErrorLines({ error })).toEqual([
      "/v1/controls?pageSize=100 returned an HTTP 302 redirect, which this transport refuses to follow",
      "Vanta's Manage API has no documented redirect behaviour — following one would resend the bearer token to an unverified host",
    ]);
  });

  it("names an unread body, an unreached host and exhausted retries", () => {
    const unread = VantaHttpErrors.bodyUnread({ cause: new Error("aborted"), safePath: "/v1/x" });
    expect(unread.code).toBe("BODY_UNREAD");
    expect(unread.message).toBe("/v1/x returned headers but its body could not be read: aborted");
    const unreachable = VantaHttpErrors.unreachable({
      cause: new Error("ECONNRESET"),
      host: "api.vanta.com",
      safePath: "/v1/x",
    });
    expect(unreachable.code).toBe("UNREACHABLE");
    expect(vantaHttpErrorLines({ error: unreachable })).toEqual([
      "the request to /v1/x never reached api.vanta.com: ECONNRESET",
    ]);
    const exhausted = VantaHttpErrors.retriesExhausted({ safePath: "/v1/x" });
    expect(exhausted.code).toBe("RETRIES_EXHAUSTED");
    expect(exhausted.message).toBe("/v1/x exhausted its retries without producing a result");
  });

  it("prints a refused status exactly as the transport printed it before the status was typed", () => {
    const lines = ({ status }: { status: number }) =>
      vantaHttpErrorLines({ error: VantaHttpErrors.httpStatus({ safePath: "/v1/x", status }) });
    expect(lines({ status: 401 })).toEqual([
      "/v1/x returned HTTP 401",
      "this is an entitlement or credential problem, not a transient fault",
    ]);
    expect(lines({ status: 403 })).toEqual([
      "/v1/x returned HTTP 403",
      "this is an entitlement or credential problem, not a transient fault",
    ]);
    expect(lines({ status: 404 })).toEqual([
      "/v1/x returned HTTP 404",
      "the route is not there — check the endpoint path before concluding the surface is empty",
    ]);
    expect(lines({ status: 429 })).toEqual(["/v1/x was rate limited and the retries were exhausted"]);
    expect(lines({ status: 500 })).toEqual(["/v1/x returned HTTP 500"]);
  });

  it("carries the status as a field, so a decision reads it rather than the sentence", () => {
    const error = VantaHttpErrors.httpStatus({ safePath: "/v1/x", status: 401 });
    expect(error).toEqual({
      code: "HTTP_STATUS",
      message: "/v1/x returned HTTP 401; this is an entitlement or credential problem, not a transient fault",
      reasons: ["/v1/x returned HTTP 401", "this is an entitlement or credential problem, not a transient fault"],
      safePath: "/v1/x",
      status: 401,
    });
  });
});

describe("the transport failure's two arms", () => {
  it("tells the typed arm from the printed-only lines arm by shape, and prints each", () => {
    const typed = VantaHttpErrors.retriesExhausted({ safePath: "/v1/x" });
    const printed = ["vanta POST /v1/x blocked because it names a dead host"];
    expect([isVantaHttpError(typed), isVantaHttpError(printed)]).toEqual([true, false]);
    expect(vantaTransportFailureLines({ error: typed })).toEqual([
      "/v1/x exhausted its retries without producing a result",
    ]);
    expect(vantaTransportFailureLines({ error: printed })).toEqual(printed);
  });

  it("keeps a printed-only array on the lines arm even when it has been given a code", () => {
    const printed = Object.assign(["vanta POST /v1/x blocked because it names a dead host"], {
      code: "HTTP_STATUS",
      status: 403,
    });
    expect(isVantaHttpError(printed)).toBe(false);
  });
});

describe("VantaHttpErrors — pagination", () => {
  it("refuses a duplicate id, a missing cursor, a repeated cursor and a runaway walk", () => {
    const duplicate = VantaHttpErrors.duplicateProviderId({ id: "c1" });
    expect(duplicate.code).toBe("DUPLICATE_PROVIDER_ID");
    expect(duplicate.message).toBe(
      "provider id c1 appeared twice within one surface's read — refusing rather than silently deduplicating",
    );
    const missing = VantaHttpErrors.cursorMissing();
    expect(missing.code).toBe("CURSOR_MISSING");
    expect(missing.message).toBe(
      "hasNextPage is true but the page carried no cursor to continue from — a pagination fault, not a silent stop",
    );
    const repeated = VantaHttpErrors.cursorRepeated({ cursor: "abc" });
    expect(repeated.code).toBe("CURSOR_REPEATED");
    expect(repeated.message).toBe("cursor abc repeated — refusing rather than looping forever");
    const runaway = VantaHttpErrors.pageLimitExceeded({ maxPages: 500 });
    expect(runaway.code).toBe("PAGE_LIMIT_EXCEEDED");
    expect(vantaHttpErrorLines({ error: runaway })).toEqual([
      "exceeded 500 pages without reaching hasNextPage: false — refusing rather than looping forever",
    ]);
  });
});

describe("VantaHttpErrors — client and body parsing", () => {
  it("says a body is not JSON, naming the surface it came from", () => {
    const error = VantaHttpErrors.bodyNotJson({ surface: "the token endpoint" });
    expect(error.code).toBe("BODY_NOT_JSON");
    expect(error.message).toBe("the token endpoint returned a body that is not valid JSON");
  });

  // A boundary over one strict row, so the lines below are what a real drifted page produces.
  const rows = defineBoundary({
    endpoint: "GET /v1/vendors",
    schema: z.strictObject({
      results: z.strictObject({ data: z.array(z.strictObject({ count: z.number(), name: z.string() })) }),
    }),
  });
  const SENTINEL = "provider-value-7f3a";
  const drifted = JSON.stringify({ results: { data: [{ count: SENTINEL, nmae: "Acme" }] } });

  it("prints an unreadable page as its header then one indented line per drifted field, never a value", () => {
    expect(drifted).toContain(SENTINEL);
    const error = VantaHttpErrors.pageUnreadable({
      boundaryError: unwrapErr(rows.parseJson({ text: drifted })),
      surface: "vendors-list",
    });
    expect(error.code).toBe("PAGE_UNREADABLE");
    expect(vantaHttpErrorLines({ error })).toEqual([
      "vendors-list (GET /v1/vendors) returned a page this package cannot read:",
      '  field "results.data[0].name" renamed to "results.data[0].nmae"?',
      '  field "results.data[0].count" changed: Invalid input: expected number, received string',
    ]);
    expect(vantaHttpErrorLines({ error }).join("\n")).not.toContain(SENTINEL);
  });

  it("keeps a page that is not JSON at all as BODY_NOT_JSON, exactly as before it had a boundary", () => {
    const error = VantaHttpErrors.pageUnreadable({
      boundaryError: unwrapErr(rows.parseJson({ text: "<html>" })),
      surface: "vendors-list",
    });
    expect(error).toEqual(VantaHttpErrors.bodyNotJson({ surface: "vendors-list" }));
  });

  it("heads an unreadable object and an unreadable write body with their own words", () => {
    const object = VantaHttpErrors.objectUnreadable({
      boundaryError: BoundaryErrors.shapeChanged({
        drift: [{ detail: 'field "id" is missing', kind: "missing", path: "id" }],
        endpoint: "GET /v1/controls/{controlId}",
      }),
      surface: "control",
    });
    expect(object.code).toBe("OBJECT_UNREADABLE");
    expect(vantaHttpErrorLines({ error: object })).toEqual([
      "control (GET /v1/controls/{controlId}) returned an object this package cannot read:",
      '  field "id" is missing',
    ]);
    const issues = [{ message: "Invalid input", path: ["id"] }];
    const body = VantaHttpErrors.bodyUnreadable({ issues, surface: "the token endpoint" });
    expect(body.code).toBe("BODY_UNREADABLE");
    expect(body.message).toBe("the token endpoint returned a body this package cannot read:;   id: Invalid input");
  });

  it("refuses a bad sample limit and an undeclared surface", () => {
    const limit = VantaHttpErrors.sampleLimitInvalid({ limit: 11 });
    expect(limit.code).toBe("SAMPLE_LIMIT_INVALID");
    expect(limit.message).toBe("test entity sample limit must be an integer from 1 to 10");
    const family = VantaHttpErrors.notCensusFamily({ surface: "widgets" });
    expect(family.code).toBe("NOT_CENSUS_FAMILY");
    expect(family.message).toBe("widgets is not a census family declared in census.ts");
    expect(vantaHttpErrorLines({ error: family })).toEqual(["widgets is not a census family declared in census.ts"]);
    expect(vantaHttpErrorLines({ error: limit })).toEqual(["test entity sample limit must be an integer from 1 to 10"]);
    const child = VantaHttpErrors.notChildSurface({ surface: "widgets" });
    expect(child.code).toBe("NOT_CHILD_SURFACE");
    expect(child.message).toBe("widgets is not a child surface declared in childCensus.ts");
  });
});

describe("vantaIssueLines", () => {
  it("indents each issue under its dotted path, in order", () => {
    expect(
      vantaIssueLines({
        issues: [
          { message: "Required", path: ["a", 0] },
          { message: "Expected string", path: [] },
        ],
      }),
    ).toEqual(["  a.0: Required", "  : Expected string"]);
  });
});
