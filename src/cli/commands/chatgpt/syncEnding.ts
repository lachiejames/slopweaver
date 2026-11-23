/**
 * How a `chatgpt sync` that took every held export in ends: the exit code its corpus's age earns, and the certified
 * as-of a scheduled resync stamps in place of its own finish time (`corpus/chatgpt/exportAsOf.ts`). Its own module so
 * the verb's file stays one a reader can hold; the verb (`./exportRun.ts`) owns every path that reaches here.
 */
import { logger } from "#lib/logger.js";

import { writeCertifiedAsOf } from "../../../corpus/chatgpt/exportAsOf.js";
import type { StoredExport } from "../../../corpus/chatgpt/exportStore.js";
import { corpusFreshnessWindowMs } from "../../../corpus/freshnessPolicy.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";

/** Milliseconds in a day, for the age a deferral names. */
const DAY_MS = 86_400_000;

/**
 * A succeeding sync's last write: the instant it certified. A sync that cannot record it does not succeed, since the
 * resync that ran it would then have no instant to stamp but its own finish.
 *
 * @param asOfIso the instant the corpus is current as of
 * @param code the exit the sync earned, returned when the record is written
 * @param newest the newest held export, the one the instant dates
 * @param root the managed export root
 * @returns `code`, or 1 when the record could not be written
 */
export function certifiedEnding({
  asOfIso,
  code,
  newest,
  root,
}: {
  asOfIso: string;
  code: number;
  newest: StoredExport;
  root: string;
}): number {
  const written = writeCertifiedAsOf({ asOfIso, contentHash: newest.contentHash, root });
  if (written.isErr()) {
    logger.error({ msg: `chatgpt: the corpus is in, but ${written.error.message}` });
    return EXIT_ERROR;
  }
  return code;
}

/**
 * Every held export is already in: a verified sync only while the corpus is younger than ChatGPT's own freshness
 * window — a 3, certified, which is how the row's FIRST pass after they synced by hand establishes its clock at all.
 * Past the window it is NOT YET: a 3 would stamp a verified sync every day off one old archive, so it defers, the
 * slot stays open, and the freshness page goes stale on its own until they export again.
 *
 * @param asOfIso the instant the newest export is current as of
 * @param newest the newest held export
 * @param nowIso the pass's own instant
 * @param root the managed export root
 * @returns 3 within the window, 4 past it, 1 when the as-of could not be recorded
 */
export function alreadyInEnding({
  asOfIso,
  newest,
  nowIso,
  root,
}: {
  asOfIso: string;
  newest: StoredExport;
  nowIso: string;
  root: string;
}): number {
  const short = newest.contentHash.slice(0, 12);
  const ageMs = Date.parse(nowIso) - Date.parse(asOfIso);
  if (ageMs < corpusFreshnessWindowMs({ source: "chatgpt" })) {
    logger.out({ line: `chatgpt: export ${short} is already in the corpus, current as of ${asOfIso}` });
    return certifiedEnding({ asOfIso, code: EXIT_EXPECTED_EMPTY, newest, root });
  }
  const days = Math.floor(ageMs / DAY_MS);
  logger.error({
    msg:
      `chatgpt: export ${short} is already in the corpus and nothing newer has arrived — the corpus holds ChatGPT ` +
      `as of an export ${String(days)} day(s) old; download a newer one ` +
      "(chatgpt.com → Settings → Data controls → Export data) and the next sync takes it in",
  });
  return EXIT_DEFERRED;
}
