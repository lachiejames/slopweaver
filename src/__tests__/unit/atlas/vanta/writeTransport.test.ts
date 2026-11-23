/**
 * The two mechanics every Vanta write shares, over a plain recording token provider and transport: a token
 * that cannot be had sends nothing; a write carries the bearer token beside the caller's headers, its body
 * only when it has one and its retry policy only when one was named; a refused write has EVERY occurrence of
 * the token redacted and, on a 401, the one-token-per-app note appended; and a write's body parses through
 * its endpoint's strict boundary, a non-JSON body and a drifted field each refused in the Vanta HTTP error's
 * own words.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  VantaHttpErrors,
  type VantaTransportFailure,
  vantaHttpErrorLines,
} from "../../../../atlas/vanta/httpErrors.js";
import { VANTA_ONE_TOKEN_PER_APP_NOTE, type VantaTokenProvider } from "../../../../atlas/vanta/oauth.js";
import type { VantaRawResponse, VantaRequestInit, VantaTransport } from "../../../../atlas/vanta/transport.js";
import { parseVantaWriteBody, performVantaWrite } from "../../../../atlas/vanta/writeTransport.js";
import { defineBoundary } from "../../../../lib/boundary.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

const RESPONSE: VantaRawResponse = {
  body: '{"id":"doc-1"}',
  headers: { "content-type": "application/json" },
  status: 200,
};

/** A token provider answering one fixed result, counting each ask. */
function tokenProvider({ asks, token }: { asks: string[]; token: Result<string> }): VantaTokenProvider {
  return {
    getToken: async () => {
      asks.push("getToken");
      return token;
    },
  };
}

/** A transport answering one fixed result, recording every request it was handed. */
function transport({
  sent,
  answer,
}: {
  sent: VantaRequestInit[];
  answer: Result<VantaRawResponse, VantaTransportFailure>;
}): VantaTransport {
  return {
    request: async (init) => {
      sent.push(init);
      return answer;
    },
  };
}

describe("performVantaWrite", () => {
  it("sends nothing when no token can be had, answering the token's own reasons", async () => {
    const asks: string[] = [];
    const sent: VantaRequestInit[] = [];

    const result = await performVantaWrite({
      body: "{}",
      headers: {},
      method: "POST",
      path: "/v1/documents",
      tokenProvider: tokenProvider({ asks, token: err(["no Vanta credentials stored"]) }),
      transport: transport({ answer: ok(RESPONSE), sent }),
    });

    expect(unwrapErr(result)).toEqual(["no Vanta credentials stored"]);
    expect(asks).toEqual(["getToken"]);
    expect(sent).toEqual([]);
  });

  it("sends the body, the bearer token beside the caller's headers and a named retry policy", async () => {
    const asks: string[] = [];
    const sent: VantaRequestInit[] = [];

    const result = await performVantaWrite({
      body: '{"title":"Policy"}',
      headers: { "content-type": "application/json" },
      method: "POST",
      path: "/v1/documents",
      retryPolicy: "never",
      tokenProvider: tokenProvider({ asks, token: ok("tok-123") }),
      transport: transport({ answer: ok(RESPONSE), sent }),
    });

    expect(unwrap(result)).toEqual({
      body: '{"id":"doc-1"}',
      headers: { "content-type": "application/json" },
      status: 200,
    });
    expect(sent).toStrictEqual([
      {
        body: '{"title":"Policy"}',
        headers: { authorization: "Bearer tok-123", "content-type": "application/json" },
        method: "POST",
        path: "/v1/documents",
        retryPolicy: "never",
      },
    ]);
  });

  it("sends no body and no retry policy keys for a bodiless write that named none", async () => {
    const sent: VantaRequestInit[] = [];

    await performVantaWrite({
      body: undefined,
      headers: {},
      method: "DELETE",
      path: "/v1/documents/doc-1",
      tokenProvider: tokenProvider({ asks: [], token: ok("tok-123") }),
      transport: transport({ answer: ok(RESPONSE), sent }),
    });

    expect(sent).toStrictEqual([
      { headers: { authorization: "Bearer tok-123" }, method: "DELETE", path: "/v1/documents/doc-1" },
    ]);
  });

  it("redacts every occurrence of the token from a refused write and appends the one-token note on a 401", async () => {
    const result = await performVantaWrite({
      body: undefined,
      headers: {},
      method: "DELETE",
      path: "/v1/documents/doc-1",
      tokenProvider: tokenProvider({ asks: [], token: ok("tok-123") }),
      // A typed 401 whose lines carry the token: the note is chosen from the status, the redaction from the lines.
      transport: transport({
        answer: err({
          ...VantaHttpErrors.httpStatus({ safePath: "/v1/documents/doc-1", status: 401 }),
          reasons: ["HTTP 401 for Bearer tok-123", "tok-123 rejected; tok-123 expired"],
        }),
        sent: [],
      }),
    });

    const lines = unwrapErr(result);

    expect(lines).toEqual([
      "HTTP 401 for Bearer [REDACTED]",
      "[REDACTED] rejected; [REDACTED] expired",
      VANTA_ONE_TOKEN_PER_APP_NOTE,
    ]);
    expect(lines[2]).toContain("Vanta allows exactly one active access token per Manage application");
  });

  it("redacts the token from a refusal that is not a 401 without appending the note", async () => {
    const result = await performVantaWrite({
      body: "{}",
      headers: {},
      method: "POST",
      path: "/v1/documents",
      tokenProvider: tokenProvider({ asks: [], token: ok("tok-123") }),
      transport: transport({ answer: err(["HTTP 500 while using tok-123"]), sent: [] }),
    });

    expect(unwrapErr(result)).toEqual(["HTTP 500 while using [REDACTED]"]);
  });
});

describe("parseVantaWriteBody", () => {
  const boundary = defineBoundary({
    endpoint: "POST /v1/documents/{documentId}/uploads",
    schema: z.strictObject({ id: z.string(), uploaded: z.boolean() }),
  });

  it("answers the whole parsed body when it satisfies the boundary", () => {
    expect(
      unwrap(parseVantaWriteBody({ body: '{"id":"doc-1","uploaded":true}', boundary, surface: "documents upload" })),
    ).toEqual({ id: "doc-1", uploaded: true });
  });

  it("refuses a body that is not JSON, saying so for the surface", () => {
    const lines = unwrapErr(parseVantaWriteBody({ body: "<html>", boundary, surface: "documents upload" }));

    expect(lines).toEqual(["documents upload returned a body that is not valid JSON"]);
    expect(lines).toEqual(vantaHttpErrorLines({ error: VantaHttpErrors.bodyNotJson({ surface: "documents upload" }) }));
  });

  it("refuses a retyped field, naming the surface, the endpoint and the field", () => {
    const lines = unwrapErr(
      parseVantaWriteBody({ body: '{"id":7,"uploaded":true}', boundary, surface: "documents upload" }),
    );

    expect(lines).toEqual([
      "documents upload (POST /v1/documents/{documentId}/uploads) returned a body this package cannot read:",
      '  field "id" changed: Invalid input: expected string, received number',
    ]);
  });

  it("refuses a field the endpoint does not declare, naming it rather than dropping it", () => {
    const lines = unwrapErr(
      parseVantaWriteBody({
        body: '{"id":"doc-1","uploaded":true,"addedByVantaLater":1}',
        boundary,
        surface: "documents upload",
      }),
    );

    expect(lines).toEqual([
      "documents upload (POST /v1/documents/{documentId}/uploads) returned a body this package cannot read:",
      '  new field "addedByVantaLater"',
    ]);
  });
});
