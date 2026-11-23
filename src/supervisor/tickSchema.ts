/**
 * The tick ledger's parser — the one door a {@link SupervisorTickRow} comes through.
 *
 * Strict by construction: every object refuses a key nobody declared, so a source that grows a field says so
 * at the recorder rather than carrying an unread half of itself into the ledger forever. This is a LEDGER
 * rather than an outbound form, so `strictForm` and the `outbound-form-strict` rule do not apply to it — the
 * strictness here is `z.object(…).strict()`, chosen for the same reason rather than by that rule.
 *
 * ## The cross-field checks, and why each is a refusal rather than a warning
 *
 * A row is the durable record of one tick, and this ledger holds the owner's words. So the checks below all share
 * one property: each catches a row that would still PARSE and would then be silently wrong on the page.
 *
 * The checks themselves live in `./tickRowDefects.ts`, beside the `stats` check this parser makes.
 *
 * - **Every source accounted for.** `REQUIRED_TICK_SOURCES` is total, so a step the tick skipped is an
 *   `unavailable` observation with a diagnostic rather than a missing key. The failure being closed is the
 *   one where a source is absent and the page reads that as a quiet fleet.
 * - **Observations inside the tick's own interval.** An `observedAtIso` before `startedIso` or after
 *   `finalisedIso` is a reading from another tick pasted into this one.
 * - **`finalisedIso` at or after `startedIso`.** A negative interval is a clock or a copy-paste, never a tick.
 * - **Unique ids within the row.** An action or a judgement sharing an id with another makes the
 *   projection's own conservation receipt uncountable, which is the mechanism that proves nothing was lost.
 * - **`stats` matching the row.** The counts are what make judgement regrowth measurable; a row free to
 *   assert its own numbers measures nothing.
 *
 * ## The one place strictness INVERTS, and it is a class rather than three exceptions
 *
 * Everything a tick MINTS is strict, because a wrong value there is our defect and a refusal catches it.
 * Everything a tick CARRIES from somewhere else is permissive — the owner's turns, the ruling attached to
 * one, the chain's own coverage — because a refusal there catches nothing and instead drops the owner's words,
 * taking the whole tick with them: this recorder appends nothing on a validation error, so one bad field in
 * one turn discards every other turn in that sweep.
 *
 * That class was first found one instance at a time — an instant that would not parse, then two turns
 * sharing a pointer — which is exactly how a class regenerates when it is only ever fixed as instances. It
 * is written here once instead.
 *
 * Pure — no clock, no filesystem. `./tickStore.ts` is the edge.
 */
import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";
import { capacityFactsSchema } from "./tickCapacitySchema.js";
import { gaugeFactsSchema } from "./tickGaugeSchema.js";
import { TICK_ACTION_KINDS, TICK_SUBJECT_KINDS } from "./tickKinds.js";
import { tickRowDefects } from "./tickRowDefects.js";
import {
  closeDoneFacts,
  depthFacts,
  frictionFacts,
  githubFacts,
  isoInstant,
  landingsFacts,
  listenerFacts,
  recipeDueFacts,
  reconcileFacts,
  text,
  velocityFacts,
  watchFacts,
} from "./tickSourceFactsSchema.js";
import { SUPERVISOR_TICK_SCHEMA_VERSION, type SupervisorTickRow, type SupervisorTickStats } from "./tickTypes.js";

/** What produced one source's facts. `exitCode` is null when no exit was watched, never a stand-in zero. */
const witnessSchema = z
  .object({
    command: text,
    exitCode: z.number().int().nullable(),
  })
  .strict();

/**
 * One source's observation, over whichever facts that source yields.
 *
 * A discriminated union on `status` rather than a flat object with optional fields, so `partial` cannot be
 * recorded without its diagnostic and `unavailable` cannot smuggle facts through.
 *
 * The return type is INFERRED rather than annotated as `z.ZodType<SourceObservation<…>>`, and that is not an
 * omission: Zod cannot prove a generic union's output against a hand-written interface inside the generic's
 * own body, so annotating it would force the double cast this repository bans. The proof is at the other
 * end instead — {@link parseSupervisorTickRow} assigns the parsed row to `SupervisorTickRow`, so the whole
 * schema's inferred output is checked against the declared type once, where the generic is resolved.
 *
 * @param facts the schema for this source's own facts
 * @returns the observation schema
 */
