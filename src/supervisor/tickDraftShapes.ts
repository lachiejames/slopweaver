/**
 * What `slopweaver supervisor tick-draft` READS: one Zod slice per producer document (the capacity and seat
 * ceiling slices are `./tickCapacityDraft.ts`'s, the watch slice `./tickDraftWatchShape.ts`'s, the gauge slice
 * `./tickGaugeShapes.ts`'s), and the primitives every mapper in `./tickDraftSources.ts`
 * is built from — the refusal, the witness, the instant, and the two
 * observation constructors.
 *
 * Split from the mappers when the pair crossed the file-size ratchet, along the seam they already had: this
 * file is the producers' side of the contract (their shapes and their own vocabularies), that one is the
 * judgement about what each reading means. A change to a producer's JSON lands here; a change to what counts
 * as an honest observation lands there.
 *
 * ## Why a slice, and why its enums are restated
 *
 * Each schema reads only the fields the tick facts need, so a producer growing an unrelated field is not
 * drift and does not refuse. But where the producer's own type is a CLOSED union — a listener grade, a
 * tolerance band, a capacity hold subject — the slice restates it, because a TypeScript union cannot become a
 * runtime schema and this ledger keeps its rows forever. A word this build does not recognise is a producer
 * that changed, and the draft refuses rather than carrying an unread word into a row nobody will revisit.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { type SupervisorCoreError, SupervisorCoreErrors } from "./errors.js";

import type { RecipeDueRowFacts, SourceObservation, TickSourceWitness } from "./tickTypes.js";

/**
 * The documents this verb reads — every source with a producer whose JSON can fill its facts, plus
 * `seatCeiling`, which fills no source of its own: it is folded into the capacity facts.
 */
export const DRAFTED_SOURCE_KINDS = [
  "capacity",
  "seatCeiling",
  "gauge",
  "listener",
  "reconcile",
  "watch",
  "closeDone",
  "recipeDue",
  "velocity",
  "friction",
] as const;

/** One drafted source's name. See {@link DRAFTED_SOURCE_KINDS}. */
export type DraftedSourceKind = (typeof DRAFTED_SOURCE_KINDS)[number];

/** Where each drafted source comes from: the flag its document arrives on, and the verb that printed it. */
export const DRAFTED_SOURCES: Readonly<
  Record<DraftedSourceKind, { readonly flag: string; readonly producer: string }>
> = {
  capacity: { flag: "capacity", producer: "slopweaver machine capacity --json" },
  closeDone: { flag: "close-done", producer: "slopweaver session close-done --json" },
  friction: { flag: "friction", producer: "slopweaver reflect friction-review --json" },
  gauge: { flag: "gauge", producer: "slopweaver claude gauge --json" },
  listener: { flag: "listener", producer: "slopweaver listen status --json" },
  recipeDue: { flag: "recipe-due", producer: "slopweaver automation due --json" },
  reconcile: { flag: "reconcile", producer: "slopweaver handover reconcile --json" },
  seatCeiling: { flag: "seat-ceiling", producer: "slopweaver fleet ceiling --days 7 --json" },
  velocity: { flag: "velocity", producer: "slopweaver velocity --json" },
  watch: { flag: "watch", producer: "slopweaver session watch --json-report" },
};

/** One document the tick redirected, as the verb read it. */
export interface CapturedDocument {
  /** Where it was read from, named in the witness and in any refusal. */
  readonly path: string;
  /** The parsed JSON, whatever shape it is in. */
  readonly document: unknown;
}

/** The tick's own frame: when it started, and the instant the caller asserts its undated reads were taken. */
export interface DraftFrame {
  readonly startedIso: string;
  readonly capturedIso: string;
}

/** One source's mapper: its captured document in, its observation out, or why the document was refused. */
export type SourceMapper<TFacts> = (options: {
  capture: CapturedDocument;
  frame: DraftFrame;
}) => Result<SourceObservation<TFacts>, SupervisorCoreError>;

/** An ISO instant with an offset — the tick schema's own instant shape, so a bad one refuses at the door. */
export const isoInstant = z.iso.datetime({ offset: true });

/** The command every observation this verb did not read from a document names. */
export const TICK_DRAFT_COMMAND = "slopweaver supervisor tick-draft";

/**
 * Parse one document against its producer's slice, or refuse naming the flag, the file and each issue.
 *
 * @param kind which source the document is for
 * @param capture the document and where it came from
 * @param schema the slice of the producer's JSON this source maps
 * @returns the parsed slice, or the refusal lines
 */
export function parseDocument<TSchema extends z.ZodType>({
  kind,
  capture,
  schema,
}: {
  kind: DraftedSourceKind;
  capture: CapturedDocument;
  schema: TSchema;
}): Result<z.output<TSchema>, SupervisorCoreError> {
  const parsed = schema.safeParse(capture.document);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const { flag, producer } = DRAFTED_SOURCES[kind];
  return err(
    SupervisorCoreErrors.documentNotProduced({ flag, issues: parsed.error.issues, path: capture.path, producer }),
  );
}

