/**
 * The writer criterion: which tokens in a brief name a path the reading seat cannot root.
 *
 * The first case is the incident itself, quoted from the row that caused it — `summary:` line 4 of
 * `$SLOPWEAVER_HOME/handovers/docs-site-twenty-pages-twenty-diagrams-and-a-live-console.md`.
 * It is written here with its trailing `)` and without backticks, because that is how it was written there,
 * and a scanner that read only backticked tokens would have let it through.
 */
// The pronoun-heading cases went out with the matcher that read it.
import { describe, expect, it } from "vitest";

import { briefText, unrootedBriefPaths } from "../../../handover/briefPaths.js";

/** The state home's top level, as measured on this install — enough of it to exercise every case below. */
const STATE = ["supervisor-scratch", "pages", "ledgers", "handovers", "logs", "live", "secrets", "bin", "eval"];

/** The repository root's top level — `bin` and `eval` are in BOTH, which is what the difference protects. */
const REPO = ["src", "docs", "skills", "bin", "eval", "config", "AGENTS.md"];

/** Ask the criterion with this install's two measured name sets. */
function offenders({ text }: { text: string }): readonly string[] {
  return unrootedBriefPaths({ repoEntries: REPO, stateEntries: STATE, text });
}

describe("unrootedBriefPaths", () => {
  it("reports the incident token, unbackticked and with its trailing bracket, exactly as the row carried it", () => {
    const text = "use the old Slopweaver logo (image in supervisor-scratch/handoff-9291/owner-turn-291-18-images);";
    expect(offenders({ text })).toEqual(["supervisor-scratch/handoff-9291/owner-turn-291-18-images"]);
  });

  it("reports a backticked token too, with the backticks stripped", () => {
    expect(offenders({ text: "read `ledgers/autonomy.jsonl` first" })).toEqual(["ledgers/autonomy.jsonl"]);
  });

  it("exempts a first segment that is in BOTH top levels — the difference, not plain state membership", () => {
    expect(offenders({ text: "run bin/slopweaver catalog and eval/suite.ts" })).toEqual([]);
  });

  it("exempts a repo-rooted path", () => {
    expect(offenders({ text: "src/lib/result.ts and docs/store.md and skills/github/SKILL.md" })).toEqual([]);
  });

  it("exempts the state: prefix, which is the legal spelling", () => {
    expect(offenders({ text: "read state:supervisor-scratch/handoff-9291/notes.md" })).toEqual([]);
  });

  it("exempts an absolute path, a ~ path, a ./ path and a ../ path", () => {
    const text = "/Users/x/.slopweaver/pages/y ~/pages/y ./pages/y ../pages/y";
    expect(offenders({ text })).toEqual([]);
  });

  it("exempts a URL whose path happens to open on a state-home name", () => {
    expect(offenders({ text: "see https://example.com/pages/owner-turn-291-18-images" })).toEqual([]);
  });

  it("exempts ordinary prose that carries a slash", () => {
    expect(offenders({ text: "and/or 24/7 she/they 9/21 read/write" })).toEqual([]);
  });

  it("exempts a flag and a bare slug, neither of which is a path", () => {
    expect(offenders({ text: "--pages/x owner-turn-291-18-images pages" })).toEqual([]);
  });

  it("reports each distinct token once, in the order the brief names them", () => {
    const text = "logs/a.err then ledgers/b.jsonl then logs/a.err again";
    expect(offenders({ text })).toEqual(["logs/a.err", "ledgers/b.jsonl"]);
  });

  it("answers empty when the state set is empty — a fresh install has nothing to be relative to", () => {
    const text = "supervisor-scratch/handoff-9291/owner-turn-291-18-images";
    expect(unrootedBriefPaths({ repoEntries: REPO, stateEntries: [], text })).toEqual([]);
  });
});

describe("briefText", () => {
  const DOC = [
    "---",
    'summary: "logo in supervisor-scratch/handoff-9291/x"',
    "status: ready",
    "---",
    "",
    "# A title naming pages/heading-only.md",
    "",
    "## What the owner asked for",
    "",
    "put it next to ledgers/asked.jsonl",
    "",
    "## How this ends",
    "",
    "settle it, see logs/ending.err",
  ].join("\n");

  it("takes the front matter and the chair's own section, and nothing else", () => {
    expect(offenders({ text: briefText({ docText: DOC }) })).toEqual([
      "supervisor-scratch/handoff-9291/x",
      "ledgers/asked.jsonl",
    ]);
  });

  it("leaves a token in a later section alone — the doc body is a session's notes, not the chair's brief", () => {
    expect(briefText({ docText: DOC })).not.toContain("logs/ending.err");
  });

  it("reads no section under a heading that is not the register's own", () => {
    const renamed = DOC.replace("## What the owner asked for", "## What somebody asked for");
    expect(renamed).not.toBe(DOC);
    expect(briefText({ docText: renamed })).not.toContain("put it next to ledgers/asked.jsonl");
  });

  it("answers empty for a doc with neither front matter nor that section", () => {
    expect(briefText({ docText: "# just a heading\n\nsome prose\n" })).toBe("");
  });
});
