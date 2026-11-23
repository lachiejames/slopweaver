/**
 * Acquisition for the ruling audit, against real temporary directories — sanctioned by `testing.md` as a
 * genuine round trip, because the property is "does it report what is on disk, including when it cannot look".
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RulingAuditProblems } from "../../../handover/rulingAuditErrors.js";
import { readRulingAuditInput } from "../../../handover/rulingAuditStore.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway home with a board, its archive and a runs directory. */
function home(): { handoverDir: string; runsDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "ruling-audit-store-"));
  homes.push(root);
  const handoverDir = join(root, "handovers");
  const runsDir = join(root, "runs");
  mkdirSync(join(handoverDir, "archive"), { recursive: true });
  mkdirSync(runsDir);
  return { handoverDir, root, runsDir };
}

/** Write a minimal row document. */
function writeDoc({ dir, slug, name = `${slug}.md` }: { dir: string; slug: string; name?: string }): string {
  const path = join(dir, name);
  writeFileSync(path, `---\nslug: ${slug}\nsummary: a row\n---\n`);
  return path;
}

const ANSWER_LINE = JSON.stringify({ answer: "yes", atIso: "2026-09-04T12:38:57.414Z", kind: "answered" });

describe("readRulingAuditInput", () => {
  it("unions the board, the archive, journal-only rows and manifest-only rows, sorted by slug", () => {
    const { handoverDir, root, runsDir } = home();
    const active = writeDoc({ dir: handoverDir, slug: "b-active" });
    const archived = writeDoc({ dir: join(handoverDir, "archive"), slug: "a-archived" });
    writeFileSync(join(runsDir, "c-journal-only.jsonl"), `${ANSWER_LINE}\n`);
    const manifestPath = join(root, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        entries: [{ anchor: "a", slug: "d-manifest-only", sourceAtIso: "2026-09-04T12:38:57.414Z", words: "yes" }],
        schemaVersion: 1,
      }),
    );

    const input = readRulingAuditInput({ handoverDir, manifestPath, runsDir });

    expect(input.problems).toEqual([]);
    expect(input.rows.map((row) => [row.slug, row.docs.map((each) => [each.location, each.path])])).toEqual([
      ["a-archived", [["archive", archived]]],
      ["b-active", [["active", active]]],
      ["c-journal-only", []],
      ["d-manifest-only", []],
    ]);
    expect(input.rows[2]!.journal).toEqual({
      events: [{ answer: "yes", atIso: "2026-09-04T12:38:57.414Z", kind: "answered" }],
      kind: "read",
      unreadableLines: [],
    });
    expect(input.manifest?.entries.length).toBe(1);
    expect(input.manifestPath).toBe(manifestPath);
  });

  it("treats a home with no board, archive or runs yet as empty rather than broken", () => {
    const root = mkdtempSync(join(tmpdir(), "ruling-audit-empty-"));
    homes.push(root);
    const input = readRulingAuditInput({
      handoverDir: join(root, "handovers"),
      manifestPath: undefined,
      runsDir: join(root, "runs"),
    });
    expect(input.rows).toEqual([]);
    expect(input.problems).toEqual([]);
    expect(input.manifest).toBeNull();
    expect(input.manifestPath).toBeNull();
  });

  it("keeps a document in both the board and the archive as two occurrences of one slug", () => {
    const { handoverDir, runsDir } = home();
    writeDoc({ dir: handoverDir, slug: "twice" });
    writeDoc({ dir: join(handoverDir, "archive"), name: "twice-through-sep.md", slug: "twice" });
    const input = readRulingAuditInput({ handoverDir, manifestPath: undefined, runsDir });
    expect(input.rows.map((row) => row.docs.map((each) => each.location))).toEqual([["active", "archive"]]);
  });

  it("reports the line numbers of a journal line that did not decode", () => {
    const { handoverDir, runsDir } = home();
    writeFileSync(join(runsDir, "a-row.jsonl"), `${ANSWER_LINE}\n{"kind":"ruling","atIso":\n`);
    const input = readRulingAuditInput({ handoverDir, manifestPath: undefined, runsDir });
    expect(input.rows[0]!.journal).toMatchObject({ kind: "read", unreadableLines: [2] });
  });

  it("reports a journal that is not a regular file as failed, not as empty", () => {
    const { handoverDir, runsDir } = home();
    mkdirSync(join(runsDir, "a-row.jsonl"));
    const input = readRulingAuditInput({ handoverDir, manifestPath: undefined, runsDir });
    expect(input.rows[0]!.journal.kind).toBe("failed");
  });

  it("names a journal file no row could be named for", () => {
    const { handoverDir, runsDir } = home();
    writeFileSync(join(runsDir, "-not-a-slug.jsonl"), "");
    const input = readRulingAuditInput({ handoverDir, manifestPath: undefined, runsDir });
    expect(input.problems).toEqual([
      RulingAuditProblems.unsafeJournalName({ path: join(runsDir, "-not-a-slug.jsonl") }),
    ]);
    expect(input.rows).toEqual([]);
  });

  it("names a runs directory that exists but cannot be listed, and still reads the board", () => {
    const { handoverDir, root } = home();
    const runsDir = join(root, "runs-is-a-file");
    writeFileSync(runsDir, "");
    writeDoc({ dir: handoverDir, slug: "a-row" });
    const input = readRulingAuditInput({ handoverDir, manifestPath: undefined, runsDir });
    expect(input.problems.map((problem) => [problem.code, problem.path])).toEqual([["DIRECTORY_UNREADABLE", runsDir]]);
    expect(input.rows.map((row) => row.slug)).toEqual(["a-row"]);
  });

  it("names a board doc the scan could not read", () => {
    const { handoverDir, runsDir } = home();
    mkdirSync(join(handoverDir, "not-a-file.md"));
    const input = readRulingAuditInput({ handoverDir, manifestPath: undefined, runsDir });
    expect(input.problems).toEqual([RulingAuditProblems.docUnreadable({ path: join(handoverDir, "not-a-file.md") })]);
  });

  it("names a manifest that is missing, not a file, or not a manifest — and reads no entry from it", () => {
    const { handoverDir, root, runsDir } = home();
    const invalid = join(root, "invalid.json");
    writeFileSync(invalid, "[]");
    const codes = [join(root, "absent.json"), root, invalid].map((manifestPath) =>
      readRulingAuditInput({ handoverDir, manifestPath, runsDir }).problems.map((p) => p.code),
    );
    expect(codes).toEqual([["MANIFEST_UNREADABLE"], ["MANIFEST_UNREADABLE"], ["MANIFEST_INVALID"]]);
  });
});

