/**
 * The outcome coverage on a `handover reconcile --json` document, read back STRICTLY — the one reader the sweep gate
 * (`./sweepGate.ts`) and the successor summary (`../../cli/commands/supervisor/successorSummaryRun.ts`) share.
 *
 * The owner's outcomes come from the Workstreams register alone (`./coverage.ts`), and a fresh install has no register yet.
 * So the reconciliation says WHICH of two states it read, as `outcomeSource`:
 *
 * - `{ kind: "absent" }` — no register exists, so there are no outcomes to be covered. That is a readable state
 *   with nothing owed, never a failed read, and it must carry zero rows.
 * - `{ kind: "present", count }` — the register was read and projected into `count` outcomes, so exactly that many
 *   rows must follow.
 *
 * Anything else is unreadable. The document's whole outcome half — {@link EmittedOutcomeFields}: the source, the rows,
 * `uncoveredOutcomes` and `unanchoredOutcomes` — is read by ONE strict schema mirroring exactly what reconcile emits:
 * the source a discriminated union whose `absent` arm carries its kind alone, each row its {@link OutcomeCoverage},
 * each live entry a {@link PlacedWork} and each waiting row a {@link BoardRow}. Every emitted field is required, every
 * string non-empty, every enum the emitter's own, and an unknown key refused at every level, so a stray `count` on an
 * `absent` source refuses rather than being ignored. Each field table is checked against the emitter's type at compile
 * time, and the source's type is DERIVED from its schema and written by reconcile, so neither can drift from the
 * reader. What the schema cannot see is checked after it: a count the rows disagree with, rows or unanchored entries
 * beside an absent source, and an `uncoveredOutcomes` that is not what the rows leave uncovered. A malformed field is
 * never read as an empty one, because an empty string where an id belongs is how a gate ends up reporting clean on a
 * comparison it never made.
 *
 * Pure: a parsed document in, a typed result out.
 */
import { z } from "zod";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import type { BoardRow } from "../../handover/rank.js";
import type { PlacedWork } from "../../handover/reconcile.js";
import type { BoardPriority, BoardRowKind } from "../../handover/rowKind.js";
import type { RowStanding } from "../../handover/rowStanding.js";

import { type OutcomeCoverage, uncoveredIds } from "./coverage.js";

/**
 * One outcome's coverage, as the reconciliation reported it.
 *
 * @internal — the element type of {@link ReconciledOutcomes.outcomes}; callers read the whole result.
 */
export interface ReconciledOutcome {
  readonly id: string;
  readonly title: string;
  /** The owner's words for it, verbatim off the register entry. */
  readonly words: string;
  /** Where the owner said it. */
  readonly anchor: string;
  /** The live sessions on a row under it. */
  readonly liveSessions: readonly string[];
  /** The ready rows under it nobody is on, highest first. */
  readonly unspawned: readonly { readonly id: string; readonly label: string }[];
}

/** Which outcome source the reconciliation read, and the outcomes it carried. */
export interface ReconciledOutcomes {
  /** `absent` when no register exists yet; `present` when it was read. */
  readonly source: "absent" | "present";
  readonly outcomes: readonly ReconciledOutcome[];
}

/**
 * The reconciliation's outcome coverage could not be read as either source state.
 *
 * @internal — the one arm of {@link ReconciledOutcomesError}; callers read `code` and `message` off the union.
 */
export interface ReconciledOutcomesUnreadableError {
  readonly code: "RECONCILED_OUTCOMES_UNREADABLE";
  readonly message: string;
}

/** Why the outcome coverage on a reconciliation was not read. */
export type ReconciledOutcomesError = ReconciledOutcomesUnreadableError;

/**
 * Builds every {@link ReconciledOutcomesError}.
 *
 * @internal — only {@link readReconciledOutcomes} mints one; its callers read the error it returns.
 */
export const ReconciledOutcomesErrors = {
  unreadable: ({ why }: { why: string }): ReconciledOutcomesUnreadableError => ({
    code: "RECONCILED_OUTCOMES_UNREADABLE",
    message: `${why} — re-run \`slopweaver handover reconcile --json\` with this checkout, which reads the owner's outcomes off the Workstreams register`,
  }),
} as const;

/** A string reconcile always fills. */
const filled = z.string().min(1);

