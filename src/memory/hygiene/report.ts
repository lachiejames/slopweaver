/**
 * THE ASSEMBLY — six checks' raw output in, one ranked {@link MemoryHygieneReport} out. Pure, and the only
 * place a check's finding becomes a PROPOSAL.
 *
 * Every argument is already computed: the index measurement, the sweep, the resolved referents, the duplicate
 * pairs and the enforcement matches. So the whole keep/adjust/drop judgement is one testable function with no
 * seam of its own, and the effectful shell (`../../cli/commands/memory/hygieneRun.ts`) only reads files.
 *
 * ## The strictness bar runs on every drop, not only on the check that proposes one
 *
 * `./refute.ts`'s {@link barExemption} is applied HERE rather than inside the enforcement check, and that
 * placement is the design. A future seventh check that wants to propose a drop gets the bar for free; one that
 * asked the check to remember to apply it would eventually ship a check that forgot. The bar is a property of
 * PROPOSING A DELETION, so it belongs where deletions are proposed.
 *
 * ## The residue is written by hand and is never empty
 *
 * Each check's known blind spot is stated in the report rather than left for a reader to infer from a clean
 * card. `reflect/rank.ts`'s cap has the same property for the same reason: a bounded pass that does not say it
 * is bounded reads as exhaustive, and a reader who believes a clean card was exhaustive stops looking.
 */
import type { MemoryCorpus, MemorySweep, MemorySweepRow } from "../types.js";
import { ROOT_INDEX_FILE } from "../types.js";
import type { DuplicatePair } from "./duplicates.js";
import type { EnforcementMatch } from "./enforcement.js";
import type { HygieneState } from "./ledger.js";
import { pairSubject, proposalId, readableSubject, referentSubject } from "./proposalId.js";
import { type RankedProposals, rankProposals, withRecurrence } from "./rank.js";
import type { ResolvedReferent } from "./referents.js";
import { barExemption, referentRecommendation, refuteDuplicatePair, refuteEnforcementDrop } from "./refute.js";
import type { IndexBudget, MemoryHygieneProposal, MemoryHygieneReport } from "./types.js";

/**
 * What each check cannot see, in its own words. Printed on every report, clean or not.
 *
 * Written as a list rather than derived, because a blind spot is a property of how a check was BUILT, and a
 * check whose limits could be computed would not have them.
 *
 * @internal
 */
export const HYGIENE_RESIDUE: readonly string[] = [
  "the duplicate scan reads slugs and descriptions, never bodies — two memories that share only a body are invisible to it",
  "in a memory a referent is only checked inside a single-backtick code span; a claim written in prose is never resolved",
  "an enforcement match is rare-token overlap, which nominates and cannot conclude — every drop here is a question",
  "no arm reads a transcript: a lexical transcript sweep was measured counting its own output as evidence",
  "nothing here judges whether a memory is TRUE, only whether what it names still exists",
  "knowledge rows are read for the referent arm only, and only each claim's current lesson or preference — a trace is a dated observation, never scanned",
  "a knowledge row's prose path is read only when it opens with a checkout's top-level directory, and a verb only from its repro — a path relative to a subdirectory or a home is never resolved",
  "a knowledge row cannot say which repository or tool it means, so a path in ANOTHER repository sharing a root name (a dependency's `src/`, a scratch file a repro creates) or a spanned flag of another tool is proposed too — refuse it once and it is never raised again",
];

/**
 * What the knowledge-row read came back with: how many current beliefs were scanned, or why none were.
 *
 * A union rather than a nullable count, so the assembly cannot write the report without saying which.
 *
 * @internal
 */
export type KnowledgeReading =
  { readonly read: true; readonly rows: number } | { readonly read: false; readonly why: string };

/** Every input the assembly needs, all of it already measured. */
export interface HygieneInputs {
  /** Whether the memories table was read. Its stale referents are already in {@link staleReferents}. */
  readonly knowledge: KnowledgeReading;
  readonly corpus: MemoryCorpus;
  readonly sweep: MemorySweep;
  readonly indexBudget: IndexBudget;
  /** Each leaf's full text, keyed by basename — the enforcement arm reads prose the parser does not keep. */
  readonly texts: ReadonlyMap<string, string>;
  readonly staleReferents: readonly ResolvedReferent[];
  readonly duplicatePairs: readonly DuplicatePair[];
  readonly enforced: readonly EnforcementMatch[];
  /** The folded ledger, so recurrence and terminal refusals are applied before ranking. */
  readonly states: ReadonlyMap<string, HygieneState>;
  readonly nowIso: string;
}

/** A proposal with a freshly derived id, saving every call site the same two lines. */
function proposal({
  check,
  subject,
  files,
  summary,
  recommendation,
  evidence,
  refutations,
}: Omit<MemoryHygieneProposal, "daysSeen" | "id">): MemoryHygieneProposal {
  return {
    check,
    daysSeen: 0,
    evidence,
    files,
    id: proposalId({ check, subject }),
    recommendation,
    refutations,
    subject,
    summary,
  };
}

