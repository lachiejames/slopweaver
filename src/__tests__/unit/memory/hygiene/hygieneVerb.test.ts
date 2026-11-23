/**
 * THE VERBS — `slopweaver memory hygiene` and `memory grade`, run end to end over throwaway directories.
 *
 * What earns this file its place over the module tests beside it is that it exercises the SHIPPED runner: the
 * flag resolution, the quiet period, the report write, the ledger append and the exit code, in the order the
 * scheduler gets them. Every module below it can be right while the verb is wired to nothing.
 *
 * Three properties the exit codes carry, each with its own case, because a scheduler reads them and they are not
 * interchangeable (`.claude/rules/area-cli.md` § Exit codes):
 *
 *  - **4 is NOT YET** — the corpus changed inside the quiet period, so the run did nothing and the recipe row
 *    must still be due. Driven by `--now` rather than by a sleep.
 *  - **3 is nothing to propose** — the run DID its work and there was none.
 *  - **0 is proposals to read**, and the report on disk is what they are.
 *
 * Every directory here is minted with `mkdtempSync` and removed, and every run passes `--home`, so nothing
 * touches the ambient `$SLOPWEAVER_HOME`.
 *
 * Everything in the fixtures is invented. This is a public repository, and a fixture is the easiest place for a
 * private string to arrive unnoticed.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MEMORY_GRADE_FLAG_NAMES,
  MEMORY_HYGIENE_FLAG_NAMES,
  parseMemoryGradeArgs,
  parseMemoryHygieneArgs,
  runMemoryGrade,
  runMemoryHygieneWith,
} from "../../../../cli/commands/memory/hygiene.js";
import type { KnowledgeReader } from "../../../../cli/commands/memory/hygieneInputs.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { err, ok } from "../../../../lib/result.js";
import type { KnowledgeRecording } from "../../../../memory/hygiene/knowledgeRows.js";
import { parseHygieneRows, readHygieneLedgerRows } from "../../../../memory/hygiene/ledger.js";
import { referentSubject } from "../../../../memory/hygiene/proposalId.js";

/** Far enough past every fixture's mtime to clear the quiet period without a sleep. */
const SETTLED_NOW = "2099-01-02T08:00:00.000Z";

/** The argv shape the runtime hands a verb: node, the binary, the noun, the verb, then the flags. */
function argvOf({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "memory", verb, ...rest];
}

/** One invented lesson recording, with every field the referent arm does not read held constant. */
function recording({ id, claim }: { id: string; claim: string }): KnowledgeRecording {
  return {
    behaviourChange: null,
    caveat: null,
    claim,
    evidence: "an invented observation",
    id,
    kind: "lesson",
    recordedAt: new Date("2099-01-01T00:00:00.000Z"),
    repro: null,
    retrievalCue: null,
    seq: 1,
    supersedes: null,
  };
}

/**
 * The shipped runner with the memories table replaced by a plain function answering `recordings` — a seam, not
 * a mock: the unit lane never reaches a database.
 */
function hygiene({
  argv,
  recordings = [],
}: {
  argv: readonly string[];
  recordings?: readonly KnowledgeRecording[];
}): Promise<number> {
  return runMemoryHygieneWith({ argv, readKnowledge: () => Promise.resolve(ok(recordings)) });
}