/** Every {@link BoardRowKind}, each key its own value, so a kind added to the type and not here fails to build. */
const ROW_KINDS = { ask: "ask", doc: "doc", tag: "tag" } as const satisfies { [K in BoardRowKind]: K };

/** Every {@link BoardPriority}, checked against the type the same way. */
const PRIORITIES = { p0: "p0", p1: "p1", p2: "p2", p3: "p3" } as const satisfies { [K in BoardPriority]: K };

/** Every {@link RowStanding}, checked against the type the same way. */
const STANDINGS = {
  blocked: "blocked",
  "in-flight": "in-flight",
  paused: "paused",
  ready: "ready",
  "waiting-on-owner": "waiting-on-owner",
} as const satisfies { [K in RowStanding]: K };

/** A {@link BoardRow} as JSON carries it: `openedIso` is absent rather than `undefined`, which JSON drops. */
const boardRowSchema = z.strictObject({
  groomed: z.boolean(),
  id: filled,
  kind: z.enum(ROW_KINDS),
  label: filled,
  openedIso: filled.optional(),
  priority: z.enum(PRIORITIES),
  ready: z.boolean(),
  ruled: z.boolean(),
  standing: z.enum(STANDINGS),
  waitingHours: z.number().int().nonnegative(),
} satisfies Record<keyof BoardRow, z.ZodType>);

/** A {@link PlacedWork}: a live session, the row it is on, and that row's 1-based rank. */
const placedSchema = z.strictObject({
  rank: z.number().int().positive(),
  row: boardRowSchema,
  session: filled,
} satisfies Record<keyof PlacedWork, z.ZodType>);

/** One {@link OutcomeCoverage} row exactly as reconcile emits it under `outcomes`. */
const outcomeRowSchema = z.strictObject({
  anchor: filled,
  id: filled,
  live: z.array(placedSchema),
  rows: z.number().int().nonnegative(),
  title: filled,
  unspawned: z.array(boardRowSchema),
  words: filled,
} satisfies Record<keyof OutcomeCoverage, z.ZodType>);

/** `absent`: no register exists yet, so the source carries its kind and nothing else. */
const absentSourceSchema = z.strictObject({ kind: z.literal("absent") });

/** `present`: the register was read and projected into `count` outcomes, so exactly that many rows follow. */
const presentSourceSchema = z.strictObject({ count: z.number().int().nonnegative(), kind: z.literal("present") });

/** The two source states reconcile writes, told apart by `kind`. */
const outcomeSourceSchema = z.discriminatedUnion("kind", [absentSourceSchema, presentSourceSchema]);

/** Which outcome source a reconciliation read: the type reconcile writes, derived from the schema that reads it back. */
export type OutcomeSource = z.output<typeof outcomeSourceSchema>;

/** The outcome half of a `handover reconcile --json` document, exactly as reconcile emits it. */
export interface EmittedOutcomeFields {
  readonly outcomeSource: OutcomeSource;
  readonly outcomes: readonly OutcomeCoverage[];
  /** The ids of the rows with a ready row waiting and nobody on them, in row order. */
  readonly uncoveredOutcomes: readonly string[];
  /** The register entries left out for citing nothing checkable. */
  readonly unanchoredOutcomes: readonly string[];
}

/** {@link EmittedOutcomeFields}, every field read strictly. */
const outcomeFieldsSchema = z.strictObject({
  outcomeSource: outcomeSourceSchema,
  outcomes: z.array(outcomeRowSchema),
  unanchoredOutcomes: z.array(filled),
  uncoveredOutcomes: z.array(filled),
} satisfies Record<keyof EmittedOutcomeFields, z.ZodType>);

/**
 * The outcome half as the strict schema reads it back.
 *
 * @internal — {@link readEmittedOutcomeFields}' result; a caller reads the fields it returns.
 */
export type ReadOutcomeFields = z.output<typeof outcomeFieldsSchema>;

/**
 * Say which field failed, from the schema's first complaint: a row by its index and id, a field by its path, and a
 * field the document never carried as one it names no value for.
 *
 * @param document the reconciliation the complaint was made about
 * @returns the reason a refusal carries
 */
