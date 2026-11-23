/**
 * The memories table — every learning this installation can RECALL, with Postgres full-text search over it.
 *
 * Learnings are RETRIEVED, not loaded wholesale: the list gets very large over time, so a task about Datadog
 * queries the memories table for things that include the word Datadog or similar and reads everything that
 * comes up. Tags are not needed; a full text search over the memories table is enough.
 *
 * So: no tag table, no embedding column, no metadata bag. One generated `tsvector` and a GIN index, which
 * is the whole retrieval mechanism.
 *
 * ## A row is a RECORDING, and that is why the claim id is not the primary key
 *
 * `../../knowledge/row.ts`'s `lessonId` hashes the domain and the normalised claim and NOTHING else, so
 * two sessions that learn the same thing produce the same id. The consolidation trigger reads
 * exactly that repeat: when multiple agents have the same lesson, it is time to look at turning that
 * lesson into a standing rule. And `../../knowledge/query.ts`'s
 * `repeatedLessons` counts it. An upsert keyed on that id would destroy the feature.
 *
 * So {@link memoriesTable} has TWO identities: `recordingId` is this physical recording, unique; `id` is
 * the claim, deliberately NOT unique. Selecting the latest recording per `id` gives the current belief;
 * counting rows per `id` gives the repeat. The file this replaces got that property from being append-only,
 * and it is preserved here rather than re-derived.
 *
 * ## The two kinds, and why a preference is not a lesson
 *
 * `skills/knowledge/SKILL.md`'s entry test says a lesson was PAID FOR, is not re-derivable by a fresh read,
 * and CAN BE WRONG LATER. A preference of the owner's satisfies none of those honestly — nobody measured
 * it, it does not decay on its own, and re-reading a system will never produce it. Storing one under the
 * lesson contract would make the contract a lie, so `kind` is a closed vocabulary and the lesson-only
 * facets (`tier`, `surface`, `repro`) are NULL for a preference, enforced by a cross-column CHECK rather
 * than by a convention a writer has to remember.
 *
 * A TRACE is the third kind and fails the lesson test from the other side: it IS
 * re-derivable, because it records only where an investigation looked — the question, the exact probe (in
 * `repro`), whether it paid or was empty, and for an empty one what the emptiness does not prove (in
 * `caveat`). The same CHECK gives it those facets and denies it the lesson's tier and surface.
 *
 * ## Both timestamps are MILLISECOND precision, and that is the fix for a whole class
 *
 * Postgres stores `timestamptz` to the microsecond; JavaScript's `Date` and `toISOString()` carry
 * milliseconds. So a column at full precision can hold a distinction that an export cannot write and a
 * restore cannot read back — and since the timestamps are what ORDER two recordings of one claim, losing
 * that distinction silently changes which recording recall shows. Review found this four times over,
 * once on each column and once on the tie-break below them, because patching
 * a reader only moves the collapse one precision deeper.
 *
 * `precision: 3` ends it by making the database agree with the wire format by construction: there is no
 * sub-millisecond distinction to lose, whatever writes the row — a verb, a migration, or a hand-typed
 * INSERT. Nothing in this repository ever wrote a finer instant (`new Date()` and an ISO string are both
 * millisecond), so no existing behaviour changes; what changes is that none ever CAN.
 *
 * ## Why three text columns are nullable when the placement rule requires them
 *
 * `learner`, `behaviourChange` and `retrievalCue` are required of every NEW recording and are checked in
 * `../../knowledge/memoryRow.ts`. They are nullable in the DDL because every row imported from
 * `$SLOPWEAVER_HOME/knowledge/lessons.jsonl` predate all three, and inventing values for them would turn an
 * unknown into a fabricated fact — the one thing a store of paid-for observations must never do. A NULL
 * here reads as "this was imported and nobody knows", which is true, and `importKey` says which rows those
 * are without a second query.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { TraceOutcome } from "../../knowledge/memory.js";
import type { LessonSurface, LessonTier, LessonVerdict } from "../../knowledge/types.js";

import { storeTablePolicies } from "./rls.js";
import { tsvector } from "./tsvector.js";

/**
 * What a memory IS. Closed, because the whole schema branches on it: the third kind, `trace`,
 * carries its own facets (`question`, `outcome`), its own entry test and its own writer
 * (`knowledge trace`) rather than as a new label — see `../../knowledge/memory.ts`'s `MemoryKind`.
 *
 * Widened in place: `drizzle-kit` would emit `ALTER TYPE … ADD VALUE`, which the migration gate refuses, so
 * the label is added by `../policies.ts`'s `enumValueStatements` after the migration. That is also why
 * {@link memoriesTable}'s CHECK compares `kind::text` — on an existing database the migration runs before
 * the label exists, and comparing the enum to an unknown label would fail the whole apply.
 */
