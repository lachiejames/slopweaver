import { describe, expect, it } from "vitest";

import type { VantaTokenProvider } from "../../../../../../atlas/vanta/oauth.js";
import { VantaSdkErrors } from "../../../../../../atlas/vanta/sdk/errors.js";
import { createDocumentsOperations } from "../../../../../../atlas/vanta/sdk/operations/documents.js";
import type { VantaTransport } from "../../../../../../atlas/vanta/transport.js";
import { BoundaryErrors } from "../../../../../../lib/boundary.js";
import { ok, unwrap, unwrapErr } from "../../../../../../lib/result.js";

const tokenProvider: VantaTokenProvider = { getToken: async () => ok("tok") };

const documentDetail = {
  category: "IT",
  deactivatedStatus: { creationDate: "2026-01-01T00:00:00.000Z", expiration: null, isDeactivated: false, reason: null },
  description: "d",
  id: "d1",
  isSensitive: false,
  nextRenewalDate: null,
  note: null,
  ownerId: null,
  reminderWindow: null,
  renewalCadence: "P1Y",
  subscribers: [],
  title: "t",
  uploadStatus: "OK",
  uploadStatusDate: null,
  url: null,
};

describe("createDocumentsOperations", () => {
  it("getDocument reads the single-document endpoint", async () => {
    let seenPath = "";
    const transport: VantaTransport = {
      request: async (init) => {
        seenPath = init.path;
        return ok({ body: JSON.stringify(documentDetail), headers: {}, status: 200 });
      },
    };
    const operations = createDocumentsOperations({ tokenProvider, transport });
    const result = await operations.getDocument({ documentId: "d1" });
    expect(unwrap(result).id).toBe("d1");
    expect(seenPath).toBe("/v1/documents/d1");
  });

  // The detail was the one loose read in the layer: a plain object dropped any key Vanta added. Now it is refused
  // by name, so an upstream change is a one-line schema edit rather than a silent misread.
  it("getDocument refuses a field Vanta added, naming it and the endpoint template", async () => {
    const transport: VantaTransport = {
      request: async () =>
        ok({ body: JSON.stringify({ ...documentDetail, addedByVantaLater: true }), headers: {}, status: 200 }),
    };
    const operations = createDocumentsOperations({ tokenProvider, transport });
    expect(unwrapErr(await operations.getDocument({ documentId: "d1" }))).toEqual(
      VantaSdkErrors.responseValidationError({
        boundaryError: BoundaryErrors.shapeChanged({
          drift: [{ detail: 'new field "addedByVantaLater"', kind: "new", path: "addedByVantaLater" }],
          endpoint: "GET /v1/documents/{documentId}",
        }),
        method: "GET",
        operationId: "GetDocument",
        path: "/v1/documents/d1",
      }),
    );
  });

  it("setOwnerForDocument posts the userId as JSON", async () => {
    let sentBody = "";
    const transport: VantaTransport = {
      request: async (init) => {
        sentBody = typeof init.body === "string" ? init.body : "";
        return ok({
          body: JSON.stringify({
            category: "IT",
            description: "d",
            id: "d1",
            isSensitive: false,
            ownerId: "u1",
            title: "t",
            uploadStatus: "OK",
            uploadStatusDate: null,
            url: null,
          }),
          headers: {},
          status: 200,
        });
      },
    };
    const operations = createDocumentsOperations({ tokenProvider, transport });
    const result = await operations.setOwnerForDocument({ documentId: "d1", userId: "u1" });
    expect(unwrap(result).ownerId).toBe("u1");
    expect(JSON.parse(sentBody)).toEqual({ userId: "u1" });
  });

  it("deleteLinkForDocument issues a DELETE to the single-link endpoint", async () => {
    let seenPath = "";
    const transport: VantaTransport = {
      request: async (init) => {
        seenPath = init.path;
        return ok({ body: "", headers: {}, status: 200 });
      },
    };
    const operations = createDocumentsOperations({ tokenProvider, transport });
    await operations.deleteLinkForDocument({ documentId: "d1", linkId: "l1" });
    expect(seenPath).toBe("/v1/documents/d1/links/l1");
  });
});