/**
 * The witness for a source read from a redirected file.
 *
 * @param kind which source
 * @param path the file read
 * @param dated whether the document carried its own capture instant
 * @returns the witness, with a null exit code
 */
export function documentWitness({
  kind,
  path,
  dated,
}: {
  kind: DraftedSourceKind;
  path: string;
  dated: boolean;
}): TickSourceWitness {
  const read = `read ${path}, the tick's redirected \`${DRAFTED_SOURCES[kind].producer}\``;
  if (dated) {
    return { command: read, exitCode: null };
  }
  return { command: `${read} (undated: observed at the caller's --captured instant)`, exitCode: null };
}

/**
 * An observation that records nothing, and why.
 *
 * @param witness what was, or was not, read
 * @param observedAtIso when the tick established it could not record the source
 * @param diagnostic why nothing was recorded
 * @returns the unavailable observation
 */
export function unavailableObservation({
  witness,
  observedAtIso,
  diagnostic,
}: {
  witness: TickSourceWitness;
  observedAtIso: string;
  diagnostic: string;
}): SourceObservation<never> {
  return { diagnostic, observedAtIso, status: "unavailable", witness };
}

/**
 * A reading with complete facts: `read` when nothing was left out, `partial` naming what was.
 *
 * @param facts the complete facts
 * @param notes every piece of coverage the facts leave out
 * @param observedAtIso when the reading was taken
 * @param verbatimLine the producer's own one-line summary, when it prints one
 * @param witness what was read
 * @returns the observation
 */
export function observationOf<TFacts>({
  facts,
  notes,
  observedAtIso,
  verbatimLine,
  witness,
}: {
  facts: TFacts;
  notes: readonly string[];
  observedAtIso: string;
  verbatimLine: string | undefined;
  witness: TickSourceWitness;
}): SourceObservation<TFacts> {
  if (notes.length === 0) {
    return { facts, observedAtIso, status: "read", verbatimLine, witness };
  }
  return { diagnostic: notes.join("; "), facts, observedAtIso, status: "partial", verbatimLine, witness };
}

/**
 * Where a dated document sits against the tick: its own instant, or `unavailable` when it predates the tick.
 *
 * @param kind which source
 * @param capture the document and where it came from
 * @param documentIso the instant the document says it was captured at
 * @param frame the tick's own frame
 * @returns the observation instant, and the stale refusal when the document is from another tick
 */
export function datedInstant({
  kind,
  capture,
  documentIso,
  frame,
}: {
  kind: DraftedSourceKind;
  capture: CapturedDocument;
  documentIso: string;
  frame: DraftFrame;
}): { observedAtIso: string; stale: SourceObservation<never> | undefined } {
  if (Date.parse(documentIso) >= Date.parse(frame.startedIso)) {
    return { observedAtIso: documentIso, stale: undefined };
  }
  const stale = unavailableObservation({
    diagnostic:
      `--${DRAFTED_SOURCES[kind].flag} ${capture.path} was captured at ${documentIso}, before this tick started ` +
      `at ${frame.startedIso}: a reading from another tick is not recorded as this one's`,
    observedAtIso: frame.capturedIso,
    witness: documentWitness({ dated: true, kind, path: capture.path }),
  });
  return { observedAtIso: frame.capturedIso, stale };
}

/**
 * The slice of `listen status --json` the listener facts map.
 *
 * `grade`, `socketState` and the loop checkout's `freshness.grade` are the producer's own closed vocabularies
 * (`ListenerGrade`, `ListenerSocketState`, `StandingFreshnessGrade`). See this file's header for why they are
 * restated rather than taken as strings.
 */
export const listenerSlice = z.object({
  armId: z.string().min(1).optional(),
  freshness: z.object({ grade: z.enum(["current", "behind", "stale", "unmeasured"]) }).optional(),
  grade: z.enum(["healthy", "degraded", "down", "unarmed"]),
  pid: z.number().int().optional(),
  problems: z.array(z.string()).optional(),
  socketState: z.enum(["connecting", "connected", "disconnected"]).optional(),
  why: z.string().min(1),
});

/**
 * The slice of `handover reconcile --json` the reconcile facts map. Owner turns stay tick-record's to read.
 *
 * `fleet`, `ready` and `unprioritised` are optional because a document from before they were read still maps its
 * counts; without them the open-ready count is simply not recorded.
 */
export const reconcileSlice = z.object({
  aligned: z.array(z.unknown()),
  fleet: z.enum(["observed", "unavailable"]).optional(),
  headline: z.string().min(1),
  intakeClause: z.string().min(1),
  misaligned: z.array(z.unknown()),
  rankedCount: z.number().int().nonnegative(),
  ready: z.array(z.object({ id: z.string().min(1) })).optional(),
  staleAsks: z.array(z.unknown()),
  starving: z.array(z.unknown()),
  unprioritised: z.array(z.unknown()).optional(),
  unregistered: z.array(z.unknown()),
});

