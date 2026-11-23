/**
 * The board row's `body` — the column that lets `handovers/` stop existing.
 *
 * Every other column on `board_row` is a front-matter field, so a store holding all of them still could not
 * answer "what does this row actually say". The board must not rely on
 * the local file system, like files and folders, which it cannot honour while its prose is only ever in a
 * file.
 *
 * Pure: a string in, a string out. The document is a fixture in the test, never one on disk.
 */
import { describe, expect, it } from "vitest";

import { bodyBelowFrontMatter } from "../../../store/fleet/boardRow.js";

/** A board document with the shape `handover register` writes. */
const DOC = [
  "---",
  "slug: a-row",
  "kind: ask",
  'summary: "something requested"',
  "status: ready",
  "doneWhen: []",
  "---",
  "",
  "# something requested",
  "",
  "## What was asked for",
  "",
  "the ask, as stated",
  "",
].join("\n");

describe("bodyBelowFrontMatter", () => {
  it("returns the prose and none of the front-matter", () => {
    const body = bodyBelowFrontMatter({ text: DOC });

    expect(body).toBe(["# something requested", "", "## What was asked for", "", "the ask, as stated", ""].join("\n"));
  });

  // The paired negative: the assertion above would pass on a function that returned the whole document if
  // the fixture happened to be short, so this names what must be ABSENT and the input really carries it.
  it("drops every front-matter key, which the input does carry", () => {
    expect(DOC).toContain("slug: a-row");
    expect(bodyBelowFrontMatter({ text: DOC })).not.toContain("slug: a-row");
  });

  // A `---` inside the prose is a markdown rule, and splitting on the first one anywhere would truncate the
  // body at it. The split is on the front-matter's own closing fence, so this survives.
  it("keeps a horizontal rule that appears inside the body", () => {
    const withRule = `${DOC}\n---\n\nmore prose after a rule\n`;

    const body = bodyBelowFrontMatter({ text: withRule });

    expect(body).toContain("the ask, as stated");
    expect(body).toContain("more prose after a rule");
  });

  it("treats a document with no front-matter as all body", () => {
    expect(bodyBelowFrontMatter({ text: "# just prose\n\nno fence here\n" })).toBe("# just prose\n\nno fence here\n");
  });

  // An unterminated fence is not front-matter, so nothing may claim to have stripped one — returning the
  // text whole is the honest reading, and it keeps a malformed document's content from vanishing.
  it("returns the whole text when the opening fence is never closed", () => {
    const unterminated = "---\nslug: broken\nkind: ask\n";

    expect(bodyBelowFrontMatter({ text: unterminated })).toContain("slug: broken");
  });

  it("is empty for a document that is front-matter and nothing else", () => {
    expect(bodyBelowFrontMatter({ text: "---\nslug: bare\n---\n" })).toBe("");
  });

  // Both of these were CAUGHT BY REVIEW, not by the first draft's own cases — they
  // failed this file's property on exactly these.
  //
  // The column exists so `handovers/` can be deleted. A round trip that silently reindents a document means
  // the file was never safe to delete, and in markdown a four-space indent on the first line is a CODE
  // BLOCK — the indentation is the syntax, not whitespace to be tidied. The first draft ended in `.trim()`.
  it("keeps the leading indentation of a body that opens with a code block", () => {
    const doc = "---\nslug: x\n---\n\n    const a = 1;\n\nprose\n";

    expect(bodyBelowFrontMatter({ text: doc })).toBe("    const a = 1;\n\nprose\n");
  });

  it("keeps a trailing blank line rather than tidying the document", () => {
    expect(bodyBelowFrontMatter({ text: "---\nslug: x\n---\n\nprose\n\n\n" })).toBe("prose\n\n\n");
  });

  // Matching the fence as `---\n` alone made a CRLF document read as having no front-matter at all, so its
  // whole header was stored as body. The positive half is asserted beside the absence, per `testing.md`.
  it("strips a CRLF document's front-matter, which it really carries", () => {
    const crlf = "---\r\nslug: x\r\nkind: ask\r\n---\r\n\r\nprose\r\n";

    const body = bodyBelowFrontMatter({ text: crlf });

    expect(body).toBe("prose\r\n");
    expect(crlf).toContain("slug: x");
    expect(body).not.toContain("slug: x");
  });
});
