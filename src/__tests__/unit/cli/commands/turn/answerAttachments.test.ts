/**
 * `turn answer`'s two attachment lanes — a real filesystem round-trip, which `testing.md` allows for a
 * genuine fixture.
 *
 * The case that matters is the MISPLACEMENT. Image admission carries a document now rather than refusing
 * it, so without the check these loaders run, a PDF left in the form's `images` array would reach the
 * coverage gate as a waivable warn instead of the hard refusal it used to get.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { loadAnswerDocuments, loadAnswerImages } from "../../../../../cli/commands/turn/answerAttachments.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWP8z8DwnwEKmBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==",
  "base64",
);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n", "utf8");

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slopweaver-answer-attach-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const write = ({ name, bytes }: { name: string; bytes: Buffer }): string => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

function answer(over: Partial<AnswerFormAnswer> = {}): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: { model: "the dispatched worker", skillsLoaded: [], verbsLoaded: [] },
      reason: "answered from the thread",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "the report is attached",
    measurements: [],
    ...over,
  };
}

describe("loadAnswerImages", () => {
  it("loads nothing when the answer names no image", async () => {
    expect(unwrap(await loadAnswerImages({ answer: answer() }))).toEqual([]);
  });

  it("loads the named pictures in order, naming each by its base name", async () => {
    const first = write({ bytes: PNG, name: "panel.png" });
    const second = write({ bytes: PNG, name: "chart.png" });
    const uploads = unwrap(await loadAnswerImages({ answer: answer({ images: [second, first] }) }));
    expect(uploads.map((upload) => upload.filename)).toEqual(["chart.png", "panel.png"]);
  });

  it("refuses a deliverable left in the images lane, and names the lane that takes it", async () => {
    const pdf = write({ bytes: PDF, name: "pentest.pdf" });
    const result = await loadAnswerImages({ answer: answer({ images: [pdf] }) });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]!).toContain("pentest.pdf");
    expect(result._unsafeUnwrapErr()[0]!).toContain('"documents"');
  });

  it("says nothing about a real picture beside the deliverable — only the misplaced file is named", async () => {
    const png = write({ bytes: PNG, name: "panel.png" });
    const pdf = write({ bytes: PDF, name: "pentest.pdf" });
    const result = await loadAnswerImages({ answer: answer({ images: [png, pdf] }) });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]!).not.toContain("panel.png");
  });

  it("refuses an unreadable path before anything is posted", async () => {
    const result = await loadAnswerImages({ answer: answer({ images: [join(dir, "gone.png")] }) });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]!).toContain("gone.png");
  });
});

describe("loadAnswerDocuments", () => {
  it("loads the deliverable the form names", async () => {
    const pdf = write({ bytes: PDF, name: "pentest.pdf" });
    const documents = unwrap(await loadAnswerDocuments({ answer: answer({ documents: [pdf] }) }));
    expect(documents.map((document) => document.filename)).toEqual(["pentest.pdf"]);
  });

  // The one-directional lane check, asserted so the residue in this module's header is a tested fact.
  it("carries a PICTURE filed here without complaint, which is the residue this lane has always had", async () => {
    const png = write({ bytes: PNG, name: "panel.png" });
    const documents = unwrap(await loadAnswerDocuments({ answer: answer({ documents: [png] }) }));
    expect(documents.map((document) => document.filename)).toEqual(["panel.png"]);
  });

  it("refuses an unreadable path, naming the DOCUMENT rather than an image", async () => {
    const result = await loadAnswerDocuments({ answer: answer({ documents: [join(dir, "gone.pdf")] }) });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]!).toContain("document");
  });
});
