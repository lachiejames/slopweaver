/**
 * `slopweaver hatch open|list` — taking and reading a journalled escape hatch.
 *
 * ## The one property this verb must never lose
 *
 * **It is never gated by a hatch of its own.** A guard whose block swallows the command its own refusal
 * names is a wedge rather than a gate (`../../../hatch/render.ts` enforces the same property for
 * the depth block). So `hatch open` takes no override, consults no register row about itself, and declares
 * `effect: "local-state"` — it writes a line under `$SLOPWEAVER_HOME` and reaches nothing external.
 *
 * ## Why a reason is required and unvalidated
 *
 * The reason is the whole product of this lane. It is what a reader afterwards has instead of an
 * environment variable that left no trace, and it is not checkable by anything here — only a person reading
 * the journal can say whether "the person is already live in the thread" was true. So it is REQUIRED and
 * never inspected: a validator would be theatre, and an optional one would be a field nobody fills.
 */

import { buildHatchGrant, HATCH_GRANT_WINDOW_MS, liveHatchGrant } from "../../../hatch/grant.js";
import { grantSessionId, NO_GRANT_SESSION_LINE } from "../../../hatch/grantSession.js";
import { appendHatchGrant, readHatchGrants } from "../../../hatch/grantStore.js";
import { hatchesById } from "../../../hatch/lookup.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";
import { hatchIncantation } from "../../../hatch/types.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

/** Where the VERB sits in `process.argv` — `[node, bin, <noun>, <verb>, …]`, as every other noun reads it. */
const VERB_INDEX = 3;

const USAGE =
  "usage: slopweaver hatch <open|list> [<id>] [--reason <text>] [--home <dir>]\n" +
  '  open <id> --reason "<why>"  take a 30-minute grant for ONE journalled hatch, in THIS session\n' +
  "  list                        every journalled hatch, and which of them this session holds a grant for";

/** The value of one `--flag <value>` pair, or `undefined`. */
function flagValue({ rest, flag }: { rest: readonly string[]; flag: string }): string | undefined {
  const at = rest.indexOf(flag);
  if (at < 0) {
    return undefined;
  }
  return rest[at + 1];
}

/** The session a grant is issued to, or `undefined` when the harness named none (or two). */
function sessionId(): string | undefined {
  return grantSessionId({ env: process.env });
}

/**
 * `hatch list` — every journalled row, and whether this session holds a live grant for it.
 *
 * @param rest the argv after the noun and verb
 * @param nowIso the current instant
 * @returns EXIT_OK
 */
export function runHatchList({ rest, nowIso }: { rest: readonly string[]; nowIso: string }): number {
  const home = flagValue({ flag: "--home", rest });
  const grants = readHatchGrants(home === undefined ? {} : { home });
  const session = sessionId();
  const journalled = ESCAPE_HATCHES.filter((hatch) => hatch.lane === "journalled");
  logger.out({ line: `${String(journalled.length)} journalled hatch(es); a grant lasts 30 minutes.` });
  for (const hatch of journalled) {
    const live =
      session === undefined
        ? undefined
        : liveHatchGrant({ claudeSessionId: session, grants, hatchId: hatch.id, nowIso });
    const state = live === undefined ? "closed" : `OPEN until ${live.expiresAtIso} — "${live.reason}"`;
    logger.out({ line: `  ${hatch.id.padEnd(28)} ${state}` });
  }
  if (session === undefined) {
    logger.out({ line: `\n${NO_GRANT_SESSION_LINE}, so no grant can be held or taken.` });
  }
  return EXIT_OK;
}

/**
 * `hatch open <id> --reason "<why>"` — record one grant for one hatch, for this session.
 *
 * @param rest the argv after the noun and verb
 * @param nowIso the current instant
 * @returns EXIT_OK once the grant is written, EXIT_USAGE on a bad invocation, EXIT_ERROR when it cannot be
 */
export function runHatchOpen({ rest, nowIso }: { rest: readonly string[]; nowIso: string }): number {
  const id = rest[0];
  const reason = flagValue({ flag: "--reason", rest });
  const home = flagValue({ flag: "--home", rest });
  if (id === undefined || id.startsWith("--")) {
    logger.error({ msg: "hatch open needs the hatch id — `slopweaver hatch list` names them" });
    return EXIT_USAGE;
  }
  if (reason === undefined || reason.trim().length === 0) {
    logger.error({
      msg: 'hatch open needs --reason "<why this one is a legitimate exception>" — the reason IS what a journalled hatch buys over an ambient variable',
    });
    return EXIT_USAGE;
  }
  const hatch = hatchesById().get(id);
  if (hatch === undefined) {
    logger.error({ msg: `no escape hatch is registered as "${id}" — \`slopweaver hatch list\` names them` });
    return EXIT_ERROR;
  }
  if (hatch.lane !== "journalled") {
    logger.error({
      msg: `"${id}" is an ambient hatch, not a journalled one. Open it inline instead: ${hatchIncantation({ hatch })}`,
    });
    return EXIT_ERROR;
  }
  const session = sessionId();
  if (session === undefined) {
    logger.error({ msg: NO_GRANT_SESSION_LINE });
    return EXIT_ERROR;
  }
  const grant = buildHatchGrant({ claudeSessionId: session, hatchId: id, issuedAtIso: nowIso, reason });
  appendHatchGrant({ grant, ...(home === undefined ? {} : { home }) });
  logger.out({
    line:
      `opened "${id}" for this session until ${grant.expiresAtIso} ` +
      `(${String(HATCH_GRANT_WINDOW_MS / 60000)} minutes). Re-run what was refused.`,
  });
  logger.out({ line: `recorded: ${grant.reason}` });
  return EXIT_OK;
}

/**
 * Dispatch `hatch open` / `hatch list`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runHatch(argv: readonly string[]): number {
  const verb = argv[VERB_INDEX];
  const rest = argv.slice(VERB_INDEX + 1);
  if (rest.includes("--help") || rest.includes("-h") || verb === undefined) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const nowIso = new Date().toISOString();
  if (verb === "list") {
    return runHatchList({ nowIso, rest });
  }
  if (verb === "open") {
    return runHatchOpen({ nowIso, rest });
  }
  logger.error({ msg: USAGE });
  return EXIT_USAGE;
}

export const hatchCommand = defineCommand({ run: runHatch });
