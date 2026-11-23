/**
 * The RECORDED escape hatch for a read-only PAGE rule — `slopweaver browser break-glass --page <url>`.
 *
 * ## Why a journal rather than an environment variable
 *
 * An exported variable is ambient, so it survives for the life of the shell and every later browser call in
 * that session inherits it silently; and it leaves nothing to read afterwards. So a waiver is a line in a
 * journal. It names the session, carries a reason a human wrote, and EXPIRES.
 *
 * ## What it waives, and what it no longer does
 *
 * Only a page-scoped grant does anything: {@link activeBrowserPageWaiver} lifts a read-only page rule on one
 * exact page for the Playwright verbs. It once also waived the Claude-in-Chrome guard's page-by-page
 * refusals, session-wide; that extension is retired outright with no override, and no consumer of it remains. A session-wide grant is still
 * recorded and counted, and waives nothing.
 *
 * Pure: lines in, the live grant out. The file lives in `./breakGlassStore.ts`.
 */
import { isRecord } from "../lib/parsers.js";

/**
 * How long one grant holds a read-only page rule open.
 *
 * Thirty minutes, matching {@link ../hatch/grant.HATCH_GRANT_WINDOW_MS} deliberately rather
 * than coincidentally: both answer "long enough for the operator to finish the thing they broke the glass
 * for, and short enough that they cannot forget they did".
 */
export const BROWSER_BREAK_GLASS_WINDOW_MS = 30 * 60 * 1000;

/** One recorded decision to drive the browser past a read-only rule. */
export interface BrowserBreakGlassGrant {
  /** The session the grant was issued to — a grant is never transferable. */
  readonly sessionId: string;
  /** Why the door could not be used instead. Free text, written by whoever took the grant. */
  readonly reason: string;
  readonly issuedAtIso: string;
  readonly expiresAtIso: string;
  /**
   * The ONE page this grant waives a read-only rule on, when it was taken for that — absent on a
   * session-wide grant.
   *
   * Here because the rule is a hard click error on a read-only page with an escape
   * hatch, and a session-wide waiver is the wrong shape for that escape: it would lift the JumpCloud rail
   * for every page the session touches afterwards, silently, which is the ambient-permission failure this
   * whole journal was built to replace. A grant with no `page` waives nothing on the page rail —
   * {@link activeBrowserPageWaiver} requires an exact match — so an old unscoped grant cannot reach the new
   * rule by accident.
   */
  readonly page?: string;
}

/**
 * Parse one journal line.
 *
 * @param line one raw JSONL line
 * @returns the grant, or `undefined` for a blank, malformed or incomplete line
 */
export function parseBrowserBreakGlassLine({ line }: { line: string }): BrowserBreakGlassGrant | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const { sessionId, reason, issuedAtIso, expiresAtIso, page } = parsed;
  if (
    typeof sessionId !== "string" ||
    typeof reason !== "string" ||
    typeof issuedAtIso !== "string" ||
    typeof expiresAtIso !== "string"
  ) {
    return undefined;
  }
  return { expiresAtIso, issuedAtIso, reason, sessionId, ...(typeof page === "string" ? { page } : {}) };
}

/**
 * Every grant a journal holds, dropping the lines that will not decode.
 *
 * @param text the journal's whole contents
 * @returns the decodable grants, in file order
 */
export function parseBrowserBreakGlassJournal({ text }: { text: string }): readonly BrowserBreakGlassGrant[] {
  return text
    .split("\n")
    .map((line) => parseBrowserBreakGlassLine({ line }))
    .filter((grant): grant is BrowserBreakGlassGrant => grant !== undefined);
}

/**
 * How many grants one session has ever taken — what the CLI quotes back so a repeat is visible.
 *
 * Counts expired grants too, on purpose: the number worth reading is how often this session has chosen to
 * drive past the guard, not how many are live right now.
 *
 * @param grants every grant in the journal
 * @param sessionId the session to count for
 * @returns the count
 */
export function browserBreakGlassCountFor({
  grants,
  sessionId,
}: {
  grants: readonly BrowserBreakGlassGrant[];
  sessionId: string;
}): number {
  return grants.filter((grant) => grant.sessionId === sessionId).length;
}

/**
 * The waiver, if any, that lifts a read-only PAGE rule for one session on one exact page.
 *
 * A grant with no `page` is not a candidate at all. The owner asked for the hard failure and for a way past
 * it; a waiver that covered everything a session went on to touch would be the first half without the
 * second, and the whole reason the journalled grant replaced an exported variable was that an ambient escape
 * is one nobody remembers taking. Scanned from the END, so the NEWEST live grant wins.
 *
 * @param grants every grant in the journal
 * @param sessionId the session asking
 * @param url the exact page the refused action was aimed at
 * @param nowIso the instant to judge expiry against — passed in, never read from the clock
 * @returns the newest live grant scoped to that exact page, or `undefined`
 */
export function activeBrowserPageWaiver({
  grants,
  sessionId,
  url,
  nowIso,
}: {
  grants: readonly BrowserBreakGlassGrant[];
  sessionId: string;
  url: string;
  nowIso: string;
}): BrowserBreakGlassGrant | undefined {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) {
    return undefined;
  }
  return grants.findLast((grant) => {
    const expires = Date.parse(grant.expiresAtIso);
    return grant.sessionId === sessionId && grant.page === url && !Number.isNaN(expires) && expires > now;
  });
}