/** One placement (`PlacedWork`) as far as the open-ready count reads it: the row it is on. */
export const placedRowSlice = z.object({ row: z.object({ id: z.string().min(1) }) });

/** The slice of `session close-done --json` the close-done facts map. */
export const closeDoneSlice = z.object({
  counts: z.object({
    closed: z.number().int().nonnegative(),
    driftClosed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    held: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
  }),
  dryRun: z.boolean(),
});

/** One row of `automation due --json`. `shape` and `tolerance.band` are the producer's own closed vocabularies. */
const dueRowSlice = z.object({
  actionable: z.boolean(),
  claim: z.object({ claimedBy: z.string().min(1) }).optional(),
  due: z.boolean(),
  recipeId: z.string().min(1),
  shape: z.enum(["run-here", "spawn", "no-executor"]),
  tolerance: z.object({
    band: z.enum(["comfortable", "urgent", "overdue", "unschedulable"]),
    lateByMs: z.number().nullable(),
  }),
});

/** One declared automation `automation due` reports the definition store lacking, or holding on an earlier cadence. */
const declaredRowSlice = z.object({ recipeId: z.string().min(1) });

/**
 * The slice of `automation due --json` the due facts map. `missing` and `superseded` are required: a schedule
 * read without them says nothing about the automations the store does not hold, which is how twenty absent
 * ones read as "nothing due".
 */
export const recipeDueSlice = z.object({
  missing: z.array(declaredRowSlice),
  nowIso: isoInstant,
  rejected: z.array(z.string()),
  rows: z.array(dueRowSlice),
  superseded: z.array(declaredRowSlice),
});

/**
 * Who holds a due recipe. `automation due` names the live claim holding a row and omits `claim` when nothing
 * holds it, so a row with none is held by nobody, which a tick row records as `null`. The other way a row
 * carries none, an unreadable claims file, leaves it unactionable, and {@link dueRowsOf} omits it before asking.
 */
function claimHolder({ row }: { row: z.output<typeof dueRowSlice> }): string | null {
  const { claim } = row;
  if (claim === undefined) {
    return null;
  }
  return claim.claimedBy;
}

/**
 * Every due row the tick schema can hold, and a note for each one it cannot.
 *
 * Two rows are omitted rather than represented, and each is a fact the tick has no field for: a row with no
 * executor or no parseable cadence has no `lateMinutes` to record, and a due, unclaimed row the producer
 * still calls unactionable is the shape its claims file produces when it could not be READ
 * (`live/automation/dueReport.ts`'s `rowIsActionable`) — recording `heldBy: null` there would turn "nobody knows"
 * into "nobody holds it".
 *
 * @param rows the due report's rows, due and not
 * @returns the representable rows, a note per omission, and how many were omitted
 */
export function dueRowsOf({ rows }: { rows: z.output<typeof recipeDueSlice>["rows"] }): {
  rows: readonly RecipeDueRowFacts[];
  notes: readonly string[];
  omitted: number;
} {
  const kept: RecipeDueRowFacts[] = [];
  const notes: string[] = [];
  let omitted = 0;
  for (const row of rows.filter((candidate) => candidate.due)) {
    const lateByMs = row.tolerance.lateByMs;
    if (row.shape === "no-executor" || lateByMs === null) {
      omitted += 1;
      notes.push(`${row.recipeId} is due but ${row.shape === "no-executor" ? "has no executor" : "unschedulable"}`);
      continue;
    }
    if (!row.actionable && row.claim === undefined) {
      omitted += 1;
      notes.push(`${row.recipeId} is due but unactionable with no claim, so its holder is not established`);
      continue;
    }
    kept.push({
      heldBy: claimHolder({ row }),
      id: row.recipeId,
      label: row.recipeId,
      lateMinutes: Math.floor(lateByMs / 60_000),
      runs: row.shape === "run-here" ? "in-process" : "spawn",
    });
  }
  return { notes, omitted, rows: kept };
}

/** The slice of `velocity --json` the velocity facts map. */
export const velocitySlice = z.object({
  caution: z.string().min(1),
  docsLandedByDay: z.array(z.object({ dayKey: z.string().min(1), landed: z.number().int().nonnegative() })),
});

/**
 * The slice of `reflect friction-review --json` the friction facts map.
 *
 * `isStale` is REQUIRED, not optional. A tick captures this document from the binary it just ran, so the
 * shapes agree by construction, and an optional field would need a `??` at the read — which the
 * `no-silent-fallback` gate refuses and which would restore the exact silence this field was added to end.
 * Refusing a document of the wrong shape is this tree's stated preference over quietly defaulting one.
 */
export const frictionSlice = z.object({
  hasGap: z.boolean(),
  isStale: z.boolean(),
  latestReportDate: z.string().min(1).nullable(),
});