/** The index-budget proposal, or nothing when the index both fits and is not near the limit. */
function indexBudgetProposals({ budget }: { budget: IndexBudget }): readonly MemoryHygieneProposal[] {
  const measurement = `${String(budget.lines)} lines, ${String(budget.bytes)} bytes`;
  if (budget.cutAtLine !== null) {
    const unreachable = budget.pointersBelowCut;
    return [
      proposal({
        check: "index-budget",
        evidence: [
          `the loader stops at line ${String(budget.cutAtLine)} — the ${String(budget.limitReached)} limit bites first`,
          `${measurement}`,
          ...unreachable.map((target) => `never loaded at session start: ${target}`),
        ],
        files: [ROOT_INDEX_FILE],
        recommendation: "adjust",
        refutations: [],
        subject: ROOT_INDEX_FILE,
        summary: `${ROOT_INDEX_FILE} truncates at line ${String(budget.cutAtLine)} — ${String(unreachable.length)} memory(s) never load`,
      }),
    ];
  }
  if (budget.nearLimit) {
    return [
      proposal({
        check: "index-budget",
        evidence: [measurement, "the index only ever grows, and the run that crosses the limit truncates silently"],
        files: [ROOT_INDEX_FILE],
        recommendation: "adjust",
        refutations: [],
        subject: ROOT_INDEX_FILE,
        summary: `${ROOT_INDEX_FILE} is within a tenth of the loader's limit at ${measurement}`,
      }),
    ];
  }
  return [];
}

/** One proposal per leaf carrying `memory check` findings, so a card never restates a whole sweep. */
function schemaProposals({ sweep }: { sweep: MemorySweep }): readonly MemoryHygieneProposal[] {
  return sweep.rows.flatMap((row) => {
    if (row.findings.length === 0) {
      return [];
    }
    return [
      proposal({
        check: "schema",
        evidence: row.findings.map((finding) => `${finding.check}: ${finding.message}`),
        files: [row.file],
        recommendation: "adjust",
        refutations: [],
        subject: row.file,
        summary: `${row.file}: ${row.findings.map((finding) => finding.check).join(", ")}`,
      }),
    ];
  });
}

/** One proposal per unresolved referent. `gone` and `moved` are separate checks, so they rank separately. */
function referentProposals({ stale }: { stale: readonly ResolvedReferent[] }): readonly MemoryHygieneProposal[] {
  return stale.map((entry) => {
    const { recommendation, refutations } = referentRecommendation({ verdict: entry.verdict });
    const check = entry.verdict === "moved" ? "referent-moved" : "referent-gone";
    const subject = referentSubject({ file: entry.file, referent: entry.referent.text });
    return proposal({
      check,
      evidence: [
        `${entry.file}:${String(entry.referent.line)} names the ${entry.referent.kind} \`${entry.referent.text}\``,
        `the tree says: ${entry.verdict}`,
      ],
      files: [entry.file],
      recommendation,
      refutations,
      subject,
      summary: `${entry.file} names a ${entry.verdict} ${entry.referent.kind}: ${entry.referent.text}`,
    });
  });
}

/**
 * One memory's description for the card, saying so out loud when it has none.
 *
 * A blank here would read as the memory being about nothing, which is a different claim from its frontmatter
 * carrying no `description:` — and the second one is itself worth the owner's eye on a pair the owner is asked to consolidate.
 */
function describedAs({ row }: { row: MemorySweepRow }): string {
  if (row.description === null) {
    return "(no description)";
  }
  return row.description;
}

/** One proposal per near-duplicate pair. Never a drop: which of two memories survives is the owner's judgement. */
function duplicateProposals({
  pairs,
  rows,
}: {
  pairs: readonly DuplicatePair[];
  rows: ReadonlyMap<string, MemorySweepRow>;
}): readonly MemoryHygieneProposal[] {
  return pairs.flatMap((pair) => {
    const left = rows.get(pair.files[0]);
    const right = rows.get(pair.files[1]);
    if (left === undefined || right === undefined) {
      return [];
    }
    const { recommendation, refutations } = refuteDuplicatePair({ left, right });
    const subject = pairSubject({ files: pair.files });
    return [
      proposal({
        check: "duplicate",
        evidence: [
          `similarity ${pair.similarity.toFixed(2)} over rare tokens in slug + description`,
          `shared: ${pair.sharedTokens.join(", ")}`,
          `${left.file}: ${describedAs({ row: left })}`,
          `${right.file}: ${describedAs({ row: right })}`,
        ],
        files: [...pair.files],
        recommendation,
        refutations,
        subject,
        summary: `${readableSubject({ subject })} overlap at ${pair.similarity.toFixed(2)} — consolidate or say why both stand`,
      }),
    ];
  });
}