describe("the memory hygiene verbs", () => {
  let home = "";
  let dir = "";
  let repo = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hyg-home-"));
    dir = mkdtempSync(join(tmpdir(), "hyg-corpus-"));
    repo = mkdtempSync(join(tmpdir(), "hyg-repo-"));
  });

  afterEach(() => {
    [home, dir, repo].forEach((path) => {
      rmSync(path, { force: true, recursive: true });
    });
  });

  /** Write a leaf, and route it from the root index. */
  function writeCorpus({ leaves }: { leaves: readonly { stem: string; description: string; body: string }[] }): void {
    const pointers = leaves.map((leaf) => `- [${leaf.stem}](${leaf.stem}.md) — a fact`).join("\n");
    writeFileSync(join(dir, "MEMORY.md"), `# Index\n\n${pointers}\n`, "utf8");
    leaves.forEach((leaf) => {
      const frontmatter = `---\nname: ${leaf.stem}\ndescription: ${leaf.description}\nmetadata:\n  type: project\n---`;
      // Root-routed, so each opens with the paragraph `why-always-loaded-missing` wants — else every leaf is a proposal.
      const why = `**Why always-loaded:** ${leaf.stem} applies at boot.`;
      writeFileSync(join(dir, `${leaf.stem}.md`), `${frontmatter}\n\n${why}\n\n${leaf.body}\n`, "utf8");
    });
  }

  /** The report the run wrote, for the day `SETTLED_NOW` falls on. */
  function reportText(): string {
    return readFileSync(join(home, "morning", `memory-hygiene-${SETTLED_NOW.slice(0, 10)}.md`), "utf8");
  }

  it("prints its usage for --help without reading anything", async () => {
    expect(await hygiene({ argv: argvOf({ rest: ["--help"], verb: "hygiene" }) })).toBe(EXIT_OK);
    expect(runMemoryGrade(argvOf({ rest: ["--help"], verb: "grade" }))).toBe(EXIT_OK);
  });

  it("refuses a run with no --dir or --repo as a caller mistake, before any act", async () => {
    expect(await hygiene({ argv: argvOf({ rest: [], verb: "hygiene" }) })).toBe(EXIT_USAGE);
    expect(await hygiene({ argv: argvOf({ rest: ["--dir", dir], verb: "hygiene" }) })).toBe(EXIT_USAGE);
    const relative = argvOf({ rest: ["--dir", "relative/path", "--repo", repo], verb: "hygiene" });
    expect(await hygiene({ argv: relative })).toBe(EXIT_USAGE);
    const relativeAlso = argvOf({ rest: ["--dir", dir, "--repo", repo, "--also-repo", "sibling"], verb: "hygiene" });
    expect(await hygiene({ argv: relativeAlso })).toBe(EXIT_USAGE);
  });

  it("refuses an unparseable --now rather than judging against NaN", async () => {
    writeCorpus({ leaves: [{ body: "A fact.", description: "an invented pelican fact", stem: "pelican" }] });
    const argv = argvOf({ rest: ["--dir", dir, "--repo", repo, "--now", "tuesday"], verb: "hygiene" });
    expect(await hygiene({ argv })).toBe(EXIT_USAGE);
  });

  it("DEFERS when the corpus changed inside the quiet period, writing nothing", async () => {
    writeCorpus({ leaves: [{ body: "A fact.", description: "an invented pelican fact", stem: "pelican" }] });
    const argv = argvOf({ rest: ["--dir", dir, "--home", home, "--repo", repo], verb: "hygiene" });
    expect(await hygiene({ argv })).toBe(EXIT_DEFERRED);
    expect(readHygieneLedgerRows({ home })).toEqual([]);
  });

  it("reports an expected-empty run over a corpus with nothing to propose", async () => {
    writeCorpus({
      leaves: [
        { body: "Batch them.", description: "an invented pelican fact", stem: "pelican-batching" },
        { body: "Tolerate it.", description: "an unrelated quokka habit", stem: "quokka-tolerance" },
      ],
    });
    const argv = argvOf({
      rest: ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", repo],
      verb: "hygiene",
    });
    expect(await hygiene({ argv })).toBe(EXIT_EXPECTED_EMPTY);
    expect(reportText()).toContain("Nothing to propose.");
    expect(readHygieneLedgerRows({ home })).toEqual([]);
  });

  it("proposes a schema defect, writes the evidence, and records one proposed row", async () => {
    writeCorpus({
      leaves: [
        { body: "See [[absent-memory]].", description: "an invented pelican fact", stem: "pelican-batching" },
        { body: "Tolerate it.", description: "an unrelated quokka habit", stem: "quokka-tolerance" },
      ],
    });
    const argv = argvOf({
      rest: ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", repo],
      verb: "hygiene",
    });
    expect(await hygiene({ argv })).toBe(EXIT_OK);
    const text = reportText();
    expect(text).toContain("# Memory hygiene");
    expect(text).toContain("### adjust · pelican-batching.md");
    expect(text).toContain("dangling-wikilink");
    const rows = readHygieneLedgerRows({ home });
    expect(rows.map((row) => [row.check, row.subject, row.disposition, row.recommendation])).toEqual([
      ["schema", "pelican-batching.md", "proposed", "adjust"],
    ]);
    expect(rows[0]!.tsIso).toBe(SETTLED_NOW);
  });

  it("emits the report as JSON when asked, and proposes the same thing either way", async () => {
    writeCorpus({
      leaves: [{ body: "See [[absent-memory]].", description: "an invented pelican fact", stem: "pelican-batching" }],
    });
    const rest = ["--dir", dir, "--home", home, "--json", "--now", SETTLED_NOW, "--repo", repo];
    expect(await hygiene({ argv: argvOf({ rest, verb: "hygiene" }) })).toBe(EXIT_OK);
    expect(reportText()).toContain("### adjust · pelican-batching.md");
  });

  it("reports an unreadable corpus as an error rather than as an empty one", async () => {
    const argv = argvOf({
      rest: ["--dir", join(dir, "absent"), "--home", home, "--now", SETTLED_NOW, "--repo", repo],
      verb: "hygiene",
    });
    expect(await hygiene({ argv })).toBe(EXIT_ERROR);
  });

  it("reports a --repo or an --also-repo that is not a directory as an error", async () => {
    writeCorpus({ leaves: [{ body: "A fact.", description: "an invented pelican fact", stem: "pelican" }] });
    const argv = argvOf({
      rest: ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", join(repo, "absent")],
      verb: "hygiene",
    });
    expect(await hygiene({ argv })).toBe(EXIT_ERROR);
    const also = argvOf({
      rest: ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", repo, "--also-repo", join(repo, "absent")],
      verb: "hygiene",
    });
    expect(await hygiene({ argv: also })).toBe(EXIT_ERROR);
  });

  it("proposes a knowledge row naming a gone file and a gone skill, and names the row it came from", async () => {
    writeCorpus({ leaves: [{ body: "A fact.", description: "an invented pelican fact", stem: "pelican" }] });
    const argv = argvOf({
      rest: ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", repo],
      verb: "hygiene",
    });
    const recordings = [
      recording({ claim: "The burst lives in `src/gone/burst.ts`; run `/slopweaver:gone-skill`.", id: "burst-row" }),
    ];
    expect(await hygiene({ argv, recordings })).toBe(EXIT_OK);
    const rows = readHygieneLedgerRows({ home });
    // Within one check the ranker orders by recurrence then subject, not by where the row names each referent.
    expect(rows.map((row) => [row.check, row.subject])).toEqual([
      ["referent-gone", referentSubject({ file: "knowledge:burst-row", referent: "skills/gone-skill" })],
      ["referent-gone", referentSubject({ file: "knowledge:burst-row", referent: "src/gone/burst.ts" })],
    ]);
    expect(reportText()).toContain("over 1 memories and 1 knowledge row(s)");
  });

  it("reads a knowledge row's PROSE path only under a checkout's top-level directory", async () => {
    writeCorpus({ leaves: [{ body: "A fact.", description: "an invented pelican fact", stem: "pelican" }] });
    mkdirSync(join(repo, "src"), { recursive: true });
    const argv = argvOf({
      rest: ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", repo],
      verb: "hygiene",
    });
    const recordings = [
      recording({ claim: "It lived in src/gone/burst.ts, beside kit/elsewhere.ts.", id: "prose-row" }),
    ];
    expect(await hygiene({ argv, recordings })).toBe(EXIT_OK);
    expect(readHygieneLedgerRows({ home }).map((row) => [row.check, row.subject])).toEqual([
      ["referent-gone", referentSubject({ file: "knowledge:prose-row", referent: "src/gone/burst.ts" })],
    ]);
  });

  it("resolves a knowledge row's path against --also-repo, so a sibling checkout's file is not gone", async () => {
    writeCorpus({ leaves: [{ body: "A fact.", description: "an invented pelican fact", stem: "pelican" }] });
    const sibling = mkdtempSync(join(tmpdir(), "hyg-sibling-"));
    mkdirSync(join(sibling, "apps"), { recursive: true });
    writeFileSync(join(sibling, "apps", "held.ts"), "export {};\n", "utf8");
    const recordings = [recording({ claim: "It is in `apps/held.ts`.", id: "sibling-row" })];
    const rest = ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", repo];
    expect(await hygiene({ argv: argvOf({ rest, verb: "hygiene" }), recordings })).toBe(EXIT_OK);
    const withSibling = argvOf({ rest: [...rest, "--also-repo", sibling], verb: "hygiene" });
    const clean = mkdtempSync(join(tmpdir(), "hyg-home-"));
    const cleanRest = withSibling.map((part) => (part === home ? clean : part));
    expect(await hygiene({ argv: cleanRest, recordings })).toBe(EXIT_EXPECTED_EMPTY);
    rmSync(sibling, { force: true, recursive: true });
    rmSync(clean, { force: true, recursive: true });
  });

  it("judges the corpus, writes the report, and still exits 1 when the memories table cannot be read", async () => {
    writeCorpus({
      leaves: [{ body: "See [[absent-memory]].", description: "an invented pelican fact", stem: "pelican-batching" }],
    });
    const argv = argvOf({
      rest: ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", repo],
      verb: "hygiene",
    });
    const unreachable: KnowledgeReader = () => Promise.resolve(err("the store is not running"));
    expect(await runMemoryHygieneWith({ argv, readKnowledge: unreachable })).toBe(EXIT_ERROR);
    expect(reportText()).toContain(
      "- the knowledge rows were NOT read, so none of them was judged: the store is not running",
    );
    expect(readHygieneLedgerRows({ home }).map((row) => row.subject)).toEqual(["pelican-batching.md"]);
  });

  it("grades a proposal the run recorded, and refuses one it never made", async () => {
    writeCorpus({
      leaves: [{ body: "See [[absent-memory]].", description: "an invented pelican fact", stem: "pelican-batching" }],
    });
    const argv = argvOf({
      rest: ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", repo],
      verb: "hygiene",
    });
    expect(await hygiene({ argv })).toBe(EXIT_OK);
    const id = readHygieneLedgerRows({ home })[0]!.id;
    const unknown = ["deadbeef0000", "refused", "--home", home, "--why", "never proposed"];
    expect(runMemoryGrade(argvOf({ rest: unknown, verb: "grade" }))).toBe(EXIT_USAGE);
    const graded = argvOf({ rest: [id, "refused", "--home", home, "--why", "the link is deliberate"], verb: "grade" });
    expect(runMemoryGrade(graded)).toBe(EXIT_OK);
    const answered = readHygieneLedgerRows({ home }).filter((row) => row.disposition === "refused");
    expect(answered.map((row) => [row.id, row.why])).toEqual([[id, "the link is deliberate"]]);
  });

  it("refuses a grade with no id, no answer word, an unknown answer word, or no reason", () => {
    const why = ["--why", "it stands"];
    expect(runMemoryGrade(argvOf({ rest: ["--home", home, ...why], verb: "grade" }))).toBe(EXIT_USAGE);
    expect(runMemoryGrade(argvOf({ rest: ["deadbeef0000", "--home", home, ...why], verb: "grade" }))).toBe(EXIT_USAGE);
    expect(runMemoryGrade(argvOf({ rest: ["deadbeef0000", "pondered", "--home", home, ...why], verb: "grade" }))).toBe(
      EXIT_USAGE,
    );
    // The reason is required, and blank is not a reason: a terminal refusal with nothing in it is a vote the
    // next run cannot act on. Refused BEFORE the ledger is read, so an id that exists does not rescue it.
    expect(runMemoryGrade(argvOf({ rest: ["deadbeef0000", "refused", "--home", home], verb: "grade" }))).toBe(
      EXIT_USAGE,
    );
    const blank = ["deadbeef0000", "refused", "--home", home, "--why", "  "];
    expect(runMemoryGrade(argvOf({ rest: blank, verb: "grade" }))).toBe(EXIT_USAGE);
  });

  it("does not re-propose a refused proposal on the next run", async () => {
    writeCorpus({
      leaves: [{ body: "See [[absent-memory]].", description: "an invented pelican fact", stem: "pelican-batching" }],
    });
    const argv = argvOf({
      rest: ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", repo],
      verb: "hygiene",
    });
    expect(await hygiene({ argv })).toBe(EXIT_OK);
    const id = readHygieneLedgerRows({ home })[0]!.id;
    const graded = argvOf({ rest: [id, "refused", "--home", home, "--why", "the link is deliberate"], verb: "grade" });
    expect(runMemoryGrade(graded)).toBe(EXIT_OK);
    expect(await hygiene({ argv })).toBe(EXIT_EXPECTED_EMPTY);
    expect(reportText()).toContain("Nothing to propose.");
  });

  it("reads a ledger a process died mid-append to, rather than failing the whole run", async () => {
    mkdirSync(join(home, "ledgers", "memory"), { recursive: true });
    writeFileSync(join(home, "ledgers", "memory", "hygiene.jsonl"), '{"check":"schema","dispos', "utf8");
    expect(readHygieneLedgerRows({ home })).toEqual([]);
    writeCorpus({
      leaves: [{ body: "See [[absent-memory]].", description: "an invented pelican fact", stem: "pelican-batching" }],
    });
    const argv = argvOf({
      rest: ["--dir", dir, "--home", home, "--now", SETTLED_NOW, "--repo", repo],
      verb: "hygiene",
    });
    expect(await hygiene({ argv })).toBe(EXIT_OK);
  });
});

