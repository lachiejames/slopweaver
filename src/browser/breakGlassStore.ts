/**
 * Appending and reading the browser break-glass journal — the effectful half of {@link ./breakGlass}.
 *
 * Synchronous and failure-swallowing on the READ side: an unreadable journal must leave the reader deciding
 * as if there were no grant (the refusing side), never throw. The WRITE side throws, because a waiver nobody
 * recorded is not a waiver — and the caller there is a CLI verb the operator is watching.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { stateHomePaths } from "../stateHome.js";
import {
  BROWSER_BREAK_GLASS_WINDOW_MS,
  type BrowserBreakGlassGrant,
  parseBrowserBreakGlassLine,
} from "./breakGlass.js";

/** Owner-only permissions — a reason line is free text somebody typed about their own machine. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The journal's absolute path.
 *
 * Under `ledgers/` beside `browser-verdicts.jsonl`, and deliberately NOT the same file: a verdict is what a
 * guard decided, a waiver is a human saying "lift this rule on this page for a while".
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `ledgers/browser-break-glass.jsonl`
 */
export function browserBreakGlassPath({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home === undefined ? {} : { home }).ledgers, "browser-break-glass.jsonl");
}

/**
 * Every grant the journal holds.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the decodable grants, in file order; empty when the journal is absent or unreadable
 */
export function readBrowserBreakGlassGrants({ home }: { home?: string } = {}): readonly BrowserBreakGlassGrant[] {
  const grants: BrowserBreakGlassGrant[] = [];
  try {
    // A line at a time, for the same reason the verdict journal reads that way: a `.jsonl` is append-only
    // with no ceiling, so reading one whole into a JS string is a size the data decides.
    readJsonlLines({
      onLine: ({ line }) => {
        const grant = parseBrowserBreakGlassLine({ line });
        if (grant !== undefined) {
          grants.push(grant);
        }
      },
      path: browserBreakGlassPath(home === undefined ? {} : { home }),
    });
  } catch {
    return [];
  }
  return grants;
}

/**
 * Build one grant, expiring {@link BROWSER_BREAK_GLASS_WINDOW_MS} after it is issued.
 *
 * @param sessionId the session taking the grant
 * @param reason why the door could not be used instead
 * @param issuedAtIso when it is being taken
 * @returns the grant to append
 */
export function buildBrowserBreakGlassGrant({
  sessionId,
  reason,
  issuedAtIso,
  page,
}: {
  sessionId: string;
  reason: string;
  issuedAtIso: string;
  /** The ONE page this grant waives the read-only rail on, when it was taken for that. */
  page?: string | undefined;
}): BrowserBreakGlassGrant {
  return {
    expiresAtIso: new Date(Date.parse(issuedAtIso) + BROWSER_BREAK_GLASS_WINDOW_MS).toISOString(),
    issuedAtIso,
    reason,
    sessionId,
    ...(page === undefined ? {} : { page }),
  };
}

/**
 * Append one grant to the journal, creating it if needed.
 *
 * @param grant the grant to record
 * @param home the state home (defaults to the resolved home)
 */
export function appendBrowserBreakGlassGrant({ grant, home }: { grant: BrowserBreakGlassGrant; home?: string }): void {
  mkdirSync(stateHomePaths(home === undefined ? {} : { home }).ledgers, { mode: DIR_MODE, recursive: true });
  appendLines({
    mode: FILE_MODE,
    path: browserBreakGlassPath(home === undefined ? {} : { home }),
    text: `${JSON.stringify(grant)}\n`,
  });
}
