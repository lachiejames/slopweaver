/**
 * `slopweaver talk quarantine <callId> --reason "<why>"` — accept one gone console-voice call's loss on the record, so
 * `talk unread` (and the tick close that reads it) goes past it instead of refusing every read of the owner's words forever.
 *
 * Only a call whose file is truly ABSENT, and that the call index or a reader's cursor names, is accepted; one row
 * per call, append-only, the index and cursors never touched (`src/talk/callQuarantineLedger.ts`). Investigate first:
 * restore the file from any copy that exists, and quarantine only what cannot be restored. MEASURED on first use: four e2e test-call files a seat removed by hand from the real home, unrecoverable.
 */
import { grantSessionId } from "../../../hatch/grantSession.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { quarantineCall } from "../../../talk/callQuarantine.js";
import { isBlank } from "../../../talk/callQuarantineLedger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseQuarantineArgs } from "./quarantineArgs.js";
import { TALK_QUARANTINE_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "quarantine", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * The visible session a row records: whatever `grantSessionId` resolves, or `null`. Absent by design — a shell outside
 * any visible session records no session — and an id `trim()` left standing but Unicode reads as blank (U+0085) is no
 * session either, rather than a row the ledger refuses.
 *
 * @internal — {@link runTalkQuarantine} is this module's public surface; exported for its own unit test.
 * @param env the environment the session id is read from
 * @returns the session id, or `null`
 */
export function quarantineSession({ env }: { env: Readonly<Record<string, string | undefined>> }): string | null {
  const visible = grantSessionId({ env });
  if (visible === undefined || isBlank({ text: visible })) {
    return null;
  }
  return visible;
}

/**
 * Run the `talk quarantine` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkQuarantine(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_QUARANTINE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseQuarantineArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_QUARANTINE_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const written = quarantineCall({
    callId: args.callId,
    home: talkHomeOf({ home: args.home }),
    nowIso: new Date().toISOString(),
    reason: args.reason,
    session: quarantineSession({ env: process.env }),
  });
  if (written.isErr()) {
    logger.error({ msg: `talk quarantine: ${written.error.message}` });
    return EXIT_ERROR;
  }
  const { row, path } = written.value;
  if (args.json) {
    logger.out({ line: safeJsonStringify({ label: "talk quarantine receipt", value: { path, row } }) });
    return EXIT_OK;
  }
  logger.out({
    line:
      `talk quarantine: call ${row.callId}'s loss is accepted on the record at ${row.atIso} (${path}); ` +
      "talk unread now reads past it and names it on every read",
  });
  return EXIT_OK;
}

export const talkQuarantineCommand = defineCommand({ run: runTalkQuarantine });