export const memoryKindEnum = pgEnum("memory_kind", ["lesson", "preference", "trace"]);

/** Every trace outcome, as a tuple. See {@link VERDICT_VALUES}. */
const TRACE_OUTCOME_VALUES = ["paid", "empty"] as const satisfies readonly TraceOutcome[];

/** Whether a trace's probe paid or came back empty. */
export const memoryTraceOutcomeEnum = pgEnum("memory_trace_outcome", TRACE_OUTCOME_VALUES);

/**
 * The three lesson vocabularies again, as the `[string, ...string[]]` tuples `pgEnum` requires.
 *
 * `contentKindEnum` is built from `CORPUS_KINDS` itself and this deliberately is NOT, which is a departure
 * worth stating. MEASURED: turning `LESSON_VERDICTS`, `LESSON_TIERS` and `LESSON_SURFACES` into
 * `as const` tuples so they could be passed here sends the `named-object-params` gate into unbounded
 * recursion — `RangeError: Maximum call stack size exceeded` inside its own `typeIsCallable`, reached
 * through `LESSON_TIERS.find(…)` and `.some(…)` once the receiver is a readonly TUPLE rather than an array.
 * Reproduce by restoring the `as const satisfies` form on `LESSON_TIERS` alone and running
 * `yarn tsx src/cli/index.ts dev lint --only named-object-params`; the numeric tier list is enough on its
 * own. Weakening that gate to pass was not an option, so the tuples live here instead.
 *
 * A second list is a list that eventually disagrees, so the agreement is a falsifiable TEST rather than a
 * hope: `src/__tests__/unit/store/schemaDrift.test.ts` asserts each of these equals its union's own array.
 * `satisfies` keeps a typo from compiling; the test keeps a MISSING member from shipping.
 */
const VERDICT_VALUES = [
  "confirmed",
  "changed",
  "refuted",
  "untestable",
  "unsettled",
] as const satisfies readonly LessonVerdict[];

/** Every surface, as a tuple. See {@link VERDICT_VALUES}. */
const SURFACE_VALUES = ["api", "browser", "cli", "repo", "process"] as const satisfies readonly LessonSurface[];

/** Every tier, as a tuple. See {@link VERDICT_VALUES}. */
export const MEMORY_TIER_VALUES = [1, 2, 3, 4] as const satisfies readonly LessonTier[];

/** What is currently believed about a memory's claim. */
export const memoryVerdictEnum = pgEnum("memory_verdict", VERDICT_VALUES);

/** Where a lesson was learned. */
export const memorySurfaceEnum = pgEnum("memory_surface", SURFACE_VALUES);

/** The lowest and highest tier, derived so a widened ladder cannot leave this CHECK behind. */
const TIER_LOW = Math.min(...MEMORY_TIER_VALUES);
const TIER_HIGH = Math.max(...MEMORY_TIER_VALUES);

/**
 * Every memory recording, with the generated search column that is the whole retrieval mechanism.
 *
 * `searchable` covers the domain, the claim, the evidence, the caveat and both placement fields, because a
 * recall query is a word a task mentions — a Datadog task, say — and the word may sit in any of them. It is
 * generated and STORED, so it cannot drift from the text beside it: there is no rebuild step to skip and no
 * second artefact to go stale, which is the failure of every hand-built index this replaces.
 */
