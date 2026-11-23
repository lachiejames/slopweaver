/**
 * What `talk find-card` reads off a board doc before it ranks it: what the row says it is about, never its slug, and a
 * doc gone since the scan still searched on its front matter and named as not read whole.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cardRowsOf, cardTextsOf } from "../../../cli/commands/talk/findCardReads.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import { boardRowOwnerWords } from "../../../talk/boardRow.js";

/** A row with a ruling and a word section. Synthetic words. */
const ROW = [
  "---",
  "slug: the-linear-briefing-draft",
  "kind: ask",
  'summary: "the linear briefing goes to tobias as a draft dm"',
  "status: ready",
  "priority: p1",
  'ruling: "split it one section per project"',
  "rulingAnchor: /somewhere/owner-turn.txt",
  "---",
  "",
  "# the linear briefing draft",
  "",
  "## The owner's word, 02:41Z",
  "",
  "> ask what they think of the split",
  "",
].join("\n");

const NO_RUN = { events: [], unreadableLines: [] };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "find-card-reads-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("cardTextsOf", () => {
  it("reads the summary, the owner's words and the open question, and never the slug", () => {
    const doc = parseHandoverDoc({ path: join(dir, "row.md"), text: ROW });
    const texts = cardTextsOf({ doc, hisWords: ["split it one section per project"], question: "send it?" });
    expect(texts).toEqual([
      "the linear briefing goes to tobias as a draft dm",
      "split it one section per project",
      "send it?",
    ]);
  });
});

describe("cardRowsOf", () => {
  it("reads the owner's words off the file, so a word section is searched", () => {
    const path = join(dir, "row.md");
    writeFileSync(path, ROW);
    const doc = parseHandoverDoc({ path, text: ROW });
    const read = cardRowsOf({ docs: [doc], journals: new Map([[doc.slug, NO_RUN]]), scannedOwnerWords: new Map() });
    expect(read.unreadable).toEqual([]);
    expect(read.rows[0]!.slug).toBe("the-linear-briefing-draft");
    expect(read.rows[0]!.texts).toContain("## The owner's word, 02:41Z\n\n> ask what they think of the split");
  });

  it("searches the owner's words the scan already took, never opening the file a second time", () => {
    // No file is written: the only place this doc's word section exists is what the scan took off its text.
    const path = join(dir, "scanned.md");
    const doc = parseHandoverDoc({ path, text: ROW });
    const scannedOwnerWords = new Map([[path, boardRowOwnerWords({ doc, text: ROW })]]);
    const read = cardRowsOf({ docs: [doc], journals: new Map([[doc.slug, NO_RUN]]), scannedOwnerWords });
    expect(read.unreadable).toEqual([]);
    expect(read.rows[0]!.texts).toContain("## The owner's word, 02:41Z\n\n> ask what they think of the split");
  });

  it("searches a doc the scan never read, gone now, on its front matter, and names it as not read whole", () => {
    const path = join(dir, "gone.md");
    const doc = parseHandoverDoc({ path, text: ROW });
    const read = cardRowsOf({ docs: [doc], journals: new Map([[doc.slug, NO_RUN]]), scannedOwnerWords: new Map() });
    expect(read.unreadable).toEqual([path]);
    expect(read.rows[0]!.texts).toEqual(["the linear briefing goes to tobias as a draft dm"]);
  });
});
