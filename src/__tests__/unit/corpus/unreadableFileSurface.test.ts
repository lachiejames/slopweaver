/**
 * A file nobody could open must not read as a source that holds nothing.
 *
 * `readCorpusDir` keeps going past an unreadable file, which is right for a reader and dangerous for a
 * caller: the difference between "empty" and "could not be read" was visible only as a string among the
 * warnings, and every caller in the repo dropped it. The paths are now in the return type, and the callers
 * that build durable state from them refuse.
 *
 * The unreadable file here is a REAL one — `chmod 000` and a genuine `EACCES` from the filesystem, not a
 * simulated failure — because the thing under test is precisely what the fs does on a permission bit. Each
 * test asserts the file actually failed to read before asserting the consequence, so a run as root (where
 * the mode is bypassed) fails loudly instead of passing on a file it could open after all.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDistilBatchPlan } from "../../../cli/commands/distil/plan.js";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../corpus/corpusDirRead.js";
import { createBronzeCommitter } from "../../../corpus/corpusWriter.js";
import { withRowReader } from "../../../corpus/rowReader.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { admittingSlotGuard } from "../../loadSlotFixture.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-unreadable-"));
});

afterEach(() => {
  // Restore the mode first: a 000 file cannot be removed from a directory the runner then tries to clean.
  restoreModes();
  rmSync(home, { force: true, recursive: true });
});

const chmodded: string[] = [];

/** Undo every `chmod 000` this file applied, so the temp tree can be removed. */
function restoreModes(): void {
  for (const path of chmodded.splice(0)) {
    chmodSync(path, 0o600);
  }
}

/** The slack bronze dir under the temp home. */
function slackDir(): string {
  return join(home, "corpus", "bronze", "slack");
}

/** One serialised bronze row. */
function row({ sourceId }: { sourceId: string }): string {
  return JSON.stringify({
    container: "C1",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId,
    text: "hello",
    tsIso: "2026-01-01T00:00:00Z",
    url: `https://example.invalid/${sourceId}`,
  });
}

/** Write a bronze window file, optionally making it unreadable for real. */
function writeWindow({ name, content, unreadable = false }: { name: string; content: string; unreadable?: boolean }) {
  mkdirSync(slackDir(), { recursive: true });
  const path = join(slackDir(), name);
  writeFileSync(path, content, "utf8");
  if (unreadable) {
    chmodSync(path, 0o000);
    chmodded.push(path);
  }
  return path;
}

/** A record the committer will try to write. */
function record({ sourceId }: { sourceId: string }): CorpusRecord {
  return {
    container: "C1",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId,
    text: "hello",
    tsIso: "2026-01-01T00:00:00Z",
    url: `https://example.invalid/${sourceId}`,
  };
}

describe("readCorpusDir", () => {
  it("names a file it could not open at all, beside the records it did read", () => {
    writeWindow({ content: `${row({ sourceId: "m1" })}\n`, name: "2026-01-01_2026-01-02.jsonl" });
    const blocked = writeWindow({
      content: `${row({ sourceId: "m2" })}\n`,
      name: "2026-01-03_2026-01-04.jsonl",
      unreadable: true,
    });

    const read = unwrap(readCorpusDir({ dir: join(home, "corpus", "bronze"), home, protection: NO_ENTRIES }));

    // The premise first: if the mode did not actually block the read, everything below is vacuous.
    expect(read.unreadable).toEqual([blocked]);
    expect(read.records.map((r) => r.sourceId)).toEqual(["m1"]);
  });

  it("a corrupt LINE is not an unreadable file — the file still counts as read", () => {
    writeWindow({ content: `${row({ sourceId: "m1" })}\nnot json at all\n`, name: "2026-01-01_2026-01-02.jsonl" });

    const read = unwrap(readCorpusDir({ dir: join(home, "corpus", "bronze"), home, protection: NO_ENTRIES }));

    expect(read.unreadable).toEqual([]);
    expect(read.records.map((r) => r.sourceId)).toEqual(["m1"]);
    expect(read.warnings).toHaveLength(1);
    expect(read.warnings[0]).toContain("1 row(s) rejected: invalid JSON (line 2)");
  });
});

describe("createBronzeCommitter over a partially unreadable source", () => {
  it("REFUSES rather than re-appending records the unreadable file may already hold", () => {
    const blocked = writeWindow({
      content: `${row({ sourceId: "m1" })}\n`,
      name: "2026-01-03_2026-01-04.jsonl",
      unreadable: true,
    });
    expect(
      unwrap(readCorpusDir({ dir: join(home, "corpus", "bronze"), home, protection: NO_ENTRIES })).unreadable,
    ).toEqual([blocked]);

    const committer = createBronzeCommitter({
      home,
      protection: NO_ENTRIES,
      window: { since: "2026-01-05", until: "2026-01-06" },
    });
    const failed = unwrapErr(committer.commit({ records: [record({ sourceId: "m1" })] }));

    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("refusing to write slack");
    expect(failed[0]).toContain("dedup index is incomplete");
    expect(failed[0]).toContain(blocked);
  });

  it("writes normally when every stored file is readable, corrupt lines included", () => {
    writeWindow({ content: `${row({ sourceId: "m1" })}\nnot json at all\n`, name: "2026-01-01_2026-01-02.jsonl" });

    const committer = createBronzeCommitter({
      home,
      protection: NO_ENTRIES,
      window: { since: "2026-01-05", until: "2026-01-06" },
    });
    const written = unwrap(committer.commit({ records: [record({ sourceId: "m2" })] }));

    expect(written.written).toBe(1);
    expect(written.bySource["slack"]).toBe(1);
  });

  it("still dedups against a readable store, so the refusal did not replace the guarantee", () => {
    writeWindow({ content: `${row({ sourceId: "m1" })}\n`, name: "2026-01-01_2026-01-02.jsonl" });

    const committer = createBronzeCommitter({
      home,
      protection: NO_ENTRIES,
      window: { since: "2026-01-05", until: "2026-01-06" },
    });
    const written = unwrap(committer.commit({ records: [record({ sourceId: "m1" })] }));

    expect(written.written).toBe(0);
    expect(written.deduped).toBe(1);
  });
});

describe("the other callers that build durable state from this read", () => {
  it("`distil plan` refuses, because a plan missing a source's batches spends a real budget on a partial corpus", () => {
    const blocked = writeWindow({
      content: `${row({ sourceId: "m1" })}\n`,
      name: "2026-01-03_2026-01-04.jsonl",
      unreadable: true,
    });
    writeWindow({ content: `${row({ sourceId: "m2" })}\n`, name: "2026-01-01_2026-01-02.jsonl" });
    expect(
      unwrap(readCorpusDir({ dir: join(home, "corpus", "bronze"), home, protection: NO_ENTRIES })).unreadable,
    ).toEqual([blocked]);

    const failed = unwrapErr(
      withRowReader({
        run: (reader) =>
          loadDistilBatchPlan({ guard: admittingSlotGuard, home, options: { recentOnly: false }, reader }),
      }),
    );

    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("refusing to plan distil");
    expect(failed[0]).toContain(blocked);
  });

  it("`distil plan` plans normally when every stored file is readable", () => {
    writeWindow({ content: `${row({ sourceId: "m2" })}\n`, name: "2026-01-01_2026-01-02.jsonl" });

    const planned = unwrap(
      withRowReader({
        run: (reader) =>
          loadDistilBatchPlan({ guard: admittingSlotGuard, home, options: { recentOnly: false }, reader }),
      }),
    );

    expect(planned.batches.length).toBeGreaterThan(0);
  });
});
