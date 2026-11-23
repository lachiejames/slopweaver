/**
 * Appending and reading the reach-grant journal — the effectful half of {@link ./reachGrant}.
 *
 * Synchronous and failure-swallowing on the READ side for the same reason as
 * `../browser/breakGlassStore.ts`: the reader is a `PreToolUse` hook, so an unreadable journal must
 * leave the guard BLOCKING (there is no live grant to find), never throw. The WRITE side throws, because a
 * grant nobody recorded is not a grant.
 */
import { mkdirSync, readFileSync } from "node:fs";

import { appendLines } from "../lib/appendSeparator.js";
import { stateHomePaths } from "../stateHome.js";
import { parseReachGrantJournal, REACH_GRANT_WINDOW_MS, type ReachGrant } from "./reachGrant.js";

/** Owner-only permissions, matching `../browser/breakGlassStore.ts`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The reach-grant journal's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `sessions/reach-grants.jsonl`
 */
function reachGrantsPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).reachGrantsJsonl;
}

/**
 * Every grant the journal holds.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the decodable grants, in file order; empty when the journal is absent or unreadable
 */
export function readReachGrants({ home }: { home?: string } = {}): readonly ReachGrant[] {
  try {
    return parseReachGrantJournal({
      text: readFileSync(reachGrantsPath(home === undefined ? {} : { home }), "utf8"),
    });
  } catch {
    return [];
  }
}

/**
 * Build one grant, expiring {@link REACH_GRANT_WINDOW_MS} after it is issued.
 *
 * @param claudeSessionId the session taking the grant
 * @param tool the one tool it opens
 * @param reason why the door cannot carry this
 * @param issuedAtIso when it is being taken
 * @returns the grant to append
 */
export function buildReachGrant({
  claudeSessionId,
  tool,
  reason,
  issuedAtIso,
}: {
  claudeSessionId: string;
  tool: string;
  reason: string;
  issuedAtIso: string;
}): ReachGrant {
  return {
    claudeSessionId,
    expiresAtIso: new Date(Date.parse(issuedAtIso) + REACH_GRANT_WINDOW_MS).toISOString(),
    issuedAtIso,
    reason,
    tool,
  };
}

/**
 * Append one grant to the journal, creating it if needed.
 *
 * @param grant the grant to record
 * @param home the state home (defaults to the resolved home)
 */
export function appendReachGrant({ grant, home }: { grant: ReachGrant; home?: string }): void {
  mkdirSync(stateHomePaths(home === undefined ? {} : { home }).sessions, { mode: DIR_MODE, recursive: true });
  appendLines({
    mode: FILE_MODE,
    path: reachGrantsPath(home === undefined ? {} : { home }),
    text: `${JSON.stringify(grant)}\n`,
  });
}
