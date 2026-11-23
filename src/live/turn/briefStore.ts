/**
 * Where a brief LIVES — the one writer, so both producers agree on the path and the bytes.
 *
 * `listen run` writes a brief when a tag arrives, and `turn brief` writes one when a mention is replayed by
 * hand. They are the same artifact and `turn answer` reads both, so having each caller do its own
 * `mkdirSync` + `writeFileSync` was two places for the path convention to drift — and drift here means
 * `turn answer` reading a stale brief from the path the other producer no longer uses.
 *
 * It is LOCAL STATE, not an external effect: everything below writes under `$SLOPWEAVER_HOME` and nothing
 * leaves the machine. The external write this feeds is `turn answer`'s Slack post, and that goes through the
 * admit door in the ordinary way.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { err, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import type { AskIdentity } from "../ask/identity.js";
import { parseTurnRoutingBrief, type TurnRoutingBrief } from "./brief.js";
import { type BriefParseError, BriefParseErrors } from "./errors.js";

/**
 * Where a brief lands for a given ASK — keyed on the exact addressing message, not the thread it replies
 * into.
 *
 * Under the state home rather than a temp dir, because a brief is the record of what a turn was shown and
 * `turn answer` may run minutes later. Keying on `(channel, messageTs)` rather than `(channel, threadTs)` is
 * a deliberate REVERSAL of this file's original contract: two asks sharing one thread root used to overwrite
 * each other's brief, which was fine only because nothing yet distinguished them. Re-briefing the SAME ask
 * is still idempotent — it overwrites its own path — but a second, different ask in the same thread now gets
 * its own file rather than clobbering the first.
 *
 * @param askIdentity the exact ask this brief is for
 * @param home the resolved state home
 * @returns the absolute path to write the brief to
 */
export function defaultBriefPath({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): string {
  // The directory comes from `stateHomePaths`, never assembled here. The home layout is a single typed
  // contract, and a second place that knows which sub-directory briefs live in is a second place for that
  // layout to drift — which is why the guard checks for it, in comments as well as in code.
  return join(stateHomePaths({ home }).briefs, `${askIdentity.channel}-${askIdentity.messageTs}.json`);
}

/**
 * Write a brief, creating its directory.
 *
 * Pretty-printed rather than compact, and that is deliberate: the operator reads this file when an answer
 * looks wrong, and the first question is always "what was it actually shown".
 *
 * @param brief the brief to persist
 * @param path where to write it
 */
export function writeBrief({ brief, path }: { brief: TurnRoutingBrief; path: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
}

/**
 * Read a brief back off disk, through the same decoder every reader shares — `turn dispatch`, `turn resume`
 * and `turn answer` all call this rather than each re-parsing the file themselves.
 *
 * @param path the brief's path
 * @returns the validated brief, or every reason it could not be read or does not parse
 */
export function readBrief({ path }: { path: string }): Result<TurnRoutingBrief, BriefParseError> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return err(BriefParseErrors.unreadable({ message: error instanceof Error ? error.message : String(error), path }));
  }
  return parseTurnRoutingBrief({ raw });
}
