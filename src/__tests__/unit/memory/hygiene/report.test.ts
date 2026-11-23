/**
 * THE ASSEMBLY — six checks' output becoming one ranked report.
 *
 * The guard that earns its place here is the LAST case: every entry of `HYGIENE_CHECK_IDS` must have a firing
 * case, asserted against the registry rather than against a list written out by hand, so a seventh check added
 * without a fixture fails rather than quietly going untested. Beside it sits the clean control — the same corpus
 * with nothing found — because a report builder that proposed something unconditionally would pass every firing
 * case in this file.
 *
 * The corpus goes through the REAL parser and the REAL sweep. The three pure checks' outputs are passed in
 * directly, which is what `buildHygieneReport` is for: it takes measurements, never a seam of its own.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import { buildMemoryCorpus } from "../../../../memory/corpus.js";
import type { DuplicatePair } from "../../../../memory/hygiene/duplicates.js";
import type { EnforcementMatch, Enforcer } from "../../../../memory/hygiene/enforcement.js";
import { pairSubject, proposalId, referentSubject } from "../../../../memory/hygiene/proposalId.js";
import type { ResolvedReferent } from "../../../../memory/hygiene/referents.js";
import { buildHygieneReport, HYGIENE_RESIDUE, type HygieneInputs } from "../../../../memory/hygiene/report.js";
import { HYGIENE_CHECK_IDS, type IndexBudget } from "../../../../memory/hygiene/types.js";
import { sweepMemoryCorpus } from "../../../../memory/sweep.js";
import type { MemoryCorpus, MemorySourceFile } from "../../../../memory/types.js";

/** The fixed instant every case is judged at, so nothing here reads a clock. */
const NOW_ISO = "2026-09-18T08:00:00.000Z";

/** The same instant in epoch milliseconds, for the sweep's ages. */
const NOW_MS = Date.parse(NOW_ISO);

/** An always-on doc, so the enforcement arm has something that is not a scoped rule to refute against. */
const AGENTS: Enforcer = { id: "AGENTS.md", kind: "always-on-doc", text: "batch the pelicans" };

/** One leaf file with the frontmatter the schema wants, opening with the paragraph a root-routed memory carries. */
function leaf({ stem, description, body }: { stem: string; description: string; body: string }): MemorySourceFile {
  const why = "**Why always-loaded:** it applies at boot.";
  return {
    file: `${stem}.md`,
    text: `---\nname: ${stem}\ndescription: ${description}\nmetadata:\n  type: project\n---\n\n${why}\n\n${body}\n`,
  };
}

/**
 * Every leaf of the shared fixture. `schema-broken`'s wikilink is the only thing the `firing` switch changes in
 * the corpus itself: the schema check reads the sweep rather than an injected measurement, so a clean control has
 * to be a clean CORPUS, not the same corpus with a check turned off.
 */
function fixtureFiles({ firing }: { firing: boolean }): readonly MemorySourceFile[] {
  const link = firing ? "[[absent-memory]]" : "[[dup-a]]";
  return [
    leaf({ body: `See ${link} for the rest.`, description: "a schema defect", stem: "schema-broken" }),
    leaf({ body: "Named `src/pelican/gone.ts`.", description: "a vanished path", stem: "referent-vanished" }),
    leaf({ body: "Named `src/pelican/moved.ts`.", description: "a moved path", stem: "referent-relocated" }),
    leaf({ body: "Batch them.", description: "pelican batching, said once", stem: "dup-a" }),
    leaf({ body: "Batch them.", description: "pelican batching, said twice", stem: "dup-b" }),
    leaf({ body: "Batch the pelicans.", description: "batch the pelicans", stem: "restates-agents" }),
  ];
}

/** The parsed corpus of the shared fixture, every leaf routed by the root index. */
function fixtureCorpus({ firing }: { firing: boolean }): MemoryCorpus {
  const files = fixtureFiles({ firing });
  const pointers = files.map((file) => `- [${file.file}](${file.file}) — a fact`).join("\n");
  return buildMemoryCorpus({
    files: [{ file: "MEMORY.md", text: `# Index\n\n${pointers}\n` }, ...files],
  });
}

/** An index measurement that fires, or one that does not. */
function budgetOf({ cut }: { cut: boolean }): IndexBudget {
  if (cut) {
    return {
      bytes: 26_000,
      cutAtLine: 200,
      limitReached: "bytes",
      lines: 240,
      nearLimit: true,
      pointersBelowCut: ["restates-agents"],
    };
  }
  return { bytes: 400, cutAtLine: null, limitReached: null, lines: 8, nearLimit: false, pointersBelowCut: [] };
}

