/**
 * One `turn watch` ticker per live card: the claim a looping watch takes before its first tick and renews
 * before every one after.
 *
 * MEASURED on the live bot loop: FIFTEEN `turn watch --brief <one brief>` processes ran at once,
 * every one ppid 1, ~1.9 GB resident between them, every one rewriting the same Slack card each 90 seconds.
 * Fourteen had been started by the turn's own detective leaves. A Claude Code Workflow relays the parent's
 * user request verbatim to every leaf, and that request is the worker's ("start `turn watch` in the
 * background"), so each Haiku leaf ran the worker's step 0a too. Reproduce the count on a live turn:
 * `pgrep -fl 'turn watch --brief' | sort -k5 | uniq -c -f4`.
 *
 * The briefs now tell a leaf the relayed steps are not its own (`src/detective/brief.ts`), but prose is what
 * failed here, so the invariant lives in the verb: a second looping watch on the same card exits at once.
 *
 * - **Keyed on the CARD and the SESSION** (`channel`, `workingTs`, the visible session's id). A detective leaf
 *   runs inside its worker's own Claude Code process and carries the same `CLAUDE_CODE_SESSION_ID`, so every
 *   duplicate measured above shares one key. A RE-DISPATCH to a fresh session on the same card does not: the
 *   dead worker's ticker survives it until `orphanedTickerVerdict` reaps it, and a card-only key would make
 *   the fresh worker's ticker exit behind that one and leave the card frozen once it went. Two tickers until
 *   the reap is the behaviour before this lock.
 * - **RENEWED every tick, so the stale window is a few ticks, never the ticker's whole life.** The lock
 *   records only a pid and an instant, and a ticker killed by a signal leaves its claim behind. Judged
 *   against a two-hour life, a REUSED pid then reads as a live holder and freezes the card for two hours
 *   (about 450 pids went by in four seconds on this machine, so the space wraps inside that); and a live
 *   ticker still ticking past its own claim's age could be joined. Both were counterexamples in this
 *   branch's fallback reviews. A holder re-takes its claim before each tick and STOPS when it cannot, so
 *   whichever ticker holds the claim is the only one that STARTS a write, and a leftover claim goes stale
 *   in {@link turnWatchStaleAfterMs}.
 *
 * **The residue, stated rather than discovered** (fallback review r3 on this branch). This lock stops a
 * second ticker from STARTING; it cannot fence a write already in flight, because `chat.update` has no
 * conditional form. A tick stalled past the stale window (a Slack outage under the SDK's own retries, a
 * laptop asleep mid-call) can land one late edit after a newcomer has taken the card, and the stalled
 * holder stops at its next renewal. The window is judged by the NEWCOMER's interval, since the lock
 * records none, so a holder started by hand with `--interval-seconds` above the default can be joined for
 * a tick; no printed launch line passes one. Both are one overlapping tick, where the measured defect was
 * fifteen tickers for the turn's whole life.
 */
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { DEFAULT_WATCH_INTERVAL_SECONDS } from "./watchDefaults.js";

/** How many ticks a claim may go unrenewed before it is not a live ticker's. */
const STALE_AFTER_TICKS = 3;

/** A held claim on one card: renewed before every tick, released on the way out. */
export interface TurnWatchHold {
  /** Re-take the claim at this instant; `false` means another ticker holds the card now and this one stops. */
  readonly renew: (at: { readonly nowIso: string }) => boolean;
  /** Give the claim up. Safe to call twice. */
  readonly release: () => void;
}

/**
 * The lock key for one card in one session. Pure.
 *
 * @param channel the channel the card is posted in
 * @param sessionId the visible session this ticker runs under, which its detective leaves share
 * @param workingTs the card message's own `ts`, which is what every tick edits
 * @returns the operation-lock key
 */
export function turnWatchLockKey({
  channel,
  sessionId,
  workingTs,
}: {
  channel: string;
  sessionId: string;
  workingTs: string;
}): string {
  return `turn-watch:${channel}:${workingTs}:${sessionId}`;
}

/**
 * How long a claim may go unrenewed before it is no longer a live ticker's. Pure.
 *
 * Floored at the default interval, so a newcomer launched with a short `--interval-seconds` cannot judge a
 * default ticker stale between two of its renewals.
 *
 * @param intervalSeconds this claimant's own `--interval-seconds`
 * @returns three of the longer of this ticker's tick and a default one's, in milliseconds
 */
export function turnWatchStaleAfterMs({ intervalSeconds }: { intervalSeconds: number }): number {
  return STALE_AFTER_TICKS * Math.max(intervalSeconds, DEFAULT_WATCH_INTERVAL_SECONDS) * 1000;
}

/**
 * Claim the card for this ticker, or learn that a live one already keeps it.
 *
 * @param home the state home the lock lives under
 * @param channel the channel the card is posted in
 * @param sessionId the visible session this ticker runs under
 * @param workingTs the card message's own `ts`
 * @param staleAfterMs from {@link turnWatchStaleAfterMs}
 * @param nowIso the instant of the claim
 * @returns the hold to renew and release, or the reason another ticker holds the card
 */
export function claimTurnWatch({
  channel,
  home,
  nowIso,
  sessionId,
  staleAfterMs,
  workingTs,
}: {
  channel: string;
  home: string;
  nowIso: string;
  sessionId: string;
  staleAfterMs: number;
  workingTs: string;
}): Result<TurnWatchHold, string> {
  const key = turnWatchLockKey({ channel, sessionId, workingTs });
  const first = acquireOperationLock({ home, key, nowIso, staleAfterMs });
  if (first.isErr()) {
    return err(first.error);
  }
  let current: { release: () => void } | undefined = first.value;
  return ok({
    release: () => {
      current?.release();
      current = undefined;
    },
    renew: ({ nowIso: at }) => {
      if (current === undefined) {
        return false;
      }
      // Release-then-take rather than an in-place touch: the lock has no refresh, and a newcomer that wins
      // the gap is simply the ticker that carries on while this one stops.
      current.release();
      const next = acquireOperationLock({ home, key, nowIso: at, staleAfterMs });
      current = next.isOk() ? next.value : undefined;
      return next.isOk();
    },
  });
}
