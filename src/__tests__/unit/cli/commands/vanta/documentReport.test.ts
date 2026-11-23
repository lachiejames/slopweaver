import { describe, expect, it } from "vitest";

import { vantaDocumentDigest } from "../../../../../atlas/vanta/documentApproval.js";
import { resolveVantaWriteRequest } from "../../../../../atlas/vanta/writePreview.js";
import { renderVantaDocumentDryRun, renderVantaWriteResult } from "../../../../../cli/commands/vanta/documentReport.js";

describe("renderVantaDocumentDryRun", () => {
  const request = resolveVantaWriteRequest({ input: { documentId: "d1" }, kind: "submit-document" });

  it("prints the bytes that would be sent, and the digest that approves exactly them", () => {
    const digest = vantaDocumentDigest({ request });

    expect(renderVantaDocumentDryRun({ digest, request, verb: "submit-document" })).toEqual([
      "write vanta submit-document --dry-run: this request would be sent, nothing was",
      "",
      "POST /v1/documents/d1/submit",
      "  authorization: Bearer <token>",
      "",
      `to send exactly this request: --approve ${digest}`,
      "  the digest covers the method, the path and every byte of the body above; change any of them and it stops matching",
    ]);
  });

  // A JSON body is a third branch of the renderer, and neither of the other two cases reaches it:
  // submit-document sends no body at all and an upload sends multipart. Deleting the JSON branch used to
  // leave every case in this file green, which makes "prints the bytes that would be sent" a claim about
  // one request shape rather than about the report.
  it("prints a JSON body verbatim, because the digest covers those exact bytes", () => {
    const create = resolveVantaWriteRequest({
      input: {
        cadence: "P1Y",
        description: "quarterly access review evidence",
        isSensitive: false,
        reminderWindow: "P1M",
        timeSensitivity: "MOST_RECENT",
        title: "Access review",
      },
      kind: "create-document",
    });

    expect(renderVantaDocumentDryRun({ digest: "d", request: create, verb: "create-document" })).toEqual([
      "write vanta create-document --dry-run: this request would be sent, nothing was",
      "",
      "POST /v1/documents",
      "  authorization: Bearer <token>",
      "  content-type: application/json",
      "",
      '{\n  "cadence": "P1Y",\n  "description": "quarterly access review evidence",\n  "isSensitive": false,\n  "reminderWindow": "P1M",\n  "timeSensitivity": "MOST_RECENT",\n  "title": "Access review"\n}',
      "",
      "to send exactly this request: --approve d",
      "  the digest covers the method, the path and every byte of the body above; change any of them and it stops matching",
    ]);
  });

  it("prints an upload's field names and its SHA-256, and never its bytes", () => {
    const upload = resolveVantaWriteRequest({
      input: {
        description: "Q1",
        documentId: "d1",
        effectiveAtDate: "2026-01-01",
        file: { content: new Uint8Array([1, 2, 3]), mimeType: "application/pdf", name: "report.pdf" },
      },
      kind: "upload-evidence",
    });
    // The whole array, not three `toContain`s: the guarantee this case is named for is that the file's BYTES
    // never reach the report, and an assertion that only names lines it wants present cannot see a line that
    // should not be there. The fixture's content is 1, 2, 3 precisely so a leak would be legible.
    expect(renderVantaDocumentDryRun({ digest: "d", request: upload, verb: "upload-evidence" })).toEqual([
      "write vanta upload-evidence --dry-run: this request would be sent, nothing was",
      "",
      "POST /v1/documents/d1/uploads",
      "  authorization: Bearer <token>",
      "",
      "  file: report.pdf (application/pdf, 3 bytes, sha256 039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81)",
      "  effectiveAtDate: 2026-01-01",
      "  description: Q1",
      "",
      "to send exactly this request: --approve d",
      "  the digest covers the method, the path and every byte of the body above; change any of them and it stops matching",
      "  the file's sha256 above binds its exact bytes, so a different file under the same name stops matching",
    ]);
  });
});

// `sent` alone could not tell a landed upload from one that never arrived, which is the whole reason the
// pen-test renewal read as missing for three hours. The provider's answer carries the token.
describe("renderVantaWriteResult", () => {
  const UPLOAD = {
    creationDate: "2026-09-22T05:40:00.000Z",
    deletionDate: null,
    description: "a probe",
    effectiveDate: null,
    fileName: "probe.pdf",
    id: "6ab1fe9f724f1ccfcf81e4d5",
    mimeType: "application/pdf",
    title: "Manual Evidence",
    updatedDate: "2026-09-22T05:40:00.000Z",
    uploadedBy: { id: "u-1", type: "APPLICATION" },
    url: "https://app.vanta.com/documents/security-distribution-lists",
  };

  it("names the upload id the provider assigned, so the write is checkable without a full atlas walk", () => {
    expect(renderVantaWriteResult({ result: UPLOAD, verb: "upload-evidence" })).toEqual([
      "write vanta upload-evidence: sent",
      "  upload 6ab1fe9f724f1ccfcf81e4d5 — Manual Evidence (application/pdf)",
      "  https://app.vanta.com/documents/security-distribution-lists",
      "  confirm it independently with `slopweaver atlas vanta sync`, then read the document-upload of that id",
    ]);
  });

  it("names the command that confirms it independently, because the response is still the provider's own word", () => {
    expect(renderVantaWriteResult({ result: UPLOAD, verb: "upload-evidence" })[3]).toContain("atlas vanta sync");
  });

  it("names the document a create returned, which is the id every later upload is addressed to", () => {
    const lines = renderVantaWriteResult({
      result: {
        category: "Infrastructure",
        description: "d",
        id: "doc-9",
        isSensitive: false,
        ownerId: null,
        title: "Network diagram",
        uploadStatus: "OK",
        uploadStatusDate: null,
        url: null,
      },
      verb: "create-document",
    });
    expect(lines).toEqual(["write vanta create-document: sent", "  document doc-9 — Network diagram"]);
  });

  // submit-document answers with nothing at all, and a line inventing a token for it would be a lie.
  it("says only that it was sent when the provider answered with no object", () => {
    expect(renderVantaWriteResult({ result: null, verb: "submit-document" })).toEqual([
      "write vanta submit-document: sent",
    ]);
  });

  // The tempting failure is to reach for whatever fields an object happens to carry. This input carries every
  // field a token line would want and matches neither schema, so a renderer that duck-typed instead of parsing
  // would print a token here — which is exactly the invented confirmation the whole change exists to refuse.
  it("prints no token for an object carrying the field names a token line wants, because recognition is the schema", () => {
    expect(
      renderVantaWriteResult({
        result: { id: "not-an-upload", mimeType: "application/pdf", title: "Looks Real", url: "https://example" },
        verb: "upload-evidence",
      }),
    ).toEqual(["write vanta upload-evidence: sent"]);
  });

  it("prints no token for an upload missing one required field, so a partial response cannot read as a landed one", () => {
    const { mimeType: _dropped, ...withoutMimeType } = UPLOAD;

    expect(renderVantaWriteResult({ result: withoutMimeType, verb: "upload-evidence" })).toEqual([
      "write vanta upload-evidence: sent",
    ]);
  });
});