describe("readRulingAuditInput — a listed journal that does not resolve", () => {
  /**
   * `readRunJournal` maps `ENOENT` to an empty journal, which is right for a row nobody ever ran. A name the
   * directory just listed is a different fact, and reading it as emptiness was a review finding: an audit
   * would report complete input over a journal it never read.
   */
  it("reports a dangling symlink as failed rather than as a row that was never run", () => {
    const { handoverDir, runsDir } = home();
    symlinkSync(join(runsDir, "nowhere.jsonl"), join(runsDir, "a-row.jsonl"));

    const input = readRulingAuditInput({ handoverDir, manifestPath: undefined, runsDir });

    expect(input.rows[0]!.journal.kind).toBe("failed");
  });

  it("still reads a row with no journal file at all as an empty one", () => {
    const { handoverDir, runsDir } = home();
    writeDoc({ dir: handoverDir, slug: "never-run" });

    const input = readRulingAuditInput({ handoverDir, manifestPath: undefined, runsDir });

    expect(input.rows[0]!.journal).toEqual({ events: [], kind: "read", unreadableLines: [] });
  });
});

describe("readRulingAuditInput — a directory that is there and broken", () => {
  /**
   * A dangling symlink raises the same `ENOENT` a directory nobody has made yet raises, and every reader in
   * this register treats that as a fresh home. Two review passes found the same counterexample in two
   * places: a whole directory of rows became an empty one and the audit called that complete.
   */
  it.each([
    ["the archive", "handovers/archive"],
    ["the runs directory", "runs"],
  ])("names %s as unreadable when it is a dangling symlink, rather than reading it as empty", (_label, relative) => {
    const { handoverDir, root, runsDir } = home();
    const path = join(root, relative);
    rmSync(path, { recursive: true });
    symlinkSync(join(root, "nowhere"), path);

    const input = readRulingAuditInput({ handoverDir, manifestPath: undefined, runsDir });

    expect(input.problems.map((problem) => [problem.code, problem.path])).toEqual([["DIRECTORY_UNREADABLE", path]]);
  });

  it("still reads a directory reached through a symlink that resolves", () => {
    const { handoverDir, root, runsDir } = home();
    const real = join(root, "elsewhere");
    mkdirSync(real);
    writeDoc({ dir: real, slug: "filed-row" });
    rmSync(join(handoverDir, "archive"), { recursive: true });
    symlinkSync(real, join(handoverDir, "archive"));

    const input = readRulingAuditInput({ handoverDir, manifestPath: undefined, runsDir });

    expect(input.problems).toEqual([]);
    expect(input.rows.map((row) => [row.slug, row.docs[0]!.location])).toEqual([["filed-row", "archive"]]);
  });
});