function observationOver<TFacts extends z.ZodType>({ facts }: { facts: TFacts }) {
  return z.discriminatedUnion("status", [
    z
      .object({
        facts,
        observedAtIso: isoInstant,
        status: z.literal("read"),
        verbatimLine: text.optional(),
        witness: witnessSchema,
      })
      .strict(),
    z
      .object({
        diagnostic: text,
        facts,
        observedAtIso: isoInstant,
        status: z.literal("partial"),
        verbatimLine: text.optional(),
        witness: witnessSchema,
      })
      .strict(),
    z
      .object({
        diagnostic: text,
        observedAtIso: isoInstant,
        status: z.literal("unavailable"),
        witness: witnessSchema,
      })
      .strict(),
  ]);
}

/** Every source's observation, one field per source kind. */
const sourcesSchema = z
  .object({
    capacity: observationOver({ facts: capacityFactsSchema }),
    closeDone: observationOver({ facts: closeDoneFacts }),
    depth: observationOver({ facts: depthFacts }),
    friction: observationOver({ facts: frictionFacts }),
    gauge: observationOver({ facts: gaugeFactsSchema }),
    github: observationOver({ facts: githubFacts }),
    landings: observationOver({ facts: landingsFacts }),
    listener: observationOver({ facts: listenerFacts }),
    recipeDue: observationOver({ facts: recipeDueFacts }),
    reconcile: observationOver({ facts: reconcileFacts }),
    velocity: observationOver({ facts: velocityFacts }),
    watch: observationOver({ facts: watchFacts }),
  })
  .strict();

/**
 * What the board or the intake ledger says a turn became.
 *
 * Permissive for the reason {@link ownerTurnSchema} is: narrowing an unrecognised kind would delete the
 * witness and its text together, and the witness is how a reader tells an answered turn from an open one.
 */
const turnWitnessSchema = z
  .object({
    kind: z.string(),
    witness: z.string(),
  })
  .strict();

/**
 * One lock-in row, carried whole so a ruling keeps what was proposed and why. Mirrors `LockInRow`.
 *
 * Permissive for the reason {@link ownerTurnSchema} is: a ruling is read off a ledger this code did not
 * write, so refusing a field would drop the owner's ruling rather than catch a defect of ours.
 */
const lockInRowSchema = z
  .object({
    againstWhenIso: z.string(),
    deferredUntilIso: z.string().optional(),
    identity: z.string(),
    note: z.string().optional(),
    outcome: z.string(),
    proposed: z.string(),
    reason: z.string().optional(),
    tsIso: z.string(),
    verb: z.string(),
  })
  .strict();

/**
 * One owner turn, exactly as the owner typed it.
 *
 * ## Every field a turn CARRIES is permissive, and that is the opposite of the rest of this file
 *
 * Everywhere else here a wrong value is refused, because everywhere else the value is ours and a refusal
 * catches a defect. A turn is not ours: it is decoded off a transcript this code did not write, and
 * `../supervisor/chairTranscript.ts` deliberately RETAINS a turn whose instant will not parse rather than
 * dropping it. So a strict field here does not catch a defect — it loses the owner's words, which is the one thing
 * this ledger exists to prevent, and it loses the WHOLE tick with them because the recorder appends nothing
 * on a validation error.
 *
 * MEASURED: with `instantIso` held to
 * `z.iso.datetime()`, one turn carrying `timestamp: "not-an-instant"` made `supervisor tick-record` exit 1
 * with `ownerTurns.turns.0.instantIso: Invalid ISO datetime` and append zero lines — so a single unreadable
 * clock field discarded every other turn in that tick. `text` was already `z.string()` for the same reason,
 * and the rest of the fields now follow it.
 *
 * The instant is therefore recorded AS CARRIED. `null` still means the transcript line held none — see
 * `./tickOwnerTurns.ts`'s `instantOf` — and anything else goes in unchanged for a reader to judge.
 *
 * **Every REFINEMENT is off, not just the obvious ones.** No `.min(1)`, no `.int()`, no `.nonnegative()`,
 * no enum. Five Codex review passes found this class one field at a time — the instant, the pointer's
 * uniqueness, the source label, the witness kind, and finally a `lineNumber` of `1.5` — so the rule here is
 * the SHAPE a JSON value has and nothing narrower. `lockInLink` keeps its enum because this code computes
 * it; everything else on a turn came from somewhere else.
 *
 * **That enum's arm was renamed, and a row written under the OLD spelling is refused** — named here rather
 * than left for a reader to hit, because `readSupervisorTickWindow` refuses a ledger at its first
 * unparseable row, so one such tick would take every later one with it. Two things make that survivable
 * and neither is an assumption. It cannot happen on the only ledger there is: 31,670 rows, every
 * `lockInLink` reading `none` and not one carrying the old spelling — repro
 * `jq -r '..|.lockInLink?|select(.)' "$SLOPWEAVER_HOME/ledgers/supervisor/supervisor-ticks.jsonl" | sort -u`.
 * And a read-side rewrite could not have fixed it anyway: `parseSupervisorTickRow` recomputes
 * `stats.structuredUtf8Bytes` over the PARSED row, so mapping the old value to the new one turns an enum
 * refusal into a byte-count refusal eight bytes wide. A tolerance that actually worked would have to
 * measure the stats against the raw line rather than the parsed row, which is a change to a load-bearing
 * check and a follow-up rather than this gate's to make. `unit/supervisor/tickSchema.test.ts` pins both
 * halves.
 */
