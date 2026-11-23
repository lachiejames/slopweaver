/**
 * Appending and reading the hatch-grant journal — the effectful half of {@link ./grant}.
 *
 * Synchronous and failure-swallowing on the READ side, exactly as `../admit/reachGrantStore.ts` is
 * and for the same reason: a reader that cannot open the journal must leave the hatch CLOSED (there is no
 * live grant to find), never throw its way past a refusal. The WRITE side throws, because a grant nobody
 * recorded is not a grant, and reporting one that was never written is the failure this lane replaced an
 * ambient variable to avoid.
 */
import { mkdirSync, readFileSync } from "node:fs";

import { appendLines } from "../lib/appendSeparator.js";
import { stateHomePaths } from "../stateHome.js";
import { type HatchGrant, parseHatchGrantJournal } from "./grant.js";

/** Owner-only permissions, matching `../admit/reachGrantStore.ts`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The hatch-grant journal's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `sessions/hatch-grants.jsonl`
 *
 * @internal — reached through `hatchOpen` or the grant store; nothing outside names it directly.
 */
export function hatchGrantsPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).hatchGrantsJsonl;
}

/**
 * Every grant the journal holds.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the decodable grants, in file order; empty when the journal is absent or unreadable
 */
export function readHatchGrants({ home }: { home?: string } = {}): readonly HatchGrant[] {
  try {
    return parseHatchGrantJournal({ text: readFileSync(hatchGrantsPath(home === undefined ? {} : { home }), "utf8") });
  } catch {
    return [];
  }
}

/**
 * Append one grant to the journal, creating it if needed.
 *
 * @param grant the grant to record
 * @param home the state home (defaults to the resolved home)
 */
export function appendHatchGrant({ grant, home }: { grant: HatchGrant; home?: string }): void {
  mkdirSync(stateHomePaths(home === undefined ? {} : { home }).sessions, { mode: DIR_MODE, recursive: true });
  appendLines({
    mode: FILE_MODE,
    path: hatchGrantsPath(home === undefined ? {} : { home }),
    text: `${JSON.stringify(grant)}\n`,
  });
}
