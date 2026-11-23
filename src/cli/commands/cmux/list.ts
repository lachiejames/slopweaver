/**
 * `slopweaver cmux list` — every workspace in every cmux window, through the door.
 *
 * Exists so no session ever runs `cmux workspace list` itself. Two things it gets right that the raw verb
 * does not: it fans out across windows (a bare `cmux workspace list` is scoped to the caller's own window and
 * silently looks like a global inventory), and it prints the workspace UUID alongside the ref, which is what
 * anything addressing a workspace must actually use. The checkout directory column rides `--full`. It reads
 * through the session harness (`../../../sessionHarness/sessionHarness.ts`), cmux behind it.
 */
import { logger } from "../../../lib/logger.js";
import { cmuxWorkspaceFromSession } from "../../../sessionHarness/cmuxSession.js";
import { parseHarnessFlag, withNamedSessionHarness } from "../../../sessionHarness/harnessChoice.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { cmuxUsage, parseCmuxArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { cmuxWorkspaceLine } from "./listOutput.js";

/**
 * Run `cmux list`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxList(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: cmuxUsage({ verb: "list" }) });
    return EXIT_OK;
  }
  const parsed = parseCmuxArgs({ rest, verb: "list" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: cmuxUsage({ verb: "list" }) });
    return EXIT_USAGE;
  }
  const harnessName = parseHarnessFlag({ value: stringFlag({ name: "harness", parsed: parsed.value }) });
  if (harnessName.isErr()) {
    logger.error({ msg: `cmux list: ${harnessName.error}` });
    logger.error({ msg: cmuxUsage({ verb: "list" }) });
    return EXIT_USAGE;
  }
  const listed = await withNamedSessionHarness({ body: ({ harness }) => harness.list(), name: harnessName.value });
  if (listed.isErr()) {
    logger.error({ msg: `cmux list: ${listed.error.message}` });
    return EXIT_ERROR;
  }
  // Readers of `--json` key on cmux's own field names, so the rows go back to that shape, key order included.
  const workspaces = listed.value.map((session) => cmuxWorkspaceFromSession({ session }));
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify(workspaces) });
    return EXIT_OK;
  }
  const full = parsed.value.values["full"] === true;
  for (const workspace of workspaces) {
    logger.out({ line: cmuxWorkspaceLine({ full, workspace }) });
  }
  return EXIT_OK;
}

export const cmuxListCommand = defineCommand({ run: runCmuxList });
