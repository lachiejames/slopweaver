/**
 * `slopweaver browser <break-glass|verdicts>` — the effectful shell for the guard's own journals.
 *
 * `verdicts` reads back what `src/admit/browserDoorGuardRunner.ts` decided; `break-glass` records a bounded
 * waiver, which a `--page` grant spends on that one page's read-only rule. They are one file because they
 * are two halves of the same question — what a guard did, and who overruled one.
 *
 * The rendering, selection and grant arithmetic live in `./journalCore.ts` and `src/browser/breakGlass.ts`. What
 * this file decides itself is the two refusals `break-glass` makes before it appends anything — a blank reason
 * and a missing live session — and otherwise it reads and appends.
 */
import { browserVerdictJournalPath, readBrowserVerdicts } from "../../../admit/browserVerdictJournal.js";
import { BROWSER_BREAK_GLASS_WINDOW_MS, browserBreakGlassCountFor } from "../../../browser/breakGlass.js";
import {
  appendBrowserBreakGlassGrant,
  browserBreakGlassPath,
  buildBrowserBreakGlassGrant,
  readBrowserBreakGlassGrants,
} from "../../../browser/breakGlassStore.js";
import { logger } from "../../../lib/logger.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../supervisor/session.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  BROWSER_VERDICTS_DEFAULT_LIMIT,
  browserVerdictTotals,
  renderBrowserVerdicts,
  selectBrowserVerdicts,
} from "./journalCore.js";
import type { BrowserOptions } from "./profileCore.js";

/** How many recent rows `browser verdicts` prints: `--limit` when given, else the report's own default. */
function verdictRowCap({ options }: { options: BrowserOptions }): number {
  const asked = options.limit;
  if (asked === undefined) {
    return BROWSER_VERDICTS_DEFAULT_LIMIT;
  }
  return asked;
}

/**
 * Run `browser verdicts`: print what the guard has decided under this home.
 *
 * @param options the resolved invocation, for `--limit`, `--blocked`, `--json`
 * @param home the state home the journal lives under
 * @returns the process exit code
 */
export function runVerdicts({ options, home }: { options: BrowserOptions; home: string }): number {
  const records = readBrowserVerdicts({ home });
  const rows = selectBrowserVerdicts({
    blocked: options.blocked,
    limit: verdictRowCap({ options }),
    records,
  });
  const path = browserVerdictJournalPath({ home });
  if (options.json) {
    logger.out({ line: JSON.stringify({ path, records: rows, totals: browserVerdictTotals({ records }) }, null, 2) });
    return EXIT_OK;
  }
  for (const line of renderBrowserVerdicts({ path, records: rows, totals: browserVerdictTotals({ records }) })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Run `browser break-glass`: record a bounded, expiring waiver; with `--page`, it lifts that page's
 * read-only rule.
 *
 * It refuses a blank reason and it refuses to run outside a live session, for the same reason
 * `session reach-grant` does: a grant is issued TO a session, and one recorded outside a live one could
 * never be matched to the call it was meant to open.
 *
 * @param options the resolved invocation, for `--reason` and `--json`
 * @param home the state home the journal lives under
 * @param readSessionId reads the live session's id, sampled only once the reason has been accepted; the
 *   process environment unless a test supplies its own
 * @param now samples the instant the grant is issued at, only once a session is established; the wall clock
 *   unless a test supplies its own
 * @returns the process exit code
 */
export function runBreakGlass({
  options,
  home,
  readSessionId = () => process.env[CLAUDE_CODE_SESSION_ID_ENV],
  now = () => new Date(),
}: {
  options: BrowserOptions;
  home: string;
  readSessionId?: () => string | undefined;
  now?: () => Date;
}): number {
  const reason = options.reason?.trim();
  if (reason === undefined || reason.length === 0) {
    logger.error({
      msg: "browser break-glass: --reason is required and must not be blank — a waiver with no stated reason records nothing",
    });
    return EXIT_USAGE;
  }
  const sessionId = readSessionId();
  if (sessionId === undefined || sessionId.length === 0) {
    logger.error({
      msg:
        `browser break-glass: ${CLAUDE_CODE_SESSION_ID_ENV} is not set — the guard keys a waiver to the session id ` +
        "its hook payload carries, so one recorded outside a live session could never match a call",
    });
    return EXIT_ERROR;
  }
  const grant = buildBrowserBreakGlassGrant({
    issuedAtIso: now().toISOString(),
    reason,
    sessionId,
    ...(options.page === undefined ? {} : { page: options.page }),
  });
  appendBrowserBreakGlassGrant({ grant, home });
  const taken = browserBreakGlassCountFor({ grants: readBrowserBreakGlassGrants({ home }), sessionId });
  if (options.json) {
    logger.out({
      line: JSON.stringify({ grant, path: browserBreakGlassPath({ home }), takenBySession: taken }, null, 2),
    });
    return EXIT_OK;
  }
  logger.out({
    line:
      grant.page === undefined
        ? `browser break-glass: RECORDED — the browser door is open for this session until ${grant.expiresAtIso} ` +
          `(${String(BROWSER_BREAK_GLASS_WINDOW_MS / 60000)} minutes), then it returns. Reason: ${grant.reason}`
        : `browser break-glass: RECORDED for ${grant.page} ONLY — \`browser act\` may write on that one page until ` +
          `${grant.expiresAtIso}, and on nothing else. Reason: ${grant.reason}`,
  });
  logger.out({
    line:
      `browser break-glass: this session has taken ${String(taken)} waiver(s). Every call it lets through is ` +
      `journalled to ${browserVerdictJournalPath({ home })} carrying the refusal it overrode.`,
  });
  return EXIT_OK;
}
