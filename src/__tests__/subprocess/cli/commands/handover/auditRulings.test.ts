/**
 * `handover audit-rulings` run as the shipped verb, over a throwaway home — the reader the ruling-derivation
 * gold proof will run through, so what is asserted here is that it can FAIL.
 *
 * Each control changes exactly one thing from the decided fixture and requires a named code and a non-zero
 * exit. A reader that answered "decided" on text equality, on a partially-read journal, or on a row it never
 * found would pass a proof that proved nothing, and each of those is a case below.
 *
 * `SLOPWEAVER_CLI_DIR` is set deliberately: `bin/slopweaver` otherwise resolves its checkout from an ambient
 * `PLUGIN_ROOT`, and a proof run from a worktree would silently exercise the main checkout instead.
 */

import { Buffer } from "node:buffer";
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
const TODAY = "2026-09-13T02:00:00.000Z";
const WORDS = "OWNER RULED: ship it";
const ANCHOR = "https://example.invalid/p9";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One JSONL line. */
function line({ event }: { event: Record<string, unknown> }): string {
  return `${JSON.stringify(event)}\n`;
}

/** The reconstruction the backfill will write, with any field overridden. */
function ruling(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    anchor: ANCHOR,
    atIso: TODAY,
    backfilledFrom: SOURCE,
    decidedIso: SOURCE,
    kind: "ruling",
    ruling: WORDS,
    ...over,
  };
}

/**
 * A home with one active row and one archived row, each with an answered event the manifest names, plus
 * whatever extra journal lines the scenario appends to the active row.
 */
function fixture({ extra = [] }: { extra?: readonly Record<string, unknown>[] } = {}): {
  home: string;
  manifestPath: string;
  activeDoc: string;
} {
  const home = mkdtempSync(join(tmpdir(), "audit-rulings-"));
  homes.push(home);
  mkdirSync(join(home, "handovers", "archive"), { recursive: true });
  mkdirSync(join(home, "runs"));
  const activeDoc = join(home, "handovers", "a-row.md");
  writeFileSync(activeDoc, "---\nslug: a-row\nsummary: an active row\n---\n");
  writeFileSync(
    join(home, "handovers", "archive", "filed-row.md"),
    "---\nslug: filed-row\nsummary: a filed row\n---\n",
  );
  writeFileSync(
    join(home, "runs", "a-row.jsonl"),
    line({ event: { answer: WORDS, atIso: SOURCE, kind: "answered" } }) +
      extra.map((event) => line({ event })).join(""),
  );
  writeFileSync(
    join(home, "runs", "filed-row.jsonl"),
    line({ event: { answer: "OWNER RULED: file it", atIso: ARCHIVED_SOURCE, kind: "answered" } }) +
      line({
        event: {
          anchor: "file:/scratch/turn.txt",
          atIso: TODAY,
          backfilledFrom: ARCHIVED_SOURCE,
          decidedIso: ARCHIVED_SOURCE,
          kind: "ruling",
          ruling: "OWNER RULED: file it",
        },
      }),
  );
  const manifestPath = join(home, "manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      entries: [
        { anchor: ANCHOR, slug: "a-row", sourceAtIso: SOURCE, words: WORDS },
        {
          anchor: "file:/scratch/turn.txt",
          slug: "filed-row",
          sourceAtIso: ARCHIVED_SOURCE,
          words: "OWNER RULED: file it",
        },
      ],
      schemaVersion: 1,
    }),
  );
  return { activeDoc, home, manifestPath };
}

interface Report {
  complete: boolean;
  counts: Record<string, number>;
  manifest: { status: string; slug: string; placement?: string; codes?: string[] }[];
  problems: { code: string; slug: string | null }[];
}

