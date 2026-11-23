/**
 * `boardRowOnDisk`, the seam `briefing card --drop --settled-by` reads a board row through, over a real throwaway
 * home: a link to nothing where the journal or the live doc belongs reads as unreadable, never as absent.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { boardRowOnDisk } from "../../../../../cli/commands/briefing/cardDropRun.js";

const FIRST = "file:///home/acme/.slopweaver/pages/first/index.html";

describe("boardRowOnDisk", () => {
  it("reads a board row whose run journal is a link to nothing as unreadable, never as no journal", () => {
    const home = mkdtempSync(join(tmpdir(), "card-drop-journal-"));
    try {
      mkdirSync(join(home, "handovers"), { recursive: true });
      mkdirSync(join(home, "runs"), { recursive: true });
      writeFileSync(
        join(home, "handovers", "a-row.md"),
        `---\nslug: a-row\nstatus: done\nartifact: ${FIRST}\n---\n# doc\n`,
      );
      const journal = join(home, "runs", "a-row.jsonl");
      symlinkSync(join(home, "nowhere.jsonl"), journal);

      expect(boardRowOnDisk({ home, slug: "a-row" })).toEqual({
        kind: "unreadable",
        slug: "a-row",
        why: `its run journal ${journal} is a link to nothing`,
      });
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("reads a live doc that is a link to nothing as unreadable, never falling back to its archive", () => {
    const home = mkdtempSync(join(tmpdir(), "card-drop-doc-"));
    try {
      mkdirSync(join(home, "handovers", "archive"), { recursive: true });
      writeFileSync(
        join(home, "handovers", "archive", "a-row.md"),
        `---\nslug: a-row\nstatus: done\nartifact: ${FIRST}\n---\n# doc\n`,
      );
      const live = join(home, "handovers", "a-row.md");
      symlinkSync(join(home, "nowhere.md"), live);

      expect(boardRowOnDisk({ home, slug: "a-row" })).toEqual({
        kind: "unreadable",
        slug: "a-row",
        why: `its doc ${live} is a link to nothing`,
      });
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