/** Every input, with each check's output switched on or off together. */
function inputsOf({ firing }: { firing: boolean }): HygieneInputs {
  const corpus = fixtureCorpus({ firing });
  const texts = new Map(fixtureFiles({ firing }).map((file) => [file.file, file.text]));
  const stale: readonly ResolvedReferent[] = [
    { file: "referent-vanished.md", referent: { kind: "path", line: 7, text: "src/pelican/gone.ts" }, verdict: "gone" },
    {
      file: "referent-relocated.md",
      referent: { kind: "path", line: 7, text: "src/pelican/moved.ts" },
      verdict: "moved",
    },
  ];
  const pairs: readonly DuplicatePair[] = [
    { files: ["dup-a.md", "dup-b.md"], sharedTokens: ["batching", "pelican"], similarity: 0.75 },
  ];
  const enforced: readonly EnforcementMatch[] = [
    { coverage: 0.8, enforcers: [AGENTS], file: "restates-agents.md", sharedTokens: ["batch", "pelicans"] },
  ];
  return {
    corpus,
    duplicatePairs: firing ? pairs : [],
    enforced: firing ? enforced : [],
    indexBudget: budgetOf({ cut: firing }),
    knowledge: { read: true, rows: 3 },
    nowIso: NOW_ISO,
    staleReferents: firing ? stale : [],
    states: new Map(),
    sweep: sweepMemoryCorpus({ corpus, now: NOW_MS, staleAfterDays: null }),
    texts,
  };
}