/** Run the real verb and decode its report. */
function audit({ args }: { args: readonly string[] }): { status: number; report: Report; stdout: string } {
  const result = spawnSync(BIN, ["handover", "audit-rulings", ...args], {
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
  const json = args.includes("--json") ? (JSON.parse(result.stdout) as Report) : ({} as Report);
  return { report: json, status: absentAsNumber({ value: result.status, whenAbsent: -1 }), stdout: result.stdout };
}

/** Every file under a directory, with its bytes, so a read-only claim is falsifiable. */
function snapshot({ dir }: { dir: string }): readonly string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map(
      (entry) => `${join(entry.parentPath, entry.name)}: ${readFileSync(join(entry.parentPath, entry.name), "utf8")}`,
    )
    .toSorted();
}

describe("handover audit-rulings", () => {
  it("reads every manifest entry as decided once its reconstruction is on the journal, and writes nothing", () => {
    const { home, manifestPath } = fixture({ extra: [ruling()] });
    const before = snapshot({ dir: home });

    const { report, status } = audit({ args: ["--home", home, "--manifest", manifestPath, "--json"] });

    expect(status).toBe(0);
    expect(report.complete).toBe(true);
    expect(report.counts["decided"]).toBe(2);
    expect(report.counts["confirmedUnrepresented"]).toBe(0);
    expect(report.manifest.map((check) => [check.slug, check.status, check.placement])).toEqual([
      ["a-row", "decided", "effective"],
      ["filed-row", "decided", "effective"],
    ]);
    expect(snapshot({ dir: home })).toEqual(before);
  });

  it("reports a reviewed answer nothing has reconstructed as unrepresented, over COMPLETE input", () => {
    const { home, manifestPath } = fixture();

    const { report, status } = audit({ args: ["--home", home, "--manifest", manifestPath, "--json"] });

    expect(status).toBe(1);
    expect(report.complete).toBe(true);
    expect(report.manifest[0]).toEqual({
      entryIndex: 0,
      slug: "a-row",
      sourceAtIso: SOURCE,
      status: "confirmed-unrepresented",
    });
  });

  it("keeps an entry decided under a later live ruling, as history rather than as the current one", () => {
    const later = {
      anchor: "https://example.invalid/later",
      atIso: TODAY,
      decidedIso: TODAY,
      kind: "ruling",
      ruling: "actually, wait",
    };
    const { home, manifestPath } = fixture({ extra: [ruling(), later] });

    const { report, status } = audit({ args: ["--home", home, "--manifest", manifestPath, "--json"] });

    expect(status).toBe(0);
    expect(report.manifest[0]!.placement).toBe("historical");
    expect(report.counts["historical"]).toBe(1);
  });

  it("refuses a reconstruction whose anchor was changed after it was written", () => {
    const { home, manifestPath } = fixture({ extra: [ruling({ anchor: "https://example.invalid/elsewhere" })] });

    const { report, status } = audit({ args: ["--home", home, "--manifest", manifestPath, "--json"] });

    expect(status).toBe(1);
    expect(report.manifest[0]!.codes).toEqual(["RULING_ANCHOR_MISMATCH"]);
  });

  it("does not accept a live ruling with the same words — it names no source", () => {
    const { home, manifestPath } = fixture({ extra: [ruling({ backfilledFrom: undefined, decidedIso: SOURCE })] });

    const { report, status } = audit({ args: ["--home", home, "--manifest", manifestPath, "--json"] });

    expect(status).toBe(1);
    expect(report.manifest[0]!.status).toBe("confirmed-unrepresented");
  });

  it("refuses to certify a row whose journal has a line it could not decode", () => {
    const { home, manifestPath } = fixture({ extra: [ruling()] });
    writeFileSync(
      join(home, "runs", "a-row.jsonl"),
      `${readFileSync(join(home, "runs", "a-row.jsonl"), "utf8")}{"kind":\n`,
    );

    const { report, status } = audit({ args: ["--home", home, "--manifest", manifestPath, "--json"] });

    expect(status).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.problems.map((problem) => problem.code)).toEqual(["JOURNAL_LINE_UNREADABLE"]);
    expect(report.manifest[0]!.codes).toEqual(["JOURNAL_LINE_UNREADABLE"]);
  });

  it("reads the board somewhere else with --dir while journals stay in the home, and says the rows are missing", () => {
    const { home, manifestPath } = fixture({ extra: [ruling()] });
    const elsewhere = mkdtempSync(join(tmpdir(), "audit-rulings-board-"));
    homes.push(elsewhere);

    const { report, status } = audit({
      args: ["--home", home, "--dir", elsewhere, "--manifest", manifestPath, "--json"],
    });

    expect(status).toBe(1);
    expect(report.problems.map((problem) => [problem.code, problem.slug])).toEqual([
      ["ROW_MISSING", "a-row"],
      ["ROW_MISSING", "filed-row"],
    ]);
  });

  it("accounts for the register with no manifest at all, and exits 0 on readable input", () => {
    const { home } = fixture({ extra: [ruling()] });

    const { report, status, stdout } = audit({ args: ["--home", home, "--json"] });

    expect(status).toBe(0);
    expect(report.counts["manifestEntries"]).toBe(0);
    expect(report.counts["effective"]).toBe(2);
    expect(stdout).toContain('"candidates":0');
  });

  it("prints the human read with the candidate notice, so a zero never reads as a completed search", () => {
    const { home, manifestPath } = fixture({ extra: [ruling()] });

    const { stdout, status } = audit({ args: ["--home", home, "--manifest", manifestPath] });

    expect(status).toBe(0);
    expect(stdout).toContain("RULING AUDIT — COMPLETE INPUT");
    expect(stdout).toContain(`decided        a-row #${SOURCE}`);
    expect(stdout).toContain("Candidate discovery is not performed");
  });

  /**
   * `readFileSync(path, "utf8")` substitutes an invalid byte rather than failing, so a ruling reading
   * `ship <0xFF> it` decodes cleanly into text that is not the text on disk. Found by a review pass, which
   * reproduced a clean exit 0 over it.
   */
  it("refuses to certify a journal carrying a byte the decoder had to replace", () => {
    const { home, manifestPath } = fixture({ extra: [ruling()] });
    const journal = join(home, "runs", "a-row.jsonl");
    const head =
      '{"anchor":"p1","atIso":"2026-09-14T00:00:00.000Z","decidedIso":"2026-09-14T00:00:00.000Z","kind":"ruling","ruling":"ship ';
    writeFileSync(
      journal,
      Buffer.concat([readFileSync(journal), Buffer.from(head), Buffer.from([0xff]), Buffer.from(' it"}\n')]),
    );

    const { report, status } = audit({ args: ["--home", home, "--manifest", manifestPath, "--json"] });

    expect(status).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.problems.map((problem) => problem.code)).toEqual(["JOURNAL_BYTES_REPLACED"]);
  });

  it("refuses a flag it does not have, before reading anything", () => {
    const { home } = fixture();
    expect(audit({ args: ["--home", home, "--fix"] }).status).toBe(2);
    expect(audit({ args: ["--home", home, "--manifest", ""] }).status).toBe(2);
  });
});