describe("the flag surface", () => {
  it("names every flag the runner really parses, so the help-truth ratchet reads the real spec", () => {
    expect(MEMORY_HYGIENE_FLAG_NAMES).toEqual(["--also-repo", "--dir", "--home", "--json", "--now", "--repo"]);
    expect(MEMORY_GRADE_FLAG_NAMES).toEqual(["--home", "--why"]);
  });

  it("parses each verb's own flags and rejects the other's", () => {
    const parsed = parseMemoryHygieneArgs({ rest: ["--dir", "/a", "--repo", "/b", "--json"] });
    expect(parsed.isOk()).toBe(true);
    expect(parseMemoryHygieneArgs({ rest: ["--why", "no"] }).isErr()).toBe(true);
    const grade = parseMemoryGradeArgs({ rest: ["abc", "refused", "--why", "it stands"] });
    expect(grade.isOk()).toBe(true);
    expect(parseMemoryGradeArgs({ rest: ["--repo", "/b"] }).isErr()).toBe(true);
  });
});

describe("parseHygieneRows over what the verb wrote", () => {
  it("decodes the line the verb appends", () => {
    const line =
      '{"check":"schema","disposition":"proposed","id":"abc123abc123","recommendation":"adjust","schemaVersion":1,"subject":"a.md","tsIso":"2026-09-18T08:00:00.000Z"}';
    expect(parseHygieneRows({ text: line }).map((row) => row.check)).toEqual(["schema"]);
  });
});