function fieldsRefusal({ document, issue }: { document: Record<string, unknown>; issue: z.core.$ZodIssue }): string {
  const [key, index, ...rest] = issue.path;
  if (key === "outcomes" && typeof index === "number") {
    const rows = document["outcomes"];
    const entry: unknown = Array.isArray(rows) ? rows[index] : undefined;
    const id = isRecord(entry) && typeof entry["id"] === "string" && entry["id"] !== "" ? ` "${entry["id"]}"` : "";
    const at = rest.length === 0 ? "the row itself" : `\`${rest.map(String).join(".")}\``;
    return `the reconciliation's outcome row ${String(index)}${id} is malformed at ${at}: ${issue.message}`;
  }
  if (issue.path.length === 1 && document[String(key)] === undefined) {
    return `the reconciliation names no \`${String(key)}\``;
  }
  return `the reconciliation's \`${issue.path.map(String).join(".")}\` is malformed: ${issue.message}`;
}

/**
 * What the schema cannot see: the fields disagreeing with one another.
 *
 * @param fields the outcome half, already read strictly
 * @returns why the fields contradict each other, or `null` when they agree
 */
function disagreement({ fields }: { fields: ReadOutcomeFields }): string | null {
  const { outcomeSource, outcomes, unanchoredOutcomes, uncoveredOutcomes } = fields;
  if (outcomeSource.kind === "absent" && outcomes.length > 0) {
    return `the reconciliation says no register exists yet but carries ${String(outcomes.length)} outcome(s)`;
  }
  if (outcomeSource.kind === "absent" && unanchoredOutcomes.length > 0) {
    return `the reconciliation says no register exists yet but names ${String(unanchoredOutcomes.length)} unanchored entry(ies)`;
  }
  if (outcomeSource.kind === "present" && outcomes.length !== outcomeSource.count) {
    return `the reconciliation's register held ${String(outcomeSource.count)} outcome(s) but it carries ${String(outcomes.length)}`;
  }
  const uncovered = uncoveredIds({ outcomes });
  if (uncovered.join("\n") !== uncoveredOutcomes.join("\n")) {
    return `the reconciliation's \`uncoveredOutcomes\` is [${uncoveredOutcomes.join(", ")}] but its rows leave [${uncovered.join(", ")}] with nobody on them`;
  }
  return null;
}

/**
 * Read a reconciliation's whole outcome half through the one strict schema, then check its fields agree, refusing
 * the whole document on the first failure and naming the row and field.
 *
 * @param reconciliation the parsed `handover reconcile --json` document
 * @returns the outcome half exactly as reconcile emitted it, or why it did not read
 */
export function readEmittedOutcomeFields({
  reconciliation,
}: {
  reconciliation: unknown;
}): Result<ReadOutcomeFields, ReconciledOutcomesError> {
  if (!isRecord(reconciliation)) {
    return err(ReconciledOutcomesErrors.unreadable({ why: "the reconciliation is not a document" }));
  }
  const half = Object.fromEntries(Object.keys(outcomeFieldsSchema.shape).map((key) => [key, reconciliation[key]]));
  const parsed = outcomeFieldsSchema.safeParse(half);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return err(ReconciledOutcomesErrors.unreadable({ why: fieldsRefusal({ document: reconciliation, issue }) }));
  }
  const why = disagreement({ fields: parsed.data });
  if (why !== null) {
    return err(ReconciledOutcomesErrors.unreadable({ why }));
  }
  return ok(parsed.data);
}

/**
 * What the gate and the summary take off one strictly read row.
 *
 * @returns the row's words, anchor, live sessions and unspawned rows
 */
function projected({ row }: { row: ReadOutcomeFields["outcomes"][number] }): ReconciledOutcome {
  return {
    anchor: row.anchor,
    id: row.id,
    liveSessions: row.live.map((placed) => placed.session),
    title: row.title,
    unspawned: row.unspawned.map((one) => ({ id: one.id, label: one.label })),
    words: row.words,
  };
}

/**
 * Read the outcome coverage off a reconciliation document, strictly.
 *
 * @param reconciliation the parsed `handover reconcile --json` document
 * @returns which source was read and its outcomes, or why the coverage is unreadable
 */
export function readReconciledOutcomes({
  reconciliation,
}: {
  reconciliation: unknown;
}): Result<ReconciledOutcomes, ReconciledOutcomesError> {
  return readEmittedOutcomeFields({ reconciliation }).map((fields) => ({
    outcomes: fields.outcomes.map((row) => projected({ row })),
    source: fields.outcomeSource.kind,
  }));
}
