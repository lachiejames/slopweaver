import { describe, expect, it } from "vitest";

import { isApprovalGate } from "../../../../admit/approval.js";
import {
  DOCUMENT_UNAPPROVED_CODE,
  vantaDocumentApprovalGate,
  vantaDocumentDigest,
} from "../../../../atlas/vanta/documentApproval.js";
import { resolveVantaWriteRequest } from "../../../../atlas/vanta/writePreview.js";

const CREATE = {
  input: {
    cadence: "P1Y",
    description: "quarterly access review evidence",
    isSensitive: false,
    reminderWindow: "P1M",
    timeSensitivity: "MOST_RECENT",
    title: "Access review",
  },
  kind: "create-document",
} as const;

const REQUEST = resolveVantaWriteRequest(CREATE);
const DIGEST = vantaDocumentDigest({ request: REQUEST });

/** The door request shape the gate is handed; the gate reads none of it, so a minimal one is honest here. */
const DOOR_REQUEST = {
  action: { kind: "verb", noun: "write", verb: "vanta create-document" },
  artifact: { document: null, write: "create-document" },
  meta: { createsWorkItem: false, effect: "external-write", home: "/home", requiresApproval: true },
} as const;

describe("vantaDocumentDigest", () => {
  it("is stable for the same request", () => {
    expect(vantaDocumentDigest({ request: resolveVantaWriteRequest(CREATE) })).toBe(DIGEST);
  });

  it("changes when one word of the body changes", () => {
    const changed = resolveVantaWriteRequest({
      ...CREATE,
      input: { ...CREATE.input, title: "Access reviews" },
    });

    expect(vantaDocumentDigest({ request: changed })).not.toBe(DIGEST);
  });

  it("changes when the path changes", () => {
    const other = resolveVantaWriteRequest({ input: { documentId: "d1" }, kind: "submit-document" });

    expect(vantaDocumentDigest({ request: other })).not.toBe(DIGEST);
  });

  // The swap the approval exists to catch: dry-run one file, replace it on disk under the same name, run for real.
  // Before the preview carried the file's SHA-256, both of these digested alike and the owner's yes admitted either file.
  it("changes when an upload's bytes change under the same name, and holds the stale approval", () => {
    const upload = ({ content }: { content: Uint8Array<ArrayBuffer> }) =>
      vantaDocumentDigest({
        request: resolveVantaWriteRequest({
          input: {
            description: null,
            documentId: "d1",
            effectiveAtDate: null,
            file: { content, mimeType: "application/pdf", name: "report.pdf" },
          },
          kind: "upload-evidence",
        }),
      });
    const approved = upload({ content: new Uint8Array([1, 2, 3]) });
    const swapped = upload({ content: new Uint8Array([1, 2, 4]) });

    expect(upload({ content: new Uint8Array([1, 2, 3]) })).toBe(approved);
    expect(swapped).not.toBe(approved);
    const findings = vantaDocumentApprovalGate({ expected: swapped, supplied: approved })(DOOR_REQUEST);
    expect(findings.map(({ code, severity }) => ({ code, severity }))).toEqual([
      { code: DOCUMENT_UNAPPROVED_CODE, severity: "hold" },
    ]);
  });
});

describe("vantaDocumentApprovalGate", () => {
  it("is recognised by the door as an approval gate", () => {
    expect(isApprovalGate(vantaDocumentApprovalGate({ expected: DIGEST, supplied: DIGEST }))).toBe(true);
  });

  it("passes when the supplied digest matches exactly", () => {
    expect(vantaDocumentApprovalGate({ expected: DIGEST, supplied: DIGEST })(DOOR_REQUEST)).toEqual([]);
  });

  it("holds with no approval at all, and names the digest to use", () => {
    const findings = vantaDocumentApprovalGate({ expected: DIGEST, supplied: null })(DOOR_REQUEST);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe(DOCUMENT_UNAPPROVED_CODE);
    expect(findings[0]!.severity).toBe("hold");
    expect(findings[0]!.correction).toContain(`--approve ${DIGEST}`);
    expect(findings[0]!.correction).toContain("an upload's file SHA-256 included");
  });

  it("holds when the approval covers a different request", () => {
    const findings = vantaDocumentApprovalGate({ expected: DIGEST, supplied: "0000000000000000" })(DOOR_REQUEST);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.summary).toContain("it was approved, then it changed");
  });
});
