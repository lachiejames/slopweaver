/**
 * `slopweaver autonomy steer <actionId>` — record THEIR retroactive word about one act.
 *
 * This is the other half of the ruling that built the register. They read the ledger on their Fleet Briefing,
 * says something about a row to the supervisor — _"something I actually would have been fine with but you
 * didn't do or something you did do and I wasn't fine with"_ — and the supervisor runs this. It appends
 * rather than editing, so a second word on one act does not erase the first: both stay in the file and
 * `../../../autonomy/query.ts`'s fold shows them the newer one.
 *
 * ## What `--by-session` is, and what it is not
 *
 * It is PROVENANCE: which session wrote the word down. It is not authentication, and nothing downstream may
 * read it as any. `.claude/rules/cross-session-messages.md` already settles that a relayed word is judged on
 * its merits rather than on who carried it, and a field on a JSONL line changes none of that.
 */
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { buildAutonomySteer } from "../../../autonomy/row.js";
import { standingWordReferenceErrors } from "../../../briefing/autonomyActRefs.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { parseAutonomySteerArgs, STEER_USAGE, VERB_ARG_OFFSET } from "./core.js";

/** A flag's value, or undefined when it was not supplied. */
function flag({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** Everything `autonomy steer` touches outside itself, injected so a test drives the whole verb. */
export interface AutonomySteerDeps {
  /** When the word was recorded. */
  readonly now: () => string;
  /** The ledger, REQUIRED: the store-backed port in production, an in-memory one in a test. */
  readonly ledger: AutonomyLedgerPort;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `autonomy steer` against injected seams.
 *
 * @param rest the argv tail after `autonomy steer`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runAutonomySteer({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: AutonomySteerDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(STEER_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAutonomySteerArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(STEER_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const actionId = parsed.value.positionals[0];
  const steer = flag({ name: "steer", values });
  const bySession = flag({ name: "by-session", values });
  if (actionId === undefined || steer === undefined || bySession === undefined) {
    deps.writeDiagnostic("autonomy steer: the act's id, --steer and --by-session are all required");
    deps.writeDiagnostic(STEER_USAGE);
    return EXIT_USAGE;
  }
  const nowIso = deps.now();
  const built = buildAutonomySteer({ actionId, bySession, steer, steeredIso: nowIso });
  if (built.isErr()) {
    deps.writeDiagnostic(`autonomy steer: ${built.error.message}`);
    return EXIT_ERROR;
  }
  // The word is judged with no act's links behind it: the fold shows it on every act sharing this one's kind
  // and plain-words line, whatever their subjects.
  const bare = standingWordReferenceErrors({ word: steer });
  if (bare.length > 0) {
    bare.forEach((error) => {
      deps.writeDiagnostic(`autonomy steer: ${error.message}`);
    });
    return EXIT_ERROR;
  }
  const home = resolveHome({ named: flag({ name: "home", values }) });
  const written = await deps.ledger.appendRecord({ home, record: built.value });
  if (written.isErr()) {
    deps.writeDiagnostic(`autonomy steer: ${written.error.message}`);
    return EXIT_ERROR;
  }
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify({ ...written.value, row: built.value }));
    return EXIT_OK;
  }
  deps.writeOut(`autonomy steer: recorded their word on ${actionId}`);
  return EXIT_OK;
}

/**
 * The real seams: the machine clock, the store-backed ledger and the two output channels.
 *
 * @returns the production dependencies for {@link runAutonomySteer}
 */
export function productionAutonomySteerDeps(): AutonomySteerDeps {
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

/** `slopweaver autonomy steer`. */
export const autonomySteerCommand = defineCommand({
  run: (argv) => runAutonomySteer({ deps: productionAutonomySteerDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
