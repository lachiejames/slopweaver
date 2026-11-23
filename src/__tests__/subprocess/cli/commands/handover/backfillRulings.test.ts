/**
 * `handover backfill-rulings` run as the shipped verb, over a throwaway home — including the audit reading
 * back what it wrote, which is the proof the owner asked for.
 *
 * The falsifiable half is the BYTES: every assertion that a row was left alone is a byte comparison of the
 * whole home, so a verb that quietly touched a document or rewrote a journal fails here before any count does.
 *
 * `SLOPWEAVER_CLI_DIR` is set deliberately: `bin/slopweaver` otherwise resolves its checkout from an ambient
 * `PLUGIN_ROOT`, and a proof run from a worktree would silently exercise the main checkout instead.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { absentAsNumber } from "#lib/absent.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const SOURCE = "2026-09-04T12:38:57.414Z";
const ARCHIVED_SOURCE = "2026-09-05T08:10:00.000Z";
const WORDS = "OWNER RULED: ship it";
const ARCHIVED_WORDS = "OWNER RULED: file it";
const ANCHOR = "https://example.invalid/p9";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home with one active row and one archived row, each holding the answer the manifest names. */
function fixture(): { home: string; manifestPath: string } {
  const home = mkdtempSync(join(tmpdir(), "backfill-rulings-"));
  homes.push(home);
  mkdirSync(join(home, "handovers", "archive"), { recursive: true });
  mkdirSync(join(home, "runs"));
  writeFileSync(join(home, "handovers", "a-row.md"), "---\nslug: a-row\nsummary: an active row\n---\n");
  writeFileSync(
    join(home, "handovers", "archive", "filed-row.md"),
    "---\nslug: filed-row\nsummary: a filed row\n---\n",
  );
  writeFileSync(
    join(home, "runs", "a-row.jsonl"),
    `${JSON.stringify({ answer: WORDS, atIso: SOURCE, kind: "answered" })}\n`,
  );
  writeFileSync(
    join(home, "runs", "filed-row.jsonl"),
    `${JSON.stringify({ answer: ARCHIVED_WORDS, atIso: ARCHIVED_SOURCE, kind: "answered" })}\n`,
  );
  const manifestPath = join(home, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      entries: [
        { anchor: ANCHOR, slug: "a-row", sourceAtIso: SOURCE, words: WORDS },
        { anchor: "file:/scratch/turn.txt", slug: "filed-row", sourceAtIso: ARCHIVED_SOURCE, words: ARCHIVED_WORDS },
      ],
      schemaVersion: 1,
    }),
  );
  return { home, manifestPath };
}

interface Report {
  mode: string;
  complete: boolean;
  counts: Record<string, number>;
  entries: { status: string; entry: { slug: string }; recordedAtIso?: string }[];
  problems: { code: string }[];
  manifest?: { status: string; slug: string }[];
}

/** Run one verb and decode its JSON report. */
function run({ args }: { args: readonly string[] }): { status: number; report: Report; stdout: string } {
  const result = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_CLI_DIR: repoRoot,
      TMPDIR: process.env["TMPDIR"]!,
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  const report = args.includes("--json") ? (JSON.parse(result.stdout) as Report) : ({} as Report);
  return { report, status: absentAsNumber({ value: result.status, whenAbsent: -1 }), stdout: result.stdout };
}

/** Every file under a directory with its bytes, so "it wrote nothing" is falsifiable. */
function snapshot({ dir }: { dir: string }): readonly string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map(
      (entry) => `${join(entry.parentPath, entry.name)}: ${readFileSync(join(entry.parentPath, entry.name), "utf8")}`,
    )
    .toSorted();
}

