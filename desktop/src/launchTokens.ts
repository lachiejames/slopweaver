/**
 * The launch tokens `launch.prepare` answers with: each minted at most once in a run of the app, acted on only once
 * its answer has left, settled by exactly one `launch.deliver` or `launch.abort`, and expired by the app itself when
 * neither arrives in time, so a spawning CLI that died never leaves a session nobody will settle.
 * `sessionLaunch.ts` holds the one instance and turns a refusal here into the protocol's own.
 */
import { err, ok, type Result } from "neverthrow";

import type { ScheduleTimeout } from "./cardStop";

/** One run of the app's launch tokens. */
export interface LaunchTokens {
  /** A token never minted before in this run, or why none is: a repeat is refused, never reissued. */
  readonly fresh: () => Result<string, string>;
  /** The answer naming this token has left: it may now be settled, and expires if nothing settles it in time. */
  readonly issue: (options: { readonly launchToken: string; readonly sessionId: string }) => void;
  /** Settle an issued token once: the session it was issued for, or why no launch waits on it. */
  readonly settle: (options: { readonly launchToken: string }) => Result<string, string>;
}

/**
 * A run of the app's launch tokens.
 *
 * @param mint makes a candidate token, a random UUID in the app
 * @param schedule the timer an issued token's expiry runs on
 * @param unsettledMs how long an issued token waits to be settled
 * @param expired told the session whose token nothing settled in time, once, after the token is withdrawn
 * @returns the tokens
 */
export function launchTokensFor({
  mint,
  schedule,
  unsettledMs,
  expired,
}: {
  mint: () => string;
  schedule: ScheduleTimeout;
  unsettledMs: number;
  expired: (options: { sessionId: string }) => void;
}): LaunchTokens {
  // Every token ever minted, so a value is issued at most once and a replayed old one finds nothing.
  const everMinted = new Set<string>();
  // The tokens answered with and not yet settled, each with the session it was issued for.
  const issued = new Map<string, string>();
  return {
    fresh: () => {
      const launchToken = mint();
      if (everMinted.has(launchToken)) {
        return err("a launch token repeated; the launch is refused rather than reissue it");
      }
      everMinted.add(launchToken);
      return ok(launchToken);
    },
    issue: ({ launchToken, sessionId }) => {
      issued.set(launchToken, sessionId);
      schedule({
        afterMs: unsettledMs,
        run: () => {
          if (issued.delete(launchToken)) {
            expired({ sessionId });
          }
        },
      });
    },
    settle: ({ launchToken }) => {
      const sessionId = issued.get(launchToken);
      if (sessionId === undefined) {
        return err("no launch is waiting on that token");
      }
      issued.delete(launchToken);
      return ok(sessionId);
    },
  };
}
