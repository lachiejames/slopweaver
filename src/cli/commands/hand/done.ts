/**
 * `slopweaver hand done` — settle one step and close its note.
 *
 * The note's own Done button reaches the same place by a different road (a marker, read back by
 * `../../../hand/reconcile.ts`); this is the road for a session that WATCHED the owner do it, or for them telling
 * the supervisor it is done. `--did` is what actually happened, in the words of whoever saw it.
 */
import { dismissHandNote } from "../../../hand/note/markers.js";
import { buildSettledRow } from "../../../hand/row.js";
import { appendHandRow, readOpenHandSteps } from "../../../hand/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { DONE_USAGE, parseHandDoneArgs, VERB_ARG_OFFSET } from "./core.js";
import { bySession, flag, type HandDeps, productionHandDeps, reportUnparsed, resolvedHomeOf } from "./deps.js";

/**
 * Run `hand done` against injected seams.
 *
 * @param rest the argv tail after `hand done`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runHandDone({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(DONE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandDoneArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(DONE_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const id = parsed.value.positionals[0];
  const did = flag({ name: "did", values });
  if (id === undefined || did === undefined) {
    deps.writeDiagnostic("hand done: the step's id and --did are both required");
    deps.writeDiagnostic(DONE_USAGE);
    return EXIT_USAGE;
  }
  const resolvedHome = resolvedHomeOf({ values });
  const nowIso = deps.now();
  // Built rather than assembled inline, so the same rule that decides whether this line READS BACK is the
  // one that decides whether it is written. This verb used to hand `--did` straight to the append, which is
  // how a 486-character account bricked the live register (`../../../hand/row.ts`).
  const row = buildSettledRow({ draft: { bySession: bySession({ values }), did, id, settledIso: nowIso } });
  if (row.isErr()) {
    deps.writeDiagnostic(`hand done: ${row.error.message}`);
    return EXIT_USAGE;
  }
  const written = await appendHandRow({ home: resolvedHome, nowIso, row: row.value });
  if (written.isErr()) {
    deps.writeDiagnostic(`hand done: ${written.error.message}`);
    return EXIT_ERROR;
  }
  reportUnparsed({ deps, unparsed: written.value.unparsed, verb: "hand done" });
  closeNote({ home: resolvedHome, id, nowIso });
  const read = readOpenHandSteps({ home: resolvedHome });
  const remaining = read.isErr() ? 0 : read.value.steps.length;
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify({ ...written.value, did, remaining }));
    return EXIT_OK;
  }
  deps.writeOut(`hand done: ${id} settled — ${did}`);
  deps.writeOut(`  ${String(remaining)} step(s) still waiting on the owner`);
  return EXIT_OK;
}

/**
 * Drop the marker that closes this step's note, if one is up.
 *
 * Best effort and deliberately unreported: the register is already correct, and a session told the step was
 * done has nothing to do about a panel that would not close.
 *
 * @param id the settled step's id
 * @param home the state home
 * @param nowIso what to write into the marker
 */
function closeNote({ id, home, nowIso }: { id: string; home: string; nowIso: string }): void {
  dismissHandNote({ home, id, nowIso });
}

/** `slopweaver hand done`. */
export const handDoneCommand = defineCommand({
  run: (argv) => runHandDone({ deps: productionHandDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
