/**
 * `readCorpusTally` — the reader that accounts for every row instead of returning only the ones that worked.
 * A filesystem round-trip over a `mkdtempSync` fixture, which `testing.md` allows.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCorpusDir, readCorpusTally } from "../../../corpus/corpusDirRead.js";
import { resolveCorpusDir } from "../../../corpus/corpusResolve.js";
import { type CorpusGroupTally } from "../../../corpus/corpusTallyCore.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    chmodSync(root, 0o755);
    rmSync(root, { force: true, recursive: true });
  }
});

const validRow = JSON.stringify({
  container: "c",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "s1",
  text: "hi",
  tsIso: "2026-08-01T00:00:00.000Z",
  url: "https://example.test/s1",
});

/** A temp corpus root holding `<group>/w.jsonl` for each entry. */
function corpusRoot({ files }: { files: Record<string, string> }): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-tally-"));
  roots.push(root);
  for (const [group, content] of Object.entries(files)) {
    const dir = join(root, group);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "w.jsonl"), content, "utf8");
  }
  return root;
}

/** The tally for a group, or a throwing lookup — never a conditional inside an assertion. */
function groupNamed({ tallies, name }: { tallies: readonly CorpusGroupTally[]; name: string }): CorpusGroupTally {
  return tallies.find((tally) => tally.group === name)!;
}

describe("readCorpusTally", () => {
  it("counts every non-blank row, and groups the skips by class rather than by line", () => {
    const root = corpusRoot({
      files: { slack: [validRow, "not json", "not json either", '{"source":"slack","kind":"nope"}', ""].join("\n") },
    });
    const slack = groupNamed({
      name: "slack",
      tallies: unwrap(readCorpusTally({ dir: root, home: root, protection: () => ok([]) })).tallies,
    });
    expect(slack.rows).toBe(4);
    expect(slack.records).toHaveLength(1);
    expect(slack.skipped).toEqual([
      { count: 2, reason: "invalid-json" },
      { count: 1, reason: "unknown-kind" },
    ]);
    expect(slack.unreadable).toEqual([]);
  });

  it("names an unreadable file instead of throwing the whole read away", () => {
    const root = corpusRoot({ files: { github: validRow, slack: validRow } });
    chmodSync(join(root, "slack", "w.jsonl"), 0o000);
    const tallies = unwrap(readCorpusTally({ dir: root, home: root, protection: () => ok([]) })).tallies;
    expect(groupNamed({ name: "slack", tallies }).unreadable).toEqual([join(root, "slack", "w.jsonl")]);
    expect(groupNamed({ name: "github", tallies }).records).toHaveLength(1);
  });

  it("groups a file sitting directly in the root under `(root)`", () => {
    const root = mkdtempSync(join(tmpdir(), "slopweaver-tally-flat-"));
    roots.push(root);
    writeFileSync(join(root, "flat.jsonl"), `${validRow}\n`, "utf8");
    const tallies = unwrap(readCorpusTally({ dir: root, home: root, protection: () => ok([]) })).tallies;
    expect(tallies.map((tally) => tally.group)).toEqual(["(root)"]);
  });

  it("treats a missing dir as empty with a warning, not an error", () => {
    const home = corpusRoot({ files: {} });
    const result = unwrap(
      readCorpusTally({ dir: join(home, "slopweaver-tally-does-not-exist"), home, protection: () => ok([]) }),
    );
    expect(result.tallies).toEqual([]);
    expect(result.warnings[0]).toContain("corpus dir not found");
  });
});

describe("readCorpusDir over the tally", () => {
  it("still returns a flat record list with per-line warnings prefixed by the file", () => {
    const root = corpusRoot({ files: { slack: `${validRow}\nnot json at all\n` } });
    const result = unwrap(readCorpusDir({ dir: root, home: root, protection: () => ok([]) }));
    expect(result.records).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("w.jsonl");
  });

  it("warns rather than throwing when a file cannot be read", () => {
    const root = corpusRoot({ files: { slack: validRow } });
    chmodSync(join(root, "slack", "w.jsonl"), 0o000);
    const result = unwrap(readCorpusDir({ dir: root, home: root, protection: () => ok([]) }));
    expect(result.records).toEqual([]);
    expect(result.warnings[0]).toContain("unreadable");
  });
});

describe("resolveCorpusDir", () => {
  it("says `no corpus found` when the tree is genuinely empty", () => {
    const root = mkdtempSync(join(tmpdir(), "slopweaver-tally-none-"));
    roots.push(root);
    expect(unwrapErr(resolveCorpusDir({ corpus: root, home: root, protection: () => ok([]) })).message).toContain(
      "no corpus found",
    );
  });

  it("says `could not be read` when the tree exists but cannot be listed", () => {
    const root = corpusRoot({ files: { slack: validRow } });
    chmodSync(root, 0o000);
    expect(unwrapErr(resolveCorpusDir({ corpus: root, home: root, protection: () => ok([]) })).message).toContain(
      "could not be read",
    );
  });
});
