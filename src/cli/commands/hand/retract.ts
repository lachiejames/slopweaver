/**
 * `slopweaver hand retract` — take a step off the owner's queue that was never the owner's to take, and say so.
 *
 * The register's other two exits both lie about a mis-posted step. `hand done` records that it HAPPENED, and
 * `hand snooze` takes the note down for a while and leaves the step open. A step that should never have been posted
 * needs a third: settled, so it leaves every surface, with a `did` that reads as a retraction and names why,
 * so the register never holds a mis-post as finished work.
 *
 * Measured: one `monitor check --fire` posted 25 `mon-park-*` steps in one second, each a
 * question already on the owner's queue as a parked run rather than a step for their hands. The owner opened one and called
 * it another useless card. This is the verb that took them down.
 *
 * Every id is checked open BEFORE anything is written, so a typo in the list retracts nothing rather than
 * half of it.
 */
import { dismissHandNote } from "../../../hand/note/markers.js";
import { buildSettledRow } from "../../../hand/row.js";
import { appendHandRow, readOpenHandSteps } from "../../../hand/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { parseHandRetractArgs, RETRACT_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { bySession, flag, type HandDeps, productionHandDeps, reportUnparsed, resolvedHomeOf } from "./deps.js";

/**
 * The account a retraction settles under, so nothing reading the register can take it for work done.
 *
 * @param why why the step was never the owner's, in the retracting session's words
 * @returns the settled row's `did`
 */
export function retractedDid({ why }: { why: string }): string {
  return `retracted, never a step for the owner's hands — ${why.trim()}`;
}

/**
 * Settle every id as retracted and take its note down, stopping at the first write that fails.
 *
 * @param ids the open steps to retract, already checked open
 * @param did the settled row's wording, the same for each
 * @param bySession who is retracting, as the register records it
 * @returns the exit code to stop with, or `undefined` when every id settled
 */
async function settleEach({
  ids,
  did,
  bySession: by,
  home,
  nowIso,
  deps,
}: {
  ids: readonly string[];
  did: string;
  bySession: string;
  home: string;
  nowIso: string;
  deps: HandDeps;
}): Promise<number | undefined> {
  for (const id of ids) {
    const row = buildSettledRow({ draft: { bySession: by, did, id, settledIso: nowIso } });
    if (row.isErr()) {
      deps.writeDiagnostic(`hand retract: ${row.error.message}`);
      return EXIT_USAGE;
    }
    const written = await appendHandRow({ home, nowIso, row: row.value });
    if (written.isErr()) {
      deps.writeDiagnostic(`hand retract: ${id}: ${written.error.message}`);
      return EXIT_ERROR;
    }
    dismissHandNote({ home, id, nowIso });
  }
  return undefined;
}

/**
 * Run `hand retract` against injected seams.
 *
 * @param rest the argv tail after `hand retract`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runHandRetract({ rest, deps }: { rest: readonly string[]; deps: HandDeps }): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RETRACT_USAGE);
    return EXIT_OK;
  }
  const parsed = parseHandRetractArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(RETRACT_USAGE);
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  const ids = [...new Set(parsed.value.positionals)];
  const why = flag({ name: "why", values });
  if (ids.length === 0 || why === undefined || why.trim() === "") {
    deps.writeDiagnostic("hand retract: at least one step id and a non-empty --why are required");
    deps.writeDiagnostic(RETRACT_USAGE);
    return EXIT_USAGE;
  }
  const home = resolvedHomeOf({ values });
  const nowIso = deps.now();
  const open = readOpenHandSteps({ home });
  if (open.isErr()) {
    deps.writeDiagnostic(`hand retract: ${open.error.message}`);
    return EXIT_ERROR;
  }
  reportUnparsed({ deps, unparsed: open.value.unparsed, verb: "hand retract" });
  const openIds = new Set(open.value.steps.map((step) => step.id));
  const missing = ids.filter((id) => !openIds.has(id));
  if (missing.length > 0) {
    deps.writeDiagnostic(
      `hand retract: no open hand step carries ${missing.join(", ")} — nothing was retracted, so the list can be fixed and re-run whole`,
    );
    return EXIT_ERROR;
  }
  const did = retractedDid({ why });
  const failed = await settleEach({ bySession: bySession({ values }), deps, did, home, ids, nowIso });
  if (failed !== undefined) {
    return failed;
  }
  const remaining = open.value.steps.length - ids.length;
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify({ did, remaining, retracted: ids }));
    return EXIT_OK;
  }
  deps.writeOut(`hand retract: ${String(ids.length)} step(s) retracted — ${did}`);
  deps.writeOut(`  ${String(remaining)} step(s) still waiting on the owner`);
  return EXIT_OK;
}

/** `slopweaver hand retract`. */
export const handRetractCommand = defineCommand({
  run: (argv) => runHandRetract({ deps: productionHandDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
