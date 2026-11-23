/**
 * What ONE memory is, and where a thing worth remembering is allowed to go. Pure data: no I/O, no clock.
 *
 * ## The placement rule this file encodes
 *
 * What belongs in Claude memories and what belongs elsewhere applies here too, so the destinations are
 * decided by the SAME bar that already governs auto-memory (`memory-strictness-bar`):
 * **a thing earns a place only if its presence changes what an agent does.** {@link MEMORY_PLACEMENTS} is
 * that bar written as a closed vocabulary, and {@link RETAINED_PLACEMENT} is the one value this table
 * accepts.
 *
 * Two of the five values are NOT memory destinations and are here on purpose. The strictness bar's own
 * exits — delete it, or put it on the board — are what stop a placement question from becoming a
 * requirement to store everything somewhere, and a vocabulary missing them would force a filler row.
 *
 * ## What a declared placement does and does not prove
 *
 * It proves the writer was ASKED and answered on the record, and it makes a wrong answer a reviewable
 * claim rather than an invisible one. It does not prove the answer is right: no type, no Zod schema and no
 * SQL constraint can tell whether prose duplicates a skill or genuinely changes behaviour. Anything
 * claiming otherwise would be a check that cannot fail, which this repository treats as worse than none.
 */
import type { LessonSurface, LessonTier, LessonVerdict } from "./types.js";

/** Where a thing worth remembering goes. */
export type MemoryPlacement = "retrieved" | "always-loaded" | "skill" | "board" | "nowhere";

/**
 * Every destination the placement rule recognises, including the two that store nothing.
 *
 * A plain `readonly MemoryPlacement[]` rather than an `as const` tuple, matching `./types.ts`'s three
 * vocabularies and for the reason measured there: a readonly TUPLE on the receiving end of `.some(…)` or
 * `.find(…)` sends the `named-object-params` gate into unbounded recursion inside its own `typeIsCallable`.
 * `../store/schema/memories.ts` carries the measurement and the repro.
 */
export const MEMORY_PLACEMENTS: readonly MemoryPlacement[] = [
  "retrieved",
  "always-loaded",
  "skill",
  "board",
  "nowhere",
];

/** The one placement this table holds. Every other value is a refusal that names the real destination. */
export const RETAINED_PLACEMENT = "retrieved" satisfies MemoryPlacement;

/** Where each placement's content actually lands, quoted back to a writer who chose the wrong one. */
export const MEMORY_PLACEMENT_DESTINATIONS: Readonly<Record<MemoryPlacement, string>> = {
  "always-loaded": "the Claude project memory corpus — a memory file plus its MEMORY.md pointer",
  board: "a board row, with `slopweaver handover ask` — an aspiration in a memory changes nothing",
  nowhere: "nowhere — a gate, schema, hook, skill or always-on doc already supplies this instruction",
  retrieved: "the memories table, with `slopweaver knowledge remember`",
  skill: "the owning `skills/<name>/reference/*.md`, a `docs/` page, or docs/recurring-failure-register.md",
};

/**
 * What a memory IS, and the reason the three kinds cannot share one contract.
 *
 * `skills/knowledge/SKILL.md`'s entry test demands a lesson be paid for, not re-derivable by a fresh read,
 * and capable of becoming false later. A preference of the owner's satisfies none of those honestly: nobody
 * measured it, re-reading a system will never produce it, and it does not decay on its own — it changes
 * only when the owner changes their mind. Filing one as a lesson would make the entry test a lie.
 *
 * A TRACE fails the lesson test from the other side: it is re-derivable by definition. It says where an
 * investigation looked — the exact probe, whether it paid or came back empty, and what the emptiness does
 * not prove — and nothing more. A trace records what happened when an investigation ran, rather than
 * inferring a ruling from one instance, which is more reproducible and falsifiable. A lesson generalises; a
 * trace only reports, which is why it is cheap to re-check and why it never removes a leg of the next
 * investigation (correctness over speed, and a skip has to be earned from data later).
 */
export type MemoryKind = "lesson" | "preference" | "trace";

/** Every kind. A plain array for the reason {@link MEMORY_PLACEMENTS} gives. */
export const MEMORY_KINDS: readonly MemoryKind[] = ["lesson", "preference", "trace"];

/**
 * What a trace's probe came back with. Two values and no more: a probe that returned something worth
 * reading PAID, one that returned nothing worth reading was EMPTY — and an empty one must say what that
 * emptiness does not prove, enforced by `memories_kind_facets`.
 */
export type TraceOutcome = "paid" | "empty";

