import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_WATCH_INTERVAL_SECONDS,
  DEFAULT_WATCH_MAX_SECONDS,
} from "../../../../../cli/commands/turn/watchDefaults.js";
import { claimTurnWatch, turnWatchLockKey, turnWatchStaleAfterMs } from "../../../../../cli/commands/turn/watchLock.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const NOW = "2026-09-25T06:30:00.000Z";
const STALE_MS = turnWatchStaleAfterMs({ intervalSeconds: 90 });
const CARD = { channel: "C1", sessionId: "s-worker", staleAfterMs: STALE_MS, workingTs: "1.1" };

/** An instant `ms` after {@link NOW}. */
const after = ({ ms }: { ms: number }): string => new Date(Date.parse(NOW) + ms).toISOString();

describe("turnWatchLockKey", () => {
  it("keys on the card and the session", () => {
    expect(turnWatchLockKey({ channel: "C1", sessionId: "s-1", workingTs: "1790316271.913039" })).toBe(
      "turn-watch:C1:1790316271.913039:s-1",
    );
  });
});

describe("watch defaults", () => {
  it("ticks every 90s for two hours, the dispatch lease", () => {
    expect(DEFAULT_WATCH_INTERVAL_SECONDS).toBe(90);
    expect(DEFAULT_WATCH_MAX_SECONDS).toBe(7200);
  });
});

describe("turnWatchStaleAfterMs", () => {
  it("is three default ticks for a claimant with a short interval", () => {
    // A newcomer's `--interval-seconds 1` must never judge a default ticker stale between two renewals.
    expect(turnWatchStaleAfterMs({ intervalSeconds: 1 })).toBe(270_000);
  });

  it("is three of a longer claimant's own ticks", () => {
    expect(turnWatchStaleAfterMs({ intervalSeconds: 120 })).toBe(360_000);
  });
});

describe("claimTurnWatch", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });
  const freshHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), "watch-lock-"));
    homes.push(home);
    return home;
  };

  // MEASURED: fifteen tickers on one card, every one under the worker's own session id.
  it("refuses a second ticker on the same card in the same session while the first is live", () => {
    const home = freshHome();
    const first = claimTurnWatch({ ...CARD, home, nowIso: NOW });
    expect(first.isOk()).toBe(true);
    const second = claimTurnWatch({ ...CARD, home, nowIso: after({ ms: 1000 }) });
    expect(unwrapErr(second)).toContain(`held by pid ${String(process.pid)}`);
  });

  it("lets a different card on the same channel have its own ticker", () => {
    const home = freshHome();
    const first = claimTurnWatch({ ...CARD, home, nowIso: NOW });
    const other = claimTurnWatch({ ...CARD, home, nowIso: NOW, workingTs: "2.2" });
    expect(first.isOk()).toBe(true);
    expect(other.isOk()).toBe(true);
  });

  // A re-dispatch to a fresh session must not exit behind a dead worker's ticker, or the card
  // freezes the moment that orphan reaps itself.
  it("lets a re-dispatched session start its own ticker on the same card", () => {
    const home = freshHome();
    const dead = claimTurnWatch({ ...CARD, home, nowIso: NOW });
    const fresh = claimTurnWatch({ ...CARD, home, nowIso: NOW, sessionId: "s-redispatch" });
    expect(dead.isOk()).toBe(true);
    expect(fresh.isOk()).toBe(true);
  });

  it("frees the card once the holder releases it", () => {
    const home = freshHome();
    unwrap(claimTurnWatch({ ...CARD, home, nowIso: NOW })).release();
    const again = claimTurnWatch({ ...CARD, home, nowIso: NOW });
    expect(again.isOk()).toBe(true);
  });

  // A live ticker past two hours of age was joinable. Renewal keeps a live claim young.
  it("still blocks a newcomer long after the claim was first taken, while the holder keeps renewing", () => {
    const home = freshHome();
    const hold = unwrap(claimTurnWatch({ ...CARD, home, nowIso: NOW }));
    const renewed = [1, 2, 3, 4].map((tick) => hold.renew({ nowIso: after({ ms: tick * 90_000 }) }));
    expect(renewed).toEqual([true, true, true, true]);
    const late = claimTurnWatch({ ...CARD, home, nowIso: after({ ms: 4 * 90_000 + 1000 }) });
    expect(unwrapErr(late)).toContain(`held by pid ${String(process.pid)}`);
  });

  // A claim left by a ticker killed with a signal, whose pid was reused, froze the card for
  // two hours. Unrenewed, it now goes stale in three ticks.
  it("takes over a claim left unrenewed past the stale window, the reused-pid case", () => {
    const home = freshHome();
    unwrap(claimTurnWatch({ ...CARD, home, nowIso: NOW }));
    const takeover = claimTurnWatch({ ...CARD, home, nowIso: after({ ms: STALE_MS + 1 }) });
    expect(unwrap(takeover).release).toBeDefined();
  });

  it("stops a holder whose claim was taken over while it slept, before it can write", () => {
    const home = freshHome();
    const sleeper = unwrap(claimTurnWatch({ ...CARD, home, nowIso: NOW }));
    const newcomer = claimTurnWatch({ ...CARD, home, nowIso: after({ ms: STALE_MS + 1 }) });
    expect(newcomer.isOk()).toBe(true);
    expect(sleeper.renew({ nowIso: after({ ms: STALE_MS + 2000 }) })).toBe(false);
    expect(sleeper.renew({ nowIso: after({ ms: STALE_MS + 3000 }) })).toBe(false);
  });
});
