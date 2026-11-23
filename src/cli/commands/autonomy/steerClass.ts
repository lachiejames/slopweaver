/**
 * `slopweaver autonomy steer-class <classId>` — record THEIR standing word on a whole class of act.
 *
 * A steer given on a class of questions is clear, so a session need not keep asking it: more than 600 check-ins
 * mostly asked whether pressing merge on one more of their pull requests was right.
 * `autonomy steer` answers one act; this answers every act of the kinds it lists,
 * recorded before it or after, so the list they read carries only the kinds they have not ruled on.
 *
 * It appends one row per class rather than one steer per act. Six hundred copies of one sentence would read
 * as six hundred rulings, and the next act of the same kind would land on their list again anyway.
 *
 * `--by-session` is provenance, never authentication — exactly as `./steer.ts` says.
 */
import { buildAutonomyClassSteer } from "../../../autonomy/classSteer.js";
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import type { AutonomyClassSteerRow } from "../../../autonomy/types.js";
import { standingWordReferenceErrors } from "../../../briefing/autonomyActRefs.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { parseAutonomySteerClassArgs, STEER_CLASS_USAGE, VERB_ARG_OFFSET } from "./core.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** Everything `autonomy steer-class` touches outside itself, injected so a test drives the whole verb. */
export interface AutonomySteerClassDeps {
  /** When the word was recorded. */
  readonly now: () => string;
  /** The ledger, REQUIRED: the store-backed port in production, an in-memory one in a test. */
  readonly ledger: AutonomyLedgerPort;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `autonomy steer-class` against injected seams.
 *
 * @param rest the argv tail after `autonomy steer-class`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runAutonomySteerClass({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AutonomySteerClassDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(STEER_CLASS_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAutonomySteerClassArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(STEER_CLASS_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const classId = parsed.value.positionals[0];
  const kinds = flag({ name: "kinds", values });
  const steer = flag({ name: "steer", values });
  const anchor = flag({ name: "anchor", values });
  const bySession = flag({ name: "by-session", values });
  if (
    classId === undefined ||
    kinds === undefined ||
    steer === undefined ||
    anchor === undefined ||
    bySession === undefined
  ) {
    deps.writeDiagnostic(
      "autonomy steer-class: the class's name, --kinds, --steer, --anchor and --by-session are all required",
    );
    deps.writeDiagnostic(STEER_CLASS_USAGE);
    return EXIT_USAGE;
  }
  const bare = standingWordReferenceErrors({ word: steer });
  if (bare.length > 0) {
    bare.forEach((error) => {
      deps.writeDiagnostic(`autonomy steer-class: ${error.message}`);
    });
    return EXIT_ERROR;
  }
  const subjectPrefix = flag({ name: "subject-prefix", values });
  const steeredIso = deps.now();
  const built = buildAutonomyClassSteer({ anchor, bySession, classId, kinds, steer, steeredIso, subjectPrefix });
  if (built.isErr()) {
    deps.writeDiagnostic(`autonomy steer-class: ${built.error.message}`);
    return EXIT_ERROR;
  }
  return appendAndReport({ classId, deps, row: built.value, values });
}

/** Append a built class row to the ledger and say what was recorded — as JSON when asked for it. */
async function appendAndReport({
  classId,
  deps,
  row,
  values,
}: {
  classId: string;
  deps: AutonomySteerClassDeps;
  row: AutonomyClassSteerRow;
  values: Readonly<Record<string, unknown>>;
}): Promise<number> {
  const home = resolveHome({ named: flag({ name: "home", values }) });
  const written = await deps.ledger.appendRecord({ home, record: row });
  if (written.isErr()) {
    deps.writeDiagnostic(`autonomy steer-class: ${written.error.message}`);
    return EXIT_ERROR;
  }
  const lines = values["json"] === true ? [JSON.stringify({ ...written.value, row })] : recordedLines({ classId, row });
  lines.forEach((line) => {
    deps.writeOut(line);
  });
  return EXIT_OK;
}

/**
 * What a recording prints for a person: the class, how many kinds it settles, and its scope whenever it has one —
 * so a recording can never read broader, or narrower, than it is.
 */
function recordedLines({ classId, row }: { classId: string; row: AutonomyClassSteerRow }): readonly string[] {
  const count = row.kinds.split(",").length;
  const where = row.subjectPrefix === undefined ? "" : ` wherever the subject starts ${row.subjectPrefix}`;
  return [
    `autonomy steer-class: recorded their standing word on ${classId}, settling ${String(count)} kind(s)${where}`,
  ];
}

/**
 * The real seams: the machine clock, the store-backed ledger and the two output channels.
 *
 * @returns the production dependencies for {@link runAutonomySteerClass}
 */
export function productionAutonomySteerClassDeps(): AutonomySteerClassDeps {
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

/** `slopweaver autonomy steer-class`. */
export const autonomySteerClassCommand = defineCommand({
  run: (argv) => runAutonomySteerClass({ deps: productionAutonomySteerClassDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