const ownerTurnSchema = z
  .object({
    inGrace: z.boolean(),
    instantIso: z.string().nullable(),
    lockIn: lockInRowSchema.nullable(),
    lockInLink: z.enum(["linked", "none", "recorded-before-pointer"]),
    pointer: z.string(),
    sessionId: z.string(),
    source: z.string(),
    text: z.string(),
    transcriptLineNumber: z.number().nullable(),
    turnUuid: z.string(),
    witness: turnWitnessSchema.nullable(),
  })
  .strict();

/**
 * What the chain walk could and could not see. Mirrors `./chain.ts`'s `ChainCoverage`.
 *
 * Permissive for the reason {@link ownerTurnSchema} is: this is the reconciliation's own reading, and a
 * refusal here would take the turns down with it.
 */
const chainCoverageSchema = z
  .object({
    earliestIso: z.string().optional(),
    linksKnown: z.number().nullable(),
    reachesSince: z.boolean(),
    unreadable: z.array(z.object({ claudeSessionId: z.string(), why: z.string() }).strict()),
    walked: z.array(z.string()),
  })
  .strict();

/** Every owner turn since the previous tick, or the reason there is no such list. */
const ownerTurnsSchema = z.discriminatedUnion("status", [
  z
    .object({
      coverage: chainCoverageSchema,
      diagnostic: text.optional(),
      sinceIso: z.string().nullable(),
      status: z.literal("read"),
      turns: z.array(ownerTurnSchema),
    })
    .strict(),
  z
    .object({
      coverage: chainCoverageSchema,
      diagnostic: text,
      sinceIso: z.string().nullable(),
      status: z.literal("partial"),
      turns: z.array(ownerTurnSchema),
    })
    .strict(),
  z
    .object({
      diagnostic: text,
      sinceIso: z.string().nullable(),
      status: z.literal("unavailable"),
      turns: z.array(z.never()).max(0),
    })
    .strict(),
]);

/** What an action or a judgement is about. */
const subjectSchema = z
  .object({
    id: text,
    kind: z.enum(TICK_SUBJECT_KINDS),
    label: text,
  })
  .strict();

/** Where the evidence lives. */
const evidenceSchema = z
  .object({
    kind: z.enum(["command", "ledger", "transcript", "artifact", "provider"]),
    ref: text,
  })
  .strict();

/** One thing the sweep did. */
export const actionSchema = z
  .object({
    actionId: text,
    detail: text.optional(),
    kind: z.enum(TICK_ACTION_KINDS),
    outcome: z.enum(["completed", "held", "failed"]),
    recordedIso: isoInstant,
    subject: subjectSchema,
    witness: evidenceSchema,
  })
  .strict();

/** One call no verb emits. */
export const judgementSchema = z
  .object({
    claim: text,
    judgementId: text,
    kind: z.enum(["cross-source-causal-link", "watch-disposition", "hold-rationale", "priority-call", "exception"]),
    recordedIso: isoInstant,
    /** Optional: every row journalled before a hold-rationale could name its ceiling carries none. */
    relatedSubjects: z.array(subjectSchema).optional(),
    subject: subjectSchema,
    whyNotDerived: z.enum(["cross-source-inference", "intent-interpretation", "risk-call", "operational-context"]),
    witness: evidenceSchema,
  })
  .strict();

/** What the row weighs, split so judgement's share is measured rather than asserted. */
const statsSchema = z
  .object({
    judgementCount: z.number().int().nonnegative(),
    judgementUtf8Bytes: z.number().int().nonnegative(),
    structuredUtf8Bytes: z.number().int().nonnegative(),
  })
  .strict();

/** The whole row, before the cross-field checks {@link parseSupervisorTickRow} applies. */
const rowSchema = z
  .object({
    actions: z.array(actionSchema),
    finalisedIso: isoInstant,
    handoff: text,
    judgements: z.array(judgementSchema),
    ownerTurns: ownerTurnsSchema,
    schemaVersion: z.literal(SUPERVISOR_TICK_SCHEMA_VERSION),
    sources: sourcesSchema,
    startedIso: isoInstant,
    stats: statsSchema,
    tickId: text,
    workspace: text,
  })
  .strict();