export const memoriesTable = pgTable(
  "memories",
  {
    recordingId: uuid("recording_id").primaryKey().defaultRandom(),
    /**
     * Write order, and the ONLY tie-break between two recordings of one claim at the same instant.
     *
     * MEASURED through three review rounds, each finding the same class one
     * digit deeper: `recorded_at` is millisecond-precision in the register, `created_at` is microsecond
     * precision in Postgres but millisecond precision through `toISOString()`, and every timestamp-based
     * tie-break therefore collapses at SOME precision and falls through to an arbitrary `recording_id` —
     * showing an older `confirmed` where a newer `refuted` should be. A monotonic integer has no precision
     * to lose, so this ends the class rather than moving it.
     *
     * It is exported and restored VERBATIM, and the sequence is set past the highest restored value, so a
     * round trip preserves order exactly. Within one import transaction it ascends with the source line,
     * which is what makes an append-only file's own order the tie-break.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    id: text("id").notNull(),
    kind: memoryKindEnum("kind").notNull(),
    domain: text("domain").notNull(),
    claim: text("claim").notNull(),
    evidence: text("evidence").notNull(),
    verdict: memoryVerdictEnum("verdict").notNull(),
    tier: smallint("tier"),
    surface: memorySurfaceEnum("surface"),
    repro: text("repro"),
    question: text("question"),
    outcome: memoryTraceOutcomeEnum("outcome"),
    caveat: text("caveat"),
    learner: text("learner"),
    behaviourChange: text("behaviour_change"),
    retrievalCue: text("retrieval_cue"),
    run: text("run").notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    importKey: text("import_key"),
    // The claim id this recording retires. Nullable and unconstrained by a foreign key: `id` is deliberately
    // not unique (a repeat is the consolidation signal), so there is no key to reference; the write edge
    // checks the target exists and is the same kind (`../../knowledge/memoryRecordStore.ts`'s `recordMemory`).
    supersedes: text("supersedes"),
    searchable: tsvector("searchable").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`to_tsvector(
        'english',
        domain || ' ' || claim || ' ' || evidence || ' ' || coalesce(caveat, '') || ' ' ||
          coalesce(behaviour_change, '') || ' ' || coalesce(retrieval_cue, '')
      )`,
    ),
    createdAt: timestamp("created_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The retrieval mechanism. Everything else on this table is an ordinary filter.
    index("idx_memories_search").using("gin", table.searchable),
    // Latest-recording-per-claim and the repeat count both read this, in this order.
    index("idx_memories_claim_time").on(table.id, table.recordedAt.desc(), table.seq.desc()),
    uniqueIndex("uq_memories_seq").on(table.seq),
    index("idx_memories_domain_time").on(table.domain, table.recordedAt.desc()),
    index("idx_memories_learner_time").on(table.learner, table.recordedAt.desc()),
    // Every current-belief read asks, per claim, whether a later recording retired it.
    index("idx_memories_supersedes").on(table.supersedes),
    // The settle gate asks whether THIS run recorded anything since it started.
    index("idx_memories_run_time").on(table.run, table.recordedAt.desc()),
    // A second apply of the same source line is a no-op rather than a duplicate recording.
    uniqueIndex("uq_memories_import_key").on(table.importKey),
    // A lesson carries the facets that describe a failure; a preference carries none of them, because
    // nothing measured it and there is no harm ladder for a way of working. A trace carries its question,
    // its probe (in `repro`) and its outcome, and an EMPTY one must say what the emptiness does not prove
    // (in `caveat`) — the half of a dead end that stops it becoming a blind spot. Enforced rather than
    // assumed. `::text` on both enums for the reason `memoryKindEnum` gives.
    check(
      "memories_kind_facets",
      sql`(kind::text = 'lesson' and tier is not null and surface is not null
          and question is null and outcome is null)
        or (kind::text = 'preference' and tier is null and surface is null and repro is null
          and question is null and outcome is null)
        or (kind::text = 'trace' and tier is null and surface is null and repro is not null
          and question is not null and outcome is not null
          and (outcome::text = 'paid' or caveat is not null))`,
    ),
    check(
      "memories_tier_range",
      sql.raw(`tier is null or (tier >= ${String(TIER_LOW)} and tier <= ${String(TIER_HIGH)})`),
    ),
    // No private lane and no visibility column: the file this replaces was owner-only (0600), so the
    // conservative port denies the Slack-facing role outright rather than widening access in a migration.
    // A memory's evidence can quote a private channel, and a policy is the place that is visible in DDL.
    ...storeTablePolicies({ botRead: sql`false`, table: "memories" }),
  ],
);

/** A memory recording as the database returns it. */
export type MemoryRecordingRow = typeof memoriesTable.$inferSelect;

/** A memory recording as an insert takes it. */
export type NewMemoryRecordingRow = typeof memoriesTable.$inferInsert;