describe("handover backfill-rulings", () => {
  it("plans without writing a byte, and says what it would append", () => {
    const { home, manifestPath } = fixture();
    const before = snapshot({ dir: home });

    const { report, status } = run({
      args: ["handover", "backfill-rulings", "--home", home, "--manifest", manifestPath, "--json"],
    });

    expect(status).toBe(0);
    expect(report.mode).toBe("plan");
    expect(report.counts["append"]).toBe(2);
    expect(report.counts["appended"]).toBe(0);
    expect(snapshot({ dir: home })).toEqual(before);
  });

  it("applies the manifest, and the audit then reads every row as decided", () => {
    const { home, manifestPath } = fixture();
    const docsBefore = snapshot({ dir: join(home, "handovers") });

    const applied = run({
      args: ["handover", "backfill-rulings", "--home", home, "--manifest", manifestPath, "--apply", "--json"],
    });

    expect(applied.status).toBe(0);
    expect(applied.report.counts["appended"]).toBe(2);
    expect(applied.report.entries.map((entry) => [entry.entry.slug, entry.status])).toEqual([
      ["a-row", "appended"],
      ["filed-row", "appended"],
    ]);
    // The row documents are untouched: a ruling lives in the register, never in the doc.
    expect(snapshot({ dir: join(home, "handovers") })).toEqual(docsBefore);

    const audited = run({ args: ["handover", "audit-rulings", "--home", home, "--manifest", manifestPath, "--json"] });
    expect(audited.status).toBe(0);
    expect(audited.report.counts["decided"]).toBe(2);
    expect(audited.report.counts["confirmedUnrepresented"]).toBe(0);
  });

  it("appends the answer's own instant as the decision, and keeps the source answer's line first", () => {
    const { home, manifestPath } = fixture();
    run({ args: ["handover", "backfill-rulings", "--home", home, "--manifest", manifestPath, "--apply", "--json"] });

    const lines = readFileSync(join(home, "runs", "a-row.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!)).toEqual({ answer: WORDS, atIso: SOURCE, kind: "answered" });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      anchor: ANCHOR,
      backfilledFrom: SOURCE,
      decidedIso: SOURCE,
      kind: "ruling",
      ruling: WORDS,
    });
  });

  it("changes not one byte on a second run over the same manifest", () => {
    const { home, manifestPath } = fixture();
    const args = ["handover", "backfill-rulings", "--home", home, "--manifest", manifestPath, "--apply", "--json"];
    run({ args });
    const afterFirst = snapshot({ dir: home });

    const again = run({ args });

    expect(again.status).toBe(0);
    expect(again.report.counts).toMatchObject({ alreadyRecorded: 2, appended: 0 });
    expect(snapshot({ dir: home })).toEqual(afterFirst);
  });

  it("refuses the row it cannot read, writes the other, and resumes when that row is repaired", () => {
    const { home, manifestPath } = fixture();
    const broken = join(home, "runs", "filed-row.jsonl");
    const good = readFileSync(broken, "utf8");
    writeFileSync(broken, `${good}{"kind":\n`);

    const first = run({
      args: ["handover", "backfill-rulings", "--home", home, "--manifest", manifestPath, "--apply", "--json"],
    });

    expect(first.status).toBe(1);
    expect(first.report.entries.map((entry) => entry.status)).toEqual(["appended", "refused"]);
    expect(readFileSync(broken, "utf8")).toBe(`${good}{"kind":\n`);

    writeFileSync(broken, good);
    const second = run({
      args: ["handover", "backfill-rulings", "--home", home, "--manifest", manifestPath, "--apply", "--json"],
    });

    expect(second.status).toBe(0);
    expect(second.report.counts).toMatchObject({ alreadyRecorded: 1, appended: 1 });
    const audited = run({ args: ["handover", "audit-rulings", "--home", home, "--manifest", manifestPath, "--json"] });
    expect(audited.report.counts["decided"]).toBe(2);
  });

  it("writes nothing at all when the manifest is not a manifest", () => {
    const { home, manifestPath } = fixture();
    const before = snapshot({ dir: home });
    writeFileSync(manifestPath, JSON.stringify([{ slug: "a-row" }]));

    const { report, status } = run({
      args: ["handover", "backfill-rulings", "--home", home, "--manifest", manifestPath, "--apply", "--json"],
    });

    expect(status).toBe(1);
    expect(report.counts["manifestEntries"]).toBe(0);
    expect(report.problems.map((problem) => problem.code)).toEqual(["MANIFEST_INVALID"]);
    expect(snapshot({ dir: join(home, "runs") })).toEqual(before.filter((line) => line.includes("/runs/")));
  });

  it("refuses to run at all without a manifest, before reading any state", () => {
    const { home } = fixture();
    const before = snapshot({ dir: home });

    expect(run({ args: ["handover", "backfill-rulings", "--home", home, "--apply"] }).status).toBe(2);
    expect(run({ args: ["handover", "backfill-rulings", "--home", home, "--manifest", ""] }).status).toBe(2);
    expect(run({ args: ["handover", "backfill-rulings", "--home", home, "--readers-ready"] }).status).toBe(2);
    expect(snapshot({ dir: home })).toEqual(before);
  });

  it("prints the human read with one line per reviewed answer", () => {
    const { home, manifestPath } = fixture();

    const { stdout, status } = run({
      args: ["handover", "backfill-rulings", "--home", home, "--manifest", manifestPath],
    });

    expect(status).toBe(0);
    expect(stdout).toContain("RULING BACKFILL — PLAN");
    expect(stdout).toContain(`would append   a-row #${SOURCE}`);
  });
});
