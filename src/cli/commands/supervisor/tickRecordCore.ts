/**
 * The pure half of `slopweaver supervisor tick-record`: what its flags mean, and how a DRAFT becomes a
 * finalised {@link SupervisorTickRow}.
 *
 * A draft is what a sweep can produce mechanically — the twelve source observations it took, the actions it
 * performed and any judgement it recorded — with the two things it must NOT compute itself left out: the
 * owner turns, which come off the reconciliation, and the stats, which are computed here so a row cannot
 * assert its own numbers.
 *
 * No I/O, no clock. `./tickRecordRun.ts` reads the draft and appends the row.
 */
import { z } from "zod";

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseSupervisorTickRow, supervisorTickStatsOf } from "../../../supervisor/tickSchema.js";
import {
  type OwnerTurnSnapshot,
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorTickRow,
} from "../../../supervisor/tickTypes.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type SupervisorError, SupervisorErrors } from "./errors.js";

export const SUPERVISOR_TICK_RECORD_USAGE =
  "usage: slopweaver supervisor tick-record --draft <json|-> --reconcile <json|-> [--home <dir>] " +
  "[--now <iso>] [--json]\n" +
  "\n" +
  "Appends ONE finalised tick to the supervisor tick ledger, from which the fleet briefing's `recent`,\n" +
  "`earlierToday` and `history` sections are derived rather than authored. --draft carries the tick's own\n" +
  "twelve source observations, its actions and any judgement; --reconcile is the `slopweaver handover\n" +
  "reconcile --json` document the tick already read, and is where the owner's own turns are taken from,\n" +
  "verbatim. Run it AFTER the tick's fill and re-arm decisions, so the row carries what the sweep did and\n" +
  "not only what it read.\n" +
  "\n" +
  "example: slopweaver supervisor tick-record --draft draft.json --reconcile reconcile.json";

/**
 * Every flag the verb takes, WITH the `--`, for the help-truth ratchet.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export const SUPERVISOR_TICK_RECORD_FLAG_NAMES: readonly string[] = [
  "--draft",
  "--reconcile",
  "--home",
  "--now",
  "--json",
];

/** A parsed invocation. */
export interface SupervisorTickRecordArgs {
  /** Where the draft is read from — a path, or `-` for stdin. */
  readonly draftSource: string;
  /** Where the reconciliation is read from — a path, or `-` for stdin. */
  readonly reconcileSource: string;
  readonly home: string | undefined;
  /** The instant the row is finalised at. Absent means the machine clock. */
  readonly now: string | undefined;
  readonly json: boolean;
}

/**
 * Parse the verb's argv tail.
 *
 * Both sources are required and at most one may be `-`: two readers of stdin would each consume part of one
 * stream and neither would get a whole document.
 *
 * @param rest the argv after `supervisor tick-record`
 * @returns the parsed arguments, or the operator-facing refusals
 */
export function parseSupervisorTickRecordArgs({ rest }: { rest: readonly string[] }): Result<SupervisorTickRecordArgs> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json"], value: ["draft", "reconcile", "home", "now"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const draftSource = values["draft"];
  const reconcileSource = values["reconcile"];
  if (draftSource === undefined) {
    errors.push("--draft <json|-> is required (use `-` to read the draft from stdin)");
  }
  if (reconcileSource === undefined) {
    errors.push("--reconcile <json|-> is required: the owner's own turns are taken from it, verbatim");
  }
  if (draftSource === "-" && reconcileSource === "-") {
    errors.push(
      "--draft and --reconcile cannot both read stdin: two readers of one stream each get part of one " +
        "document. Pass at least one as a path.",
    );
  }
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    draftSource: draftSource!,
    home: values["home"],
    json: flags.has("json"),
    now: values["now"],
    reconcileSource: reconcileSource!,
  });
}

/**
 * The draft a sweep hands in: everything a tick can record mechanically, minus the owner's turns and the
 * stats.
 *
 * Deliberately NOT the whole row. Leaving `ownerTurns` out means a sweep cannot compose them, which is the
 * same forcing `../briefing/renderCore.ts` puts on the projected sections of the page; leaving `stats` out
 * means the numbers that measure judgement's share are computed rather than claimed.
 */
