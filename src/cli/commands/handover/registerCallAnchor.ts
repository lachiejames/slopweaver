/**
 * `handover register --anchor talk:<id>` over an id that is a console CALL, not a relay turn: refused before any row
 * exists. `talk:` names a relay turn's file, so the row would quote nothing and `handover settle` would read it as an
 * unreadable relay (`../../../talk/relayAnchorCall.ts` carries the measured row). The call's words have their own
 * anchors, and the refusal names them.
 */
import { ok, type Result } from "#lib/result.js";

import { logger } from "../../../lib/logger.js";
import { callIdInRelayAnchor } from "../../../talk/relayAnchorCall.js";
import type { UnreadError } from "../../../talk/unreadErrors.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { REGISTER_USAGE } from "./askRowArgs.js";

/**
 * Refuse `handover register` over a call id under `talk:`, printing why, before any row exists.
 *
 * @param anchor what `--anchor` carried, if anything
 * @param home the state home the talk records live under
 * @returns EXIT_USAGE for a call id, EXIT_ERROR when the call store could not say, undefined to go on registering
 */
export function registerCallAnchorExit({
  anchor,
  home,
}: {
  anchor: string | undefined;
  home: string;
}): number | undefined {
  const refusal = callAnchorRefusal({ anchor, home });
  if (refusal.isErr()) {
    logger.error({
      msg: `handover register: whether --anchor ${anchor!} names a call cannot be read — ${refusal.error.message}`,
    });
    return EXIT_ERROR;
  }
  if (refusal.value === undefined) {
    return undefined;
  }
  logger.error({ msg: `handover register: ${refusal.value}` });
  logger.error({ msg: REGISTER_USAGE });
  return EXIT_USAGE;
}

/**
 * The usage refusal for a call id written under `talk:`, or undefined for any other anchor.
 *
 * An absent call index is no index at all, so an ordinary relay registered before its turn file lands is untouched;
 * an index that will not read is an ERROR rather than a usage refusal, since the caller typed nothing wrong.
 *
 * @param anchor what `--anchor` carried, if anything
 * @param home the state home the talk records live under
 * @returns the refusal naming the anchor to use instead, undefined when the anchor is not a call id under `talk:`,
 *   or why the call store could not say
 */
export function callAnchorRefusal({
  anchor,
  home,
}: {
  anchor: string | undefined;
  home: string;
}): Result<string | undefined, UnreadError> {
  if (anchor === undefined) {
    return ok(undefined);
  }
  return callIdInRelayAnchor({ anchor, home }).map((call) => {
    if (call === undefined) {
      return undefined;
    }
    return (
      `--anchor ${anchor} names a console CALL, not a relay turn — \`talk:\` is a relay turn's anchor. Anchor the ` +
      `owner's words on the call as talk-call:${call}#<segmentId> (\`slopweaver talk unread\` prints them), or ` +
      `call:${call}#<segment> for a landed card`
    );
  });
}