describe("buildHygieneReport", () => {
  it("fires every check in the registry, and nothing outside it", () => {
    expect(HYGIENE_CHECK_IDS.length).toBeGreaterThan(0);
    const { report } = buildHygieneReport({ inputs: inputsOf({ firing: true }) });
    const fired = new Set(report.proposals.map((proposal) => proposal.check));
    expect([...HYGIENE_CHECK_IDS].filter((check) => !fired.has(check))).toEqual([]);
    expect([...fired].filter((check) => !HYGIENE_CHECK_IDS.includes(check))).toEqual([]);
  });

  it("proposes nothing over the same corpus when every check came back clean", () => {
    const { report, ranked } = buildHygieneReport({ inputs: inputsOf({ firing: false }) });
    expect(report.proposals).toEqual([]);
    expect(ranked.aboveFold).toEqual([]);
    expect(ranked.belowFold).toEqual([]);
    expect(report.leafCount).toBe(6);
    expect(report.nowIso).toBe(NOW_ISO);
  });

  it("puts the truncating index first and splits the rest at the fold", () => {
    const { report, ranked } = buildHygieneReport({ inputs: inputsOf({ firing: true }) });
    expect(ranked.aboveFold.length).toBe(5);
    expect(ranked.aboveFold.map((proposal) => proposal.check)).toEqual([
      "index-budget",
      "schema",
      "referent-gone",
      "referent-moved",
      "duplicate",
    ]);
    expect(ranked.belowFold.map((proposal) => proposal.check)).toEqual(["enforcement"]);
    expect(report.proposals.length).toBe(6);
  });

  it("names the unreachable memories on the index-budget proposal", () => {
    const { report } = buildHygieneReport({ inputs: inputsOf({ firing: true }) });
    const budget = report.proposals.find((proposal) => proposal.check === "index-budget")!;
    expect(budget.recommendation).toBe("adjust");
    expect(budget.summary).toBe("MEMORY.md truncates at line 200 — 1 memory(s) never load");
    expect(budget.evidence).toContain("never loaded at session start: restates-agents");
  });

  it("derives each proposal's id from its check and subject, so two runs agree", () => {
    const { report } = buildHygieneReport({ inputs: inputsOf({ firing: true }) });
    const byCheck = new Map(report.proposals.map((proposal) => [proposal.check, proposal]));
    expect(byCheck.get("duplicate")!.id).toBe(
      proposalId({ check: "duplicate", subject: pairSubject({ files: ["dup-a.md", "dup-b.md"] }) }),
    );
    expect(byCheck.get("referent-gone")!.id).toBe(
      proposalId({
        check: "referent-gone",
        subject: referentSubject({ file: "referent-vanished.md", referent: "src/pelican/gone.ts" }),
      }),
    );
  });

  it("recommends the only drop this pass ever makes on the enforcement proposal", () => {
    const { report } = buildHygieneReport({ inputs: inputsOf({ firing: true }) });
    const enforcement = report.proposals.find((proposal) => proposal.check === "enforcement")!;
    expect(enforcement.recommendation).toBe("drop");
    expect(enforcement.refutations).toEqual([]);
    expect(enforcement.summary).toBe("restates-agents.md restates always-on-doc AGENTS.md — nothing refuted a drop");
    expect(enforcement.evidence[0]).toBe("80% of its distinctive vocabulary is already in AGENTS.md");
    expect(enforcement.evidence).toContain(
      "the test: a memory earns its place ONLY if its presence changes agent behaviour (the owner's test)",
    );
  });

  it("keeps a memory the strictness bar protects, rather than proposing its deletion", () => {
    const base = inputsOf({ firing: true });
    const identity = base.sweep.rows.map((row) =>
      row.file === "restates-agents.md" ? { ...row, declaredType: "user" as const } : row,
    );
    const leaves = base.corpus.leaves.map((entry) =>
      entry.file === "restates-agents.md" ? { ...entry, declaredType: "user" as const } : entry,
    );
    const inputs: HygieneInputs = {
      ...base,
      corpus: { ...base.corpus, leaves },
      sweep: { ...base.sweep, rows: identity },
    };
    const enforcement = buildHygieneReport({ inputs }).report.proposals.find(
      (proposal) => proposal.check === "enforcement",
    )!;
    expect(enforcement.recommendation).toBe("keep");
    expect(enforcement.refutations.map((entry) => entry.rule)).toEqual(["bar-identity"]);
    expect(enforcement.summary).toBe(
      "restates-agents.md overlaps always-on-doc AGENTS.md, but the strictness bar keeps it",
    );
  });

  it("counts the recurrence a proposal has already accrued, and drops a refused one", () => {
    const base = inputsOf({ firing: true });
    const duplicateId = proposalId({
      check: "duplicate",
      subject: pairSubject({ files: ["dup-a.md", "dup-b.md"] }),
    });
    const goneId = proposalId({
      check: "referent-gone",
      subject: referentSubject({ file: "referent-vanished.md", referent: "src/pelican/gone.ts" }),
    });
    const inputs: HygieneInputs = {
      ...base,
      states: new Map([
        [
          duplicateId,
          {
            accepted: false,
            check: "duplicate" as const,
            daysSeen: 8,
            firstSeenIso: "2026-09-10T00:00:00.000Z",
            id: duplicateId,
            lastSeenIso: "2026-09-17T00:00:00.000Z",
            recommendation: "adjust" as const,
            refused: false,
            subject: pairSubject({ files: ["dup-a.md", "dup-b.md"] }),
            why: undefined,
          },
        ],
        [
          goneId,
          {
            accepted: false,
            check: "referent-gone" as const,
            daysSeen: 3,
            firstSeenIso: "2026-09-15T00:00:00.000Z",
            id: goneId,
            lastSeenIso: "2026-09-17T00:00:00.000Z",
            recommendation: "adjust" as const,
            refused: true,
            subject: referentSubject({ file: "referent-vanished.md", referent: "src/pelican/gone.ts" }),
            why: "the path is illustrative",
          },
        ],
      ]),
    };
    const { report } = buildHygieneReport({ inputs });
    expect(report.proposals.map((proposal) => proposal.check)).not.toContain("referent-gone");
    expect(report.proposals.find((proposal) => proposal.check === "duplicate")!.daysSeen).toBe(9);
  });

  it("prints the residue on a clean run as well as a firing one", () => {
    expect(HYGIENE_RESIDUE.length).toBeGreaterThan(0);
    expect(buildHygieneReport({ inputs: inputsOf({ firing: false }) }).report.residue).toEqual(HYGIENE_RESIDUE);
    expect(buildHygieneReport({ inputs: inputsOf({ firing: true }) }).report.residue).toEqual(HYGIENE_RESIDUE);
  });

  it("counts the knowledge rows it read, and opens the residue with why when it read none", () => {
    const read = buildHygieneReport({ inputs: inputsOf({ firing: false }) }).report;
    expect(read.knowledgeRows).toBe(3);
    const unread = buildHygieneReport({
      inputs: { ...inputsOf({ firing: false }), knowledge: { read: false, why: "the store is not running" } },
    }).report;
    expect(unread.knowledgeRows).toBe(null);
    expect(unread.residue).toEqual([
      "the knowledge rows were NOT read, so none of them was judged: the store is not running",
      ...HYGIENE_RESIDUE,
    ]);
  });

  it("proposes a knowledge row's stale referent under the row's own name", () => {
    const inputs: HygieneInputs = {
      ...inputsOf({ firing: false }),
      staleReferents: [
        { file: "knowledge:burst-row", referent: { kind: "skill", line: 2, text: "skills/gone" }, verdict: "gone" },
      ],
    };
    const proposals = buildHygieneReport({ inputs }).report.proposals;
    expect(proposals.map((proposal) => [proposal.check, proposal.files, proposal.summary])).toEqual([
      ["referent-gone", ["knowledge:burst-row"], "knowledge:burst-row names a gone skill: skills/gone"],
    ]);
  });
});