export interface SupervisorTickDraft {
  readonly tickId: string;
  readonly workspace: string;
  readonly handoff: string;
  readonly startedIso: string;
  /**
   * The twelve source observations, the actions and the judgement, exactly as the draft carried them.
   *
   * `unknown` rather than the typed shapes, deliberately: {@link finaliseSupervisorTick} puts the assembled
   * row through `parseSupervisorTickRow`, which is the ONE door, so typing them here would be a second,
   * weaker claim about the same bytes — and a type assertion is checked by nobody.
   */
  readonly sources: unknown;
  readonly actions: unknown;
  readonly judgements: unknown;
}

/** The draft's own shape. Loose on the source facts, which `../../../supervisor/tickSchema.ts` re-checks. */
const draftSchema = z
  .object({
    actions: z.array(z.unknown()).optional(),
    handoff: z.string().min(1),
    judgements: z.array(z.unknown()).optional(),
    sources: z.record(z.string(), z.unknown()),
    startedIso: z.string().min(1),
    tickId: z.string().min(1),
    workspace: z.string().min(1),
  })
  .strict();

/**
 * One refusal line for a draft that is not one: where in the draft, then what is wrong there. An issue about
 * the document as a whole has no path, and is located at the draft itself.
 *
 * @param issue one schema issue
 * @returns the line to print
 */
function draftIssueLine({ issue }: { issue: z.core.$ZodIssue }): string {
  const location = issue.path.join(".");
  if (location === "") {
    return `draft: ${issue.message}`;
  }
  return `${location}: ${issue.message}`;
}

/**
 * One of the draft's two lists. A sweep that performed no action or recorded no judgement may leave the key
 * out, and that is the same tick as one that sent it empty.
 *
 * @param raw the schema-checked draft
 * @param key which list
 * @returns the list as the draft carried it, or an empty one
 */
function draftList({
  raw,
  key,
}: {
  raw: z.infer<typeof draftSchema>;
  key: "actions" | "judgements";
}): readonly unknown[] {
  const list = unsetFieldAsNull({ key, record: raw });
  if (list === null) {
    return [];
  }
  return list;
}

/**
 * Read a draft document.
 *
 * @param document the parsed draft JSON
 * @returns the draft, or one line per reason it could not be read as one
 */
export function parseSupervisorTickDraft({
  document,
}: {
  document: unknown;
}): Result<SupervisorTickDraft, SupervisorError> {
  const parsed = draftSchema.safeParse(document);
  if (!parsed.success) {
    return err(
      SupervisorErrors.notATickDraft({
        issues: parsed.error.issues.map((issue) => draftIssueLine({ issue })),
      }),
    );
  }
  const raw = parsed.data;
  return ok({
    actions: draftList({ key: "actions", raw }),
    handoff: raw.handoff,
    judgements: draftList({ key: "judgements", raw }),
    sources: raw.sources,
    startedIso: raw.startedIso,
    tickId: raw.tickId,
    workspace: raw.workspace,
  });
}

/**
 * Assemble the finalised row: the draft, the owner turns read off the reconciliation, and the computed stats.
 *
 * It goes through `../../../supervisor/tickSchema.ts`'s `parseSupervisorTickRow`, which is the ONE door a
 * row comes through, so a draft that is the wrong shape is refused here rather than at the next read.
 *
 * @param draft what the sweep recorded mechanically
 * @param ownerTurns the snapshot taken off the reconciliation
 * @param finalisedIso the instant the row is being written at
 * @returns the validated row, or one line per reason it was refused
 */
export function finaliseSupervisorTick({
  draft,
  ownerTurns,
  finalisedIso,
}: {
  draft: SupervisorTickDraft;
  ownerTurns: OwnerTurnSnapshot;
  finalisedIso: string;
}): Result<SupervisorTickRow> {
  return parseSupervisorTickRow({
    value: {
      actions: draft.actions,
      finalisedIso,
      handoff: draft.handoff,
      judgements: draft.judgements,
      ownerTurns,
      schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
      sources: draft.sources,
      startedIso: draft.startedIso,
      stats: supervisorTickStatsOf({
        actions: draft.actions,
        judgements: draft.judgements,
        ownerTurns,
        sources: draft.sources,
      }),
      tickId: draft.tickId,
      workspace: draft.workspace,
    },
  });
}
