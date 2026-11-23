import { describe, expect, it } from "vitest";

import type { VantaTokenProvider } from "../../../../atlas/vanta/oauth.js";
import type { VantaRawResponse, VantaTransport } from "../../../../atlas/vanta/transport.js";
import {
  createVantaManageWriteClient,
  documentSubmitPath,
  documentsPath,
  documentUploadsPath,
} from "../../../../atlas/vanta/writeClient.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const tokenProvider: VantaTokenProvider = { getToken: async () => ok("tok") };

const documentDto = {
  category: "IT" as const,
  description: "d",
  id: "doc-1",
  isSensitive: false,
  ownerId: null,
  title: "t",
  uploadStatus: "OK" as const,
  uploadStatusDate: null,
  url: null,
};

describe("path builders", () => {
  it("build the exact endpoints this client calls", () => {
    expect(documentsPath()).toBe("/v1/documents");
    expect(documentUploadsPath({ documentId: "d1" })).toBe("/v1/documents/d1/uploads");
    expect(documentSubmitPath({ documentId: "d1" })).toBe("/v1/documents/d1/submit");
  });
});

describe("createVantaManageWriteClient", () => {
  it("createDocument posts a JSON body and returns the parsed document", async () => {
    let sentBody = "";
    const transport: VantaTransport = {
      request: async (init) => {
        sentBody = typeof init.body === "string" ? init.body : "";
        return ok({ body: JSON.stringify(documentDto), headers: {}, status: 200 } satisfies VantaRawResponse);
      },
    };
    const client = createVantaManageWriteClient({ tokenProvider, transport });
    const result = await client.createDocument({
      cadence: "P1Y",
      description: "d",
      isSensitive: false,
      reminderWindow: "P1M",
      timeSensitivity: "MOST_RECENT",
      title: "t",
    });
    expect(unwrap(result).id).toBe("doc-1");
    expect(JSON.parse(sentBody).title).toBe("t");
  });

  it("submitDocument returns null on a bodiless success", async () => {
    const transport: VantaTransport = { request: async () => ok({ body: "", headers: {}, status: 200 }) };
    const client = createVantaManageWriteClient({ tokenProvider, transport });
    expect(unwrap(await client.submitDocument({ documentId: "d1" }))).toBeNull();
  });

  it("deleteDocument propagates a failed request", async () => {
    const transport: VantaTransport = { request: async () => err(["HTTP 404"]) };
    const client = createVantaManageWriteClient({ tokenProvider, transport });
    const result = await client.deleteDocument({ documentId: "d1" });
    expect(unwrapErr(result)).toEqual(["HTTP 404"]);
  });

  it("uploadEvidence sends a multipart body with no content-type header set", async () => {
    let sawContentType = true;
    const transport: VantaTransport = {
      request: async (init) => {
        sawContentType = "content-type" in init.headers;
        return ok({
          body: JSON.stringify({
            creationDate: "2026-01-01T00:00:00.000Z",
            deletionDate: null,
            description: null,
            effectiveDate: null,
            fileName: "f",
            id: "u1",
            mimeType: "text/plain",
            title: "t",
            updatedDate: "2026-01-01T00:00:00.000Z",
            uploadedBy: null,
            url: "https://x",
          }),
          headers: {},
          status: 200,
        });
      },
    };
    const client = createVantaManageWriteClient({ tokenProvider, transport });
    const result = await client.uploadEvidence({
      description: null,
      documentId: "d1",
      effectiveAtDate: null,
      file: { content: new Uint8Array([1, 2, 3]), mimeType: "text/plain", name: "f.txt" },
    });
    expect(unwrap(result).id).toBe("u1");
    expect(sawContentType).toBe(false);
  });
});
