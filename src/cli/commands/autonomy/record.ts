/**
 * `slopweaver autonomy record` — write ONE act taken under graduated autonomy into the register.
 *
 * Every rule is checked by `../../../autonomy/row.ts` rather than here, so a caller that is not this CLI
 * cannot skip one. This module's own job is the argv edge: turn flags into the builder's arguments, and turn
 * a typed error into a line a session can act on.
 *
 * ## The clock is the only seam
 *
 * `--done-iso` defaults to now, because the common call is a session recording what it just did. Passing it
 * is for the case that actually happens: a session recording an act it took before the verb was reachable,
 * or replaying its own record after a crash — where the original instant is part of what makes the retry
 * idempotent rather than a second occurrence.
 */
import type { BareReferenceError } from "../../../autonomy/errors.js";
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { buildAutonomyAction } from "../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { bareReferenceErrors, standingWordReferenceErrors } from "../../../briefing/autonomyActRefs.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { parseAutonomyRecordArgs, RECORD_USAGE, VERB_ARG_OFFSET } from "./core.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** When the act was done: `--done-iso` when given, else the instant it is recorded — an act logged as it happens. */
function doneIsoOf({ values, nowIso }: { values: Readonly<Record<string, unknown>>; nowIso: string }): string {
  const given = flag({ name: "done-iso", values });
  if (given === undefined) {
    return nowIso;
  }
  return given;
}

/** Everything `autonomy record` touches outside itself, injected so a test drives the whole verb. */
export interface AutonomyRecordDeps {
  /** The instant an omitted `--done-iso` takes. */
  readonly now: () => string;
  /** The ledger, REQUIRED: the store-backed port in production, an in-memory one in a test. */
  readonly ledger: AutonomyLedgerPort;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The seven flags a row cannot be built without, or undefined when any of them is missing.
 *
 * `--said` is required HERE and nowhere else, which is the split `../../../autonomy/types.ts` explains:
 * the builder cannot demand it without refusing every row written before the field existed, and this verb
 * is the only door a new act comes through. Its VALIDITY is still the builder's.
 */
function requiredFlags({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}):
  | { actionId: string; kind: string; subject: string; bySession: string; why: string; said: string; witness: string }
  | undefined {
  const actionId = flag({ name: "action-id", values });
  const kind = flag({ name: "kind", values });
  const subject = flag({ name: "subject", values });
  const bySession = flag({ name: "by-session", values });
  const why = flag({ name: "why", values });
  const said = flag({ name: "said", values });
  const witness = flag({ name: "witness", values });
  if (
    actionId === undefined ||
    kind === undefined ||
    subject === undefined ||
    bySession === undefined ||
    why === undefined ||
    said === undefined ||
    witness === undefined
  ) {
    return undefined;
  }
  return { actionId, bySession, kind, said, subject, why, witness };
}

/**
 * Every reference the new act would carry onto the briefing as plain text.
 *
 * Checked HERE, at the door a new act comes through, rather than in `buildAutonomyAction`: the register's
 * decoder reruns the builder over every stored line, so a rule there would turn an old row carrying a bare
 * `#N` into a corrupt one and blank the whole section. Rendered with no steer folded on: a pattern or class
 * word the act inherits was judged on its own when `autonomy steer`/`steer-class` wrote it, and an inline
 * `--steer` is judged the same way, since the fold shows it on other acts' rows too.
 */
function actReferenceErrors({ action }: { action: AutonomyActionRow }): readonly BareReferenceError[] {
  const { steer: inlineSteer, ...unsteered } = action;
  return [
    ...bareReferenceErrors({
      entry: { action: unsteered, classSteer: undefined, latestSteer: undefined, patternSteer: undefined },
    }),
    ...(inlineSteer === undefined ? [] : standingWordReferenceErrors({ word: inlineSteer })),
  ];
}

/**
 * Run `autonomy record` against injected seams.
 *
 * @param rest the argv tail after `autonomy record`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runAutonomyRecord({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AutonomyRecordDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECORD_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAutonomyRecordArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(RECORD_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const nowIso = deps.now();
  const required = requiredFlags({ values });
  if (required === undefined) {
    deps.writeDiagnostic(
      "autonomy record: --action-id, --kind, --subject, --by-session, --why, --said and --witness are all required",
    );
    deps.writeDiagnostic(RECORD_USAGE);
    return EXIT_USAGE;
  }
  const built = buildAutonomyAction({
    ...required,
    doneIso: doneIsoOf({ nowIso, values }),
    run: flag({ name: "run", values }),
    steer: flag({ name: "steer", values }),
  });
  if (built.isErr()) {
    deps.writeDiagnostic(`autonomy record: ${built.error.message}`);
    return EXIT_ERROR;
  }
  const bare = actReferenceErrors({ action: built.value });
  if (bare.length > 0) {
    bare.forEach((error) => {
      deps.writeDiagnostic(`autonomy record: ${error.message}`);
    });
    return EXIT_ERROR;
  }
  const home = resolveHome({ named: flag({ name: "home", values }) });
  const written = await deps.ledger.appendRecord({ home, record: built.value });
  if (written.isErr()) {
    deps.writeDiagnostic(`autonomy record: ${written.error.message}`);
    return EXIT_ERROR;
  }
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify({ ...written.value, row: built.value }));
    return EXIT_OK;
  }
  const what = written.value.appended ? "recorded" : "already recorded, nothing written";
  deps.writeOut(`autonomy record: ${built.value.actionId} ${what} — ${built.value.kind} on ${built.value.subject}`);
  return EXIT_OK;
}

/**
 * The real seams: the machine clock, the store-backed ledger and the two output channels.
 *
 * @returns the production dependencies for {@link runAutonomyRecord}
 */
export function productionAutonomyRecordDeps(): AutonomyRecordDeps {
  return {
    ledger: autonomyLedgerPort(),
    now: () => new Date().toISOString(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver autonomy record`. */
export const autonomyRecordCommand = defineCommand({
  run: (argv) => runAutonomyRecord({ deps: productionAutonomyRecordDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