/**
 * Count one string's bytes as UTF-8, which is what the ledger and the page are both measured in.
 *
 * @param value the string
 * @returns its byte length
 */
function utf8Bytes({ value }: { value: string }): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * The judgement bytes and the structured bytes of one row, computed the one way both the recorder and this
 * check compute them.
 *
 * Judgement bytes are the judgements' own JSON, structured bytes everything else. Splitting on the serialised
 * form rather than on a prose length is what makes the number reproducible: two readers of the same row get
 * the same answer, and a row asserting different numbers is refused.
 *
 * It takes the four pieces rather than a whole row so the RECORDER can compute the numbers before the row
 * exists — a row is not valid until its stats are right, so the stats cannot need a valid row.
 *
 * @param actions the row's actions
 * @param judgements the row's judgements
 * @param ownerTurns the row's owner-turn snapshot
 * @param sources the row's source observations
 * @returns the two byte counts and the judgement count
 */
export function supervisorTickStatsOf({
  actions,
  judgements,
  ownerTurns,
  sources,
}: {
  actions: unknown;
  judgements: unknown;
  ownerTurns: unknown;
  sources: unknown;
}): { judgementCount: number; judgementUtf8Bytes: number; structuredUtf8Bytes: number } {
  const judgementUtf8Bytes = utf8Bytes({ value: JSON.stringify(judgements) });
  const whole = utf8Bytes({ value: JSON.stringify({ actions, judgements, ownerTurns, sources }) });
  return {
    judgementCount: Array.isArray(judgements) ? judgements.length : 0,
    judgementUtf8Bytes,
    structuredUtf8Bytes: whole - judgementUtf8Bytes,
  };
}

/**
 * What every check on one row found, with the `stats` disagreement held APART from every other defect.
 *
 * Apart because exactly one caller tolerates it: `./tickReseal.ts` rewrites a carried row whose numbers went
 * stale while its content stayed sound. {@link parseSupervisorTickRow} refuses both kinds alike, so the two
 * readers share this one check list rather than each keeping a copy that could drift.
 */
export interface SupervisorTickRowAudit {
  /** The row as the schema read it, its recorded `stats` untouched. */
  readonly row: SupervisorTickRow;
  /** Every cross-field defect except the stats disagreement, in the order the checks found them. */
  readonly defects: readonly string[];
  /** The stats the row's own content measures to. */
  readonly computedStats: SupervisorTickStats;
  /** The stats disagreement's line, or `undefined` when the recorded numbers match the content. */
  readonly statsDefect: string | undefined;
}

/**
 * Run the schema and every cross-field check on one row, keeping the stats disagreement apart.
 *
 * @param value the parsed JSON, whatever shape it is in
 * @returns the audit, or one line per schema issue when the shape itself is refused
 */
export function auditSupervisorTickRow({ value }: { value: unknown }): Result<SupervisorTickRowAudit> {
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`));
  }
  const row: SupervisorTickRow = parsed.data;
  const computedStats = supervisorTickStatsOf({
    actions: row.actions,
    judgements: row.judgements,
    ownerTurns: row.ownerTurns,
    sources: row.sources,
  });
  let statsDefect: string | undefined;
  if (
    computedStats.judgementCount !== row.stats.judgementCount ||
    computedStats.judgementUtf8Bytes !== row.stats.judgementUtf8Bytes ||
    computedStats.structuredUtf8Bytes !== row.stats.structuredUtf8Bytes
  ) {
    statsDefect =
      `stats disagree with the row: recorded ${String(row.stats.judgementCount)} judgement(s), ` +
      `${String(row.stats.judgementUtf8Bytes)}/${String(row.stats.structuredUtf8Bytes)} bytes; ` +
      `computed ${String(computedStats.judgementCount)}, ${String(computedStats.judgementUtf8Bytes)}/` +
      `${String(computedStats.structuredUtf8Bytes)}. A row free to assert its own numbers measures nothing.`;
  }
  return ok({ computedStats, defects: tickRowDefects({ row }), row, statsDefect });
}

/**
 * Read one row, applying every cross-field check the shape alone cannot express.
 *
 * @param value the parsed JSON, whatever shape it is in
 * @returns the typed row, or one line per reason it was refused
 */
export function parseSupervisorTickRow({ value }: { value: unknown }): Result<SupervisorTickRow> {
  return auditSupervisorTickRow({ value }).andThen((audit) => {
    const defects = [...audit.defects];
    if (audit.statsDefect !== undefined) {
      defects.push(audit.statsDefect);
    }
    if (defects.length > 0) {
      return err(defects);
    }
    return ok(audit.row);
  });
}