/** How the card names one memory's enforcers: the strongest, and a count of the rest. */
function namedEnforcers({ match }: { match: EnforcementMatch }): string | null {
  // The card names the STRONGEST match and counts the rest. A summary listing fifteen enforcers is the wall
  // of text rule 7 refuses, and the extras are all weaker evidence for the same claim.
  const best = match.enforcers[0];
  if (best === undefined) {
    return null;
  }
  const others = match.enforcers.length - 1;
  if (others === 0) {
    return `${best.kind} ${best.id}`;
  }
  return `${best.kind} ${best.id} +${String(others)} more`;
}

/** Everything one enforcement match puts in front of a reader, strongest evidence first. */
function enforcementEvidence({ match }: { match: EnforcementMatch }): readonly string[] {
  // Safe: a null `named` short-circuits the caller before this is reached.
  const best = match.enforcers[0]!;
  return [
    `${String(Math.round(match.coverage * 100))}% of its distinctive vocabulary is already in ${best.id}`,
    ...match.enforcers.map((enforcer) => `also enforced by: ${enforcer.kind} ${enforcer.id}`),
    `shared rare tokens: ${match.sharedTokens.join(", ")}`,
    "the test: a memory earns its place ONLY if its presence changes agent behaviour (the owner's test)",
  ];
}

/**
 * One proposal per memory restating an enforcer. The only check that ever recommends a `drop`, and the bar
 * plus the adversarial arm both run before it does.
 */
function enforcementProposals({
  enforced,
  rows,
  corpus,
  texts,
}: {
  enforced: readonly EnforcementMatch[];
  rows: ReadonlyMap<string, MemorySweepRow>;
  corpus: MemoryCorpus;
  texts: ReadonlyMap<string, string>;
}): readonly MemoryHygieneProposal[] {
  return enforced.flatMap((match) => {
    const row = rows.get(match.file);
    const leaf = corpus.leaves.find((candidate) => candidate.file === match.file);
    const text = texts.get(match.file);
    if (row === undefined || leaf === undefined || text === undefined) {
      return [];
    }
    const named = namedEnforcers({ match });
    if (named === null) {
      return [];
    }
    const evidence = enforcementEvidence({ match });
    const exemption = barExemption({ leaf, row });
    if (exemption !== null) {
      return [
        proposal({
          check: "enforcement",
          evidence,
          files: [match.file],
          recommendation: "keep",
          refutations: [{ detail: exemption.detail, rule: exemption.rule }],
          subject: match.file,
          summary: `${match.file} overlaps ${named}, but the strictness bar keeps it`,
        }),
      ];
    }
    const { recommendation, refutations } = refuteEnforcementDrop({ enforcers: match.enforcers, text });
    const verdict = recommendation === "drop" ? "nothing refuted a drop" : "the arm refuted the drop";
    return [
      proposal({
        check: "enforcement",
        evidence,
        files: [match.file],
        recommendation,
        refutations,
        subject: match.file,
        summary: `${match.file} restates ${named} — ${verdict}`,
      }),
    ];
  });
}

/** A whole run, ranked, with the split at the fold kept beside it. */
export interface HygieneRun {
  readonly report: MemoryHygieneReport;
  readonly ranked: RankedProposals;
}

/**
 * Turn six checks' output into one ranked report.
 *
 * @param inputs every measurement the checks produced, plus the folded ledger and the injected instant
 * @returns the report in card order, and the split at the fold
 */
export function buildHygieneReport({ inputs }: { inputs: HygieneInputs }): HygieneRun {
  const rows = new Map(inputs.sweep.rows.map((row) => [row.file, row]));
  const found = [
    ...indexBudgetProposals({ budget: inputs.indexBudget }),
    ...schemaProposals({ sweep: inputs.sweep }),
    ...referentProposals({ stale: inputs.staleReferents }),
    ...duplicateProposals({ pairs: inputs.duplicatePairs, rows }),
    ...enforcementProposals({ corpus: inputs.corpus, enforced: inputs.enforced, rows, texts: inputs.texts }),
  ];
  const live = withRecurrence({ proposals: found, states: inputs.states });
  const ranked = rankProposals({ proposals: live });
  return {
    ranked,
    report: {
      indexBudget: inputs.indexBudget,
      knowledgeRows: inputs.knowledge.read ? inputs.knowledge.rows : null,
      leafCount: inputs.corpus.leaves.length,
      nowIso: inputs.nowIso,
      proposals: [...ranked.aboveFold, ...ranked.belowFold],
      residue: inputs.knowledge.read
        ? HYGIENE_RESIDUE
        : [`the knowledge rows were NOT read, so none of them was judged: ${inputs.knowledge.why}`, ...HYGIENE_RESIDUE],
    },
  };
}
