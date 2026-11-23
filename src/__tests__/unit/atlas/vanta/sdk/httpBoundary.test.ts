import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { VantaTokenProvider } from "../../../../../atlas/vanta/oauth.js";
import { VantaSdkErrors } from "../../../../../atlas/vanta/sdk/errors.js";
import { performVantaSdkRequest, requestJson, requestNoContent } from "../../../../../atlas/vanta/sdk/httpBoundary.js";
import type { VantaTransport } from "../../../../../atlas/vanta/transport.js";
import { BoundaryErrors, defineBoundary } from "../../../../../lib/boundary.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";

const tokenProvider: VantaTokenProvider = { getToken: async () => ok("tok") };
const ENDPOINT = "GET /v1/controls/{controlId}";
const boundary = defineBoundary({ endpoint: ENDPOINT, schema: z.strictObject({ id: z.string() }) });

describe("performVantaSdkRequest", () => {
  it("resolves the raw response on success", async () => {
    const transport: VantaTransport = { request: async () => ok({ body: '{"id":"c1"}', headers: {}, status: 200 }) };
    const result = await performVantaSdkRequest({
      body: undefined,
      headers: {},
      method: "GET",
      operationId: "GetControl",
      path: "/v1/controls/c1",
      tokenProvider,
      transport,
    });
    expect(unwrap(result).body).toBe('{"id":"c1"}');
  });

  it("wraps a token failure as a VANTA_SDK_API_ERROR", async () => {
    const failing: VantaTokenProvider = { getToken: async () => err(["no token"]) };
    const transport: VantaTransport = { request: async () => ok({ body: "{}", headers: {}, status: 200 }) };
    const result = await performVantaSdkRequest({
      body: undefined,
      headers: {},
      method: "GET",
      operationId: "GetControl",
      path: "/v1/controls/c1",
      tokenProvider: failing,
      transport,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("VANTA_SDK_API_ERROR");
  });
});

describe("requestJson", () => {
  /** One GetControl read of `body` through {@link boundary}. */
  const getControl = async ({ body }: { body: string }) =>
    requestJson({
      boundary,
      method: "GET",
      operationId: "GetControl",
      path: "/v1/controls/c1",
      tokenProvider,
      transport: { request: async () => ok({ body, headers: {}, status: 200 }) },
    });

  it("parses a valid body through the endpoint's boundary", async () => {
    expect(unwrap(await getControl({ body: '{"id":"c1"}' }))).toEqual({ id: "c1" });
  });

  it("refuses a body that is not valid JSON, carrying the boundary's own refusal", async () => {
    const refusal = unwrapErr(await getControl({ body: "not json" }));
    expect(refusal).toEqual(
      VantaSdkErrors.responseValidationError({
        boundaryError: BoundaryErrors.notJson({ endpoint: ENDPOINT }),
        method: "GET",
        operationId: "GetControl",
        path: "/v1/controls/c1",
      }),
    );
    expect(refusal.message).toBe("GET /v1/controls/{controlId} answered a body that is not JSON");
  });

  it("refuses a body missing a declared field, naming the field", async () => {
    const refusal = unwrapErr(await getControl({ body: "{}" }));
    expect(refusal).toEqual(
      VantaSdkErrors.responseValidationError({
        boundaryError: BoundaryErrors.shapeChanged({
          drift: [{ detail: 'field "id" is missing', kind: "missing", path: "id" }],
          endpoint: ENDPOINT,
        }),
        method: "GET",
        operationId: "GetControl",
        path: "/v1/controls/c1",
      }),
    );
    expect(refusal.message).toBe(
      'GET /v1/controls/{controlId} answered a shape this version does not read — refused, not guessed: field "id" is missing',
    );
  });

  it("refuses a field Vanta added rather than dropping it, naming the field", async () => {
    expect(unwrapErr(await getControl({ body: '{"id":"c1","addedByVantaLater":true}' }))).toEqual(
      VantaSdkErrors.responseValidationError({
        boundaryError: BoundaryErrors.shapeChanged({
          drift: [{ detail: 'new field "addedByVantaLater"', kind: "new", path: "addedByVantaLater" }],
          endpoint: ENDPOINT,
        }),
        method: "GET",
        operationId: "GetControl",
        path: "/v1/controls/c1",
      }),
    );
  });
});

describe("requestNoContent", () => {
  it("resolves null on success", async () => {
    const transport: VantaTransport = { request: async () => ok({ body: "", headers: {}, status: 200 }) };
    const result = await requestNoContent({
      method: "DELETE",
      operationId: "DeleteControl",
      path: "/v1/controls/c1",
      tokenProvider,
      transport,
    });
    expect(unwrap(result)).toBeNull();
  });
});
