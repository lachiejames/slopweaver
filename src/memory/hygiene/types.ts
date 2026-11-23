/**
 * Contracts for the memory-hygiene pass — the standing review that PROPOSES and never deletes. Pure data:
 * no behaviour, no I/O.
 *
 * ## What this pass is, and the shape that answers the owner's own worry
 *
 * The owner wanted a standing job that keeps on top of pruning, deduping, consolidating and removing stale
 * memories, checked against the current codebase, with some adversarial verification, and worried it might be
 * overkill.
 *
 * The overkill worry is answered by the SHAPE rather than by scope. This pass proposes and never edits,
 * exactly as the self-improvement loop proposes findings — there is no write path to a memory file anywhere
 * in `src/memory/hygiene/`, which is a stronger guarantee than a flag defaulting to off, because there is no
 * code to enable.
 *
 * ## Two judgements, and conflating them is the trap
 *
 * A proposal's {@link MemoryHygieneProposal.recommendation} is one of `reflect/seen.ts`'s `SEEN_GRADES` —
 * `keep | adjust | drop` — and it is about the MEMORY. That is literally the keep/adjust/drop card.
 *
 * The owner's answer is about the PROPOSAL, and it is a {@link HygieneDisposition}: `accepted` or `refused`, where
 * `refused` is terminal exactly as reflect's `drop` is. Spelling both with the same three words would leave
 * `drop` answering two different questions in one ledger — drop the memory, or drop the proposal — so the
 * vocabulary is shared where it means the same thing and separate where it does not.
 *
 * ## The strictness bar is an input, not something this pass may re-derive
 *
 * The owner's strictness ruling — identity, voice and hard rules STAY; techniques go to skills; project state goes
 * to the profile — is the `memory-strictness-bar` memory. And the test it was sharpened to: a memory earns its place ONLY if its presence changes agent behaviour. Those two
 * facts are encoded in `./refute.ts`, which is why nothing here scores a memory's worth.
 */
import type { SeenGrade } from "../../reflect/seen.js";

/**
 * Every check this pass can report, in the order proposals are presented — which is also their severity
 * order, so ranking never needs a score. The array is the registry: a test asserts each id has both a firing
 * case and a clean control, so a check cannot be silently dropped or added without a proof that it fires.
 *
 * `referent-gone` and `referent-moved` are two ids rather than one with a field, because they propose
 * genuinely different things. A referent that VANISHED may mean the memory is now false; one that MOVED
 * means the memory needs a new path and its claim may be perfectly true. Collapsing them would have the card
 * recommend a drop for what is an edit — and the two real catches of the manual pass
 * (`ask-has-always-been-bm25-only`, `branch-only-deps-get-unlinked`) were both the second kind.
 */
export const HYGIENE_CHECK_IDS = [
  "index-budget",
  "schema",
  "referent-gone",
  "referent-moved",
  "duplicate",
  "enforcement",
] as const;

/** One check's stable machine id. */
export type HygieneCheckId = (typeof HYGIENE_CHECK_IDS)[number];

/** What the card recommends be done with a MEMORY. The same three words `reflect grade` uses. */
export type HygieneRecommendation = SeenGrade;

/**
 * What happened to a PROPOSAL. `proposed` is written by the pass; the other two are the owner's answer.
 *
 * `refused` is TERMINAL. Once one row carries it, the proposal is dead however many times a later run
 * rediscovers it, and no later row revives it — the same asymmetry `foldSeenLedger` rests on, and for the
 * same reason: a pass that re-proposes what the owner already refused is a pass the owner mutes.
 */
export type HygieneDisposition = "proposed" | "accepted" | "refused";

/**
 * One reason a drop candidate was NOT proposed as a drop.
 *
 * Carried on the proposal and printed rather than swallowed, mirroring `reflect/crossRef.ts`: a refutation
 * demotes for the same reason it never removes — it can go stale, so a reader is shown what killed it rather
 * than being asked to trust that something did. The register's own document has a heading for exactly this
 * (`reflect/registerDoc.ts`, "the classes an adversarial pass killed").
 */
