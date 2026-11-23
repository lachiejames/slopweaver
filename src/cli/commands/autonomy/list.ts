/**
 * `slopweaver autonomy list` — read the autonomy ledger back, newest act first, each with their latest word.
 *
 * Reads the local store and nothing else: no network, no model. The ORDER is the register's own
 * (`../../../autonomy/query.ts`'s fold) rather than this verb's, so the act at the top here is the act at the
 * top of their Fleet Briefing — a row they refer to by position cannot be two different rows in the two places.
 *
 * `--json` emits one object per line rather than one array, and that is the `whole-file-json` rule rather
 * than a style: this register grows for as long as the installation runs, so a verb that stringified the
 * whole of it into one value would be the exact shape that rule refuses.
 */
import { classIdOf } from "../../../autonomy/classSteer.js";
import { autonomyKindLabel, autonomySubjectLabel } from "../../../autonomy/label.js";
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import {
  filterAutonomyActions,
  foldAutonomy,
  settlingClass,
  settlingPattern,
  steerOf,
} from "../../../autonomy/query.js";
import type { AutonomyAction } from "../../../autonomy/types.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { LIST_USAGE, parseAutonomyListArgs, VERB_ARG_OFFSET } from "./core.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** Everything `autonomy list` touches outside itself, injected so a test drives the whole verb. */
export interface AutonomyListDeps {
  /** The ledger, REQUIRED: the store-backed port in production, an in-memory one in a test. */
  readonly ledger: AutonomyLedgerPort;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The two lines one act prints in the human view: what happened, then their word when they have given one. */
function humanLines({ entry }: { entry: AutonomyAction }): readonly string[] {
  const { action } = entry;
  const head =
    `${action.doneIso}  ${action.actionId}  ${autonomyKindLabel({ kind: action.kind })} ` +
    `on ${autonomySubjectLabel({ subject: action.subject })}  [${action.bySession}]`;
  const word = steerOf({ action: entry });
  if (word === undefined) {
    return [head, `    why: ${action.why}`];
  }
  const pattern = settlingPattern({ action: entry });
  if (pattern !== undefined) {
    return [head, `    why: ${action.why}`, `    their word on this pattern, given on ${pattern.actionId}: ${word}`];
  }
  const standing = settlingClass({ action: entry });
  if (standing !== undefined) {
    return [
      head,
      `    why: ${action.why}`,
      `    their standing word on ${classIdOf({ row: standing })} (${standing.anchor}): ${word}`,
    ];
  }
  return [head, `    why: ${action.why}`, `    their steer: ${word}`];
}

/**
 * Run `autonomy list` against injected seams.
 *
 * @param rest the argv tail after `autonomy list`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runAutonomyList({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AutonomyListDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(LIST_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAutonomyListArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(LIST_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const home = resolveHome({ named: flag({ name: "home", values }) });
  const stored = await deps.ledger.readRecords({ home });
  if (stored.isErr()) {
    deps.writeDiagnostic(`autonomy list: ${stored.error.message}`);
    return EXIT_ERROR;
  }
  const folded = foldAutonomy({ records: stored.value });
  if (folded.isErr()) {
    deps.writeDiagnostic(`autonomy list: ${folded.error.message}`);
    return EXIT_ERROR;
  }
  const actions = filterAutonomyActions({
    actions: folded.value,
    bySession: flag({ name: "by-session", values }),
    kind: flag({ name: "kind", values }),
    sinceIso: flag({ name: "since", values }),
    unsteered: values["unsteered"] === true,
  });
  if (values["json"] === true) {
    actions.forEach((entry) => {
      deps.writeOut(JSON.stringify(entry));
    });
    return EXIT_OK;
  }
  if (actions.length === 0) {
    deps.writeOut("autonomy list: no acts recorded under graduated autonomy match");
    return EXIT_OK;
  }
  actions.forEach((entry) => {
    humanLines({ entry }).forEach((line) => {
      deps.writeOut(line);
    });
  });
  return EXIT_OK;
}

/**
 * The real seams: the store-backed ledger and the two output channels.
 *
 * @returns the production dependencies for {@link runAutonomyList}
 */
export function productionAutonomyListDeps(): AutonomyListDeps {
  return {
    ledger: autonomyLedgerPort(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver autonomy list`. */
export const autonomyListCommand = defineCommand({
  run: (argv) => runAutonomyList({ deps: productionAutonomyListDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
