/**
 * The owner's words, read at registration so a row whose anchor names them is born with its quote (`../../../handover/hisWords.ts`).
 *
 * Its own module because `./askRowRun.ts` holds the flag resolution and sits against the file-size ratchet.
 *
 * A failed read never refuses the registration: the row is the record that the owner asked, and losing it over a quote
 * would be the worse failure. It registers with the reason stored as an unread record, says so on stderr, and
 * `handover quote --apply` retries the read on every run.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { type HisWordsRecord, ownerWordsSchemeOf } from "../../../handover/hisWords.js";
import { recordOfRead } from "../../../handover/hisWordsRecord.js";
import { resolveHisWords } from "../../../handover/hisWordsResolve.js";
import { logger } from "../../../lib/logger.js";

/**
 * What a new row stores about the owner's words at its anchor — the words, or why they would not read — or nothing when
 * the anchor names none.
 *
 * @param anchor the row's `--anchor`, absent when none was passed
 * @param home the Slopweaver home the talk records live under
 * @returns the record to store, or `undefined`
 */
export function registrationHisWords({
  anchor,
  home,
}: {
  anchor: string | undefined;
  home: string;
}): HisWordsRecord | undefined {
  if (anchor === undefined || ownerWordsSchemeOf({ anchor }) === undefined) {
    return undefined;
  }
  const read = resolveHisWords({ anchor, home, projectsDir: join(homedir(), ".claude", "projects") });
  // A card landing registers its `call:` row BEFORE it appends the ledger row the words come off, then quotes the
  // row itself (`../talk/cardLandApply.ts`) — so a missing landing here is the expected order, not a failure.
  const landingPending =
    ownerWordsSchemeOf({ anchor }) === "call" && read.isErr() && read.error.code === "RECORD_MISSING";
  if (read.isErr() && !landingPending) {
    logger.error({
      msg: `handover register: the owner's words did not read — ${read.error.message}; the row says so, and \`slopweaver handover quote --apply\` retries`,
    });
  }
  return recordOfRead({ anchor, read });
}