export interface HygieneRefutation {
  /** A stable machine id for the refutation rule that fired, so two runs name it identically. */
  readonly rule: string;
  /** What was observed, in words a reader can check against the file. */
  readonly detail: string;
}

/** One proposal: what was found, about what, what it recommends, and everything that argued against it. */
export interface MemoryHygieneProposal {
  /** The stable id, from `proposalId`. The join key for the ledger. */
  readonly id: string;
  readonly check: HygieneCheckId;
  /** What the proposal is ABOUT — a leaf basename, a joined pair, or `MEMORY.md`. Half of the identity. */
  readonly subject: string;
  /** Every corpus file this proposal concerns, sorted, so a reader can open them without parsing `subject`. */
  readonly files: readonly string[];
  /** One line, above the fold. May interpolate a count; the id never reads it. */
  readonly summary: string;
  /** What the card recommends be done with the memory. */
  readonly recommendation: HygieneRecommendation;
  /** The evidence, collapsed below the fold by rule 7. Bounded by the check, never by the renderer. */
  readonly evidence: readonly string[];
  /** What the adversarial arm found against a drop. Empty when nothing argued against it. */
  readonly refutations: readonly HygieneRefutation[];
  /** Distinct calendar days this proposal has been made, including today. Recurrence, from the ledger. */
  readonly daysSeen: number;
}

/**
 * What the loader will and will not read of `MEMORY.md`.
 *
 * Per code.claude.com/docs/en/memory: "The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes
 * first, are loaded at the start of every conversation. Content beyond that threshold is not loaded at
 * session start."
 */
export interface IndexBudget {
  /** Lines in the index. */
  readonly lines: number;
  /** Bytes in the index, UTF-8. */
  readonly bytes: number;
  /** Which limit bites first, or `null` when the whole index loads. */
  readonly limitReached: "lines" | "bytes" | null;
  /**
   * The 1-based line number at which the loader stops, or `null` when the whole index loads.
   *
   * Every line AFTER this one is invisible at session start.
   */
  readonly cutAtLine: number | null;
  /** Pointer targets the loader never reaches, in index order. These memories are silently unroutable. */
  readonly pointersBelowCut: readonly string[];
  /** Whether the index is within {@link NEAR_LIMIT_SHARE} of either limit without having crossed one. */
  readonly nearLimit: boolean;
}

/** One whole run: everything found, already ranked, and what the run could not judge. */
export interface MemoryHygieneReport {
  /** Proposals in card order — see `./rank.ts`. Terminally-refused ones are already filtered out. */
  readonly proposals: readonly MemoryHygieneProposal[];
  /** The index measurement, always present: "it fits" is a result, not an absence. */
  readonly indexBudget: IndexBudget;
  /** How many memories were read. Named so an empty card is distinguishable from an empty corpus. */
  readonly leafCount: number;
  /**
   * How many knowledge rows' current beliefs the referent arm read, or `null` when the memories table could
   * not be read — the reason is then the residue's first line, never a zero that reads as an empty table.
   */
  readonly knowledgeRows: number | null;
  /**
   * What this run could not settle, in its own words. Never omitted and never empty-by-default: each check
   * that has a known blind spot says so here, so a reader is not left to assume a clean pass was exhaustive.
   */
  readonly residue: readonly string[];
  /** The instant the run was judged against, injected. */
  readonly nowIso: string;
}

/**
 * How close to a limit counts as NEAR it — a tenth of the budget.
 *
 * A near-limit index is an ordinary proposal, not a refusal: nothing is being dropped yet. It earns a place
 * on the card at all because the index only ever grows, and the run that first crosses the limit is the run
 * that silently stops loading memories.
 *
 * @internal
 */
export const NEAR_LIMIT_SHARE = 0.1;
