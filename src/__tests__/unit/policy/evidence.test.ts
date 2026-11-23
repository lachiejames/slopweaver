// deleted-with-code: evidenceFileName, renderEvidenceFile, renderEvidenceIndex
import { describe, expect, it } from "vitest";

import { evidenceView } from "../../../policy/evidenceAtlasView.js";

const details = {
  controlLinks: [
    { childId: "ctl-b", parentId: "doc-1", parentKind: "evidence" },
    { childId: "doc-1", parentId: "ctl-b", parentKind: "control" },
    { childId: "doc-1", parentId: "ctl-a", parentKind: "control" },
    { childId: "doc-1", parentId: "ctl-unnamed", parentKind: "control" },
    { childId: "doc-1", parentId: "ctl-x", parentKind: "something-else" },
  ],
  controls: [
    { externalId: "IAC-28", id: "ctl-b", name: "Access reviews" },
    { externalId: "HRS-01", id: "ctl-a", name: "Background checks" },
  ],
  documents: [
    {
      category: "Engineering",
      description: "Quarterly access review.",
      id: "doc-1",
      isSensitive: false,
      title: "Access review",
      uploadStatus: "OK",
      uploadStatusDate: "2026-08-01T03:00:00.000Z",
      url: "https://app.vanta.com/documents/doc-1",
    },
    { id: "doc-0", isSensitive: true, title: "Background checks", uploadStatus: "Needs update" },
    { id: "doc-2", title: "No flag at all" },
    { id: "doc-3" },
  ],
  links: [
    {
      creationDate: "2026-07-02T00:00:00Z",
      id: "ln-2",
      parentId: "doc-1",
      url: "https://docs.google.com/x?share=secret",
    },
    { creationDate: "2026-07-01T00:00:00Z", id: "ln-1", parentId: "doc-1", url: "not a url" },
  ],
  uploads: [
    {
      creationDate: "2026-06-02T00:00:00Z",
      deletionDate: null,
      effectiveDate: "2026-06-01T00:00:00Z",
      fileName: "jane-doe-cv.pdf",
      id: "up-2",
      mimeType: "application/pdf",
      parentId: "doc-1",
      uploadedBy: { id: "u-1", type: "USER" },
    },
    { creationDate: "2026-05-01T00:00:00Z", deletionDate: "2026-05-02T00:00:00Z", id: "up-dead", parentId: "doc-1" },
    { creationDate: "2026-06-01T00:00:00Z", id: "up-1", mimeType: "text/x-odd", parentId: "doc-1" },
    { creationDate: "2026-06-01T00:00:00Z", id: "up-s", parentId: "doc-0" },
  ],
};

describe("evidenceView", () => {
  const view = evidenceView({ details });
  const accessReview = view.find((document) => document.documentId === "doc-1")!;

  it("drops a document with no title and orders the rest by id", () => {
    expect(view.map((document) => document.documentId)).toEqual(["doc-0", "doc-1", "doc-2"]);
  });

  it("treats a document as sensitive unless Vanta says false exactly", () => {
    expect(view.map((document) => document.sensitive)).toEqual([true, false, true]);
  });

  it("drops a deleted upload and orders the rest by creation date, carrying no file name", () => {
    expect(accessReview.uploads).toEqual([
      {
        creationDate: "2026-06-01T00:00:00Z",
        effectiveDate: null,
        mimeType: "text/x-odd",
        uploadId: "up-1",
        uploadedByType: null,
      },
      {
        creationDate: "2026-06-02T00:00:00Z",
        effectiveDate: "2026-06-01T00:00:00Z",
        mimeType: "application/pdf",
        uploadId: "up-2",
        uploadedByType: "USER",
      },
    ]);
  });

  it("keeps only a link's host, and null for a string that is not a URL", () => {
    expect(accessReview.links).toEqual([
      { creationDate: "2026-07-01T00:00:00Z", host: null, linkId: "ln-1" },
      { creationDate: "2026-07-02T00:00:00Z", host: "docs.google.com", linkId: "ln-2" },
    ]);
  });

  it("joins a mapping recorded from both ends once, and lists an unnamed control by id last", () => {
    expect(accessReview.controls).toEqual([
      { controlId: "ctl-a", externalId: "HRS-01", name: "Background checks" },
      { controlId: "ctl-b", externalId: "IAC-28", name: "Access reviews" },
      { controlId: "ctl-unnamed", externalId: null, name: null },
    ]);
  });
});