/** Both outcomes. A plain array for the reason {@link MEMORY_PLACEMENTS} gives. */
export const TRACE_OUTCOMES: readonly TraceOutcome[] = ["paid", "empty"];

/** The longest a placement field may be. Long enough for a sentence, short enough to stay one. */
export const MEMORY_FIELD_MAX = 400;

/** The id prefix for each kind, so a claim id says which contract produced it without a second read. */
export const MEMORY_ID_PREFIXES: Readonly<Record<MemoryKind, string>> = { lesson: "l-", preference: "p-", trace: "t-" };

/**
 * One recording as this codebase builds it, before an insert sees it.
 *
 * **Spelled out rather than taken from `typeof memoriesTable.$inferInsert`, and the reason is measured.**
 * Drizzle's insert type admits an `SQL` expression in every column, and `SQL` carries
 * `queryChunks: SQLChunk[]` where `SQLChunk` includes `SQL` again — a union containing an array of itself.
 * The `named-object-params` gate's `typeIsCallable` walks unions and array elements and has no cycle guard,
 * so one function in this tree annotated with that type ends the whole gate with
 * `RangeError: Maximum call stack size exceeded`. Measured: copying only
 * `src/knowledge/memoryRow.ts` onto an otherwise clean tree reproduces it, and removing that one import
 * clears it — reproduce with `yarn tsx src/cli/index.ts dev lint --only named-object-params`.
 *
 * So this is the narrow, concrete subset a writer here actually produces: no placeholders, no SQL
 * expressions, no generated columns. The SELECT side stays schema-derived (`MemoryRecordingRow` is
 * `$inferSelect`), and `src/__tests__/unit/store/schemaDrift.test.ts` asserts this shape is still
 * assignable to what an insert takes, so a column rename is still a compile error rather than a surprise.
 */
export interface MemoryRecording {
  /** This physical recording. Unique. */
  readonly recordingId: string;
  /** The claim. Deliberately NOT unique — a repeat is the consolidation signal. */
  readonly id: string;
  /** Which contract this is filed under. */
  readonly kind: MemoryKind;
  /** Which system or area it is about. */
  readonly domain: string;
  /** The memory itself, in one sentence. */
  readonly claim: string;
  /** What was observed, or what the owner said and when. */
  readonly evidence: string;
  /** What is currently believed about the claim. */
  readonly verdict: LessonVerdict;
  /** What it costs when unknown. Null for a preference and a trace. */
  readonly tier: LessonTier | null;
  /** Where it was learned. Null for a preference and a trace. */
  readonly surface: LessonSurface | null;
  /** The command that settles it again — a trace's exact probe. Null for a preference, or when there is none. */
  readonly repro: string | null;
  /** The question a trace's probe was run for. Null for every other kind. */
  readonly question: string | null;
  /** Whether a trace's probe paid or came back empty. Null for every other kind. */
  readonly outcome: TraceOutcome | null;
  /** What the evidence does not establish. */
  readonly caveat: string | null;
  /** Who learned it. Null only for a row imported from the register that predates the field. */
  readonly learner: string | null;
  /** What the next agent does differently. Null only for an imported row. */
  readonly behaviourChange: string | null;
  /** The words a task would have to mention. Null only for an imported row. */
  readonly retrievalCue: string | null;
  /** The board row it was learned on, or `ad-hoc`. */
  readonly run: string;
  /** When this recording was made. */
  readonly recordedAt: Date;
  /** The source digest and line this was imported from, or null for a row recorded directly. */
  readonly importKey: string | null;
  /**
   * The claim id this recording retires, or null when it replaces nothing. Same kind only, and never its own
   * claim — `./types.ts`'s overview carries the retirement rule.
   */
  readonly supersedes: string | null;
  /**
   * When this row entered a database — set ONLY on a restore, and left to the column default otherwise.
   *
   * A fresh write has no opinion about this: `now()` is exactly right. A RESTORE does, and the reason is
   * that `createdAt` is a tie-break. A version that omitted it broke ordering: two recordings
   * of one claim sharing a `recorded_at` are ordered by `created_at`, a bulk restore gave every row the
   * same transaction-time default, and recall then fell through to an arbitrary `recording_id` and showed
   * an older `confirmed` where a newer `refuted` had been showing before the restore. A backup that
   * changes what the register BELIEVES is not a backup.
   */
  readonly createdAt?: Date;
  /**
   * Write order — set ONLY on a restore, and left to the sequence otherwise.
   *
   * The ordering column, carried through a backup verbatim for the same reason `createdAt` is, and the
   * one that finally ends the tie-break class: an integer has no precision to truncate.
   * `../store/schema/memories.ts` carries the three review rounds.
   */
  readonly seq?: number;
}
