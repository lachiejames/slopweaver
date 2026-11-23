/**
 * The concurrent journal read `talk find-card` takes is the serial `journalEvidence` map, key for key and value for
 * value: a run journal, a doc never run, a FIFO where a journal should be, and a slug no journal may be named after.
 * Real temporary directories, the round-trip `testing.md` sanctions.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { journalEvidence, journalEvidenceConcurrently } from "../../../handover/assemble.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import { appendRunEvent, readRunJournalAsync, runJournalPath } from "../../../handover/runStore.js";
import { unwrapErr } from "../../../lib/result.js";

const AT = "2026-10-26T00:00:00.000Z";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A runs directory holding a started journal, a FIFO journal, one with an undecodable line, and nothing for the rest. */
function runsFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-journals-"));
  fixtureDirs.push(dir);
  appendRunEvent({ event: { atIso: AT, branch: "b", docHash: "h", kind: "started" }, runsDir: dir, slug: "started" });
  appendRunEvent({ event: { atIso: AT, branch: "b", docHash: "h", kind: "started" }, runsDir: dir, slug: "torn" });
  appendFileSync(runJournalPath({ runsDir: dir, slug: "torn" }), "{not json\n");
  execFileSync("mkfifo", [runJournalPath({ runsDir: dir, slug: "trap" })]);
  return dir;
}

/** A doc carrying one slug, as the scan would parse it. */
function docFor({ slug }: { slug: string }): ReturnType<typeof parseHandoverDoc> {
  return parseHandoverDoc({ path: `/board/${slug}.md`, text: `---\nslug: ${slug}\nstatus: ready\n---\n` });
}

describe("journalEvidenceConcurrently", () => {
  it("is the serial read's map, for every kind of journal a board holds", async () => {
    const runsDir = runsFixture();
    const docs = ["started", "torn", "never-run", "trap", "../escape", "started"].map((slug) => docFor({ slug }));

    const concurrent = await journalEvidenceConcurrently({ docs, runsDir });

    expect([...concurrent.keys()]).toEqual(["started", "torn", "never-run", "trap", "../escape"]);
    expect(concurrent.get("started")!.events.map((event) => event.kind)).toEqual(["started"]);
    expect(concurrent.get("torn")!.unreadableLines).toEqual([2]);
    expect(concurrent.get("never-run")).toEqual({ events: [], unreadableLines: [] });
    expect(concurrent.get("trap")).toEqual({ events: [], unreadableLines: [0] });
    expect(concurrent.get("../escape")).toEqual({ events: [], unreadableLines: [0] });
    expect([...concurrent]).toEqual([...journalEvidence({ docs, runsDir })]);
  });
});

describe("readRunJournalAsync", () => {
  it("refuses a traversing slug before touching disk, with the serial read's error", async () => {
    const result = await readRunJournalAsync({ runsDir: runsFixture(), slug: "../escape" });

    expect(unwrapErr(result)).toEqual({
      kind: "io",
      message: '"../escape" is not usable as a journal filename — a slug must be a plain name (letters, digits, . _ -)',
      operation: "handover.readRunJournal",
      path: "../escape",
    });
  });

  it("refuses a FIFO where a journal should be instead of opening it", async () => {
    const runsDir = runsFixture();

    const result = await readRunJournalAsync({ runsDir, slug: "trap" });

    expect(unwrapErr(result).message).toContain("is not a regular file");
  });
});
