/**
 * The one reader every gate now shares (`src/codex/quotaNow.ts`), over REAL temp fixtures — a Codex home
 * carrying a rollout line, and a state home carrying the cached record. Not a restatement of `quotaGate`'s
 * pure decision: what these assert is that a spend cap written where Codex really writes one reaches the
 * decision `codex status --check`, `github enqueue` and `cmux spawn --driver codex` all read.
 *
 * The defect behind it: `codex quota show` said `usage-limit`, observed 09:27:23.357Z, while
 * `codex status --check` on the same machine printed `no planning pass has run` and named no cap at all,
 * because it read a different set of files — the pass records — and no gate read this one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import { writeCodexQuotaCache, writeCodexQuotaClearMark } from "../../../codex/quotaCache.js";
import { capEvidence, currentCodexQuotaDecision, decideCurrentCodexQuota } from "../../../codex/quotaNow.js";
import { unreadableLive } from "../../codexLiveFake.js";
import { REAL_HEALTHY_NO_CREDITS_LINE, REAL_SPEND_CAP_TASK_COMPLETE_LINE } from "../../codexRolloutLines.js";

const NOW = "2026-09-14T10:00:00.000Z";

/** The destination under test — the alias keys the cache, the Codex home carries its rollout log. */
const ALIAS = "codex-one";

/** The live read that did not happen — every case here predates it and must decide exactly as before. */
const NO_LIVE = unreadableLive({ codexHome: "/stores/unread", readAtIso: NOW });

const tempDirs: string[] = [];

/** A throwaway directory that this file removes after every test. */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** A Codex home whose newest rollout file carries `lines`, written where Codex really writes them. */
function codexHomeWith({ lines }: { lines: readonly string[] }): string {
  const codexHome = tempDir({ prefix: "quota-now-codex-" });
  const dayDir = join(codexHome, "sessions", "2026", "09", "14");
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(join(dayDir, "rollout-spend-cap.jsonl"), `${lines.join("\n")}\n`, "utf8");
  return codexHome;
}

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("currentCodexQuotaDecision", () => {
  it("refuses on a workspace SPEND CAP Codex wrote to its own rollout log, with nothing cached", () => {
    const decision = currentCodexQuotaDecision({
      alias: ALIAS,
      codexHome: codexHomeWith({ lines: [REAL_SPEND_CAP_TASK_COMPLETE_LINE] }),
      home: tempDir({ prefix: "quota-now-home-" }),
      live: NO_LIVE,
      nowIso: NOW,
    });

    expect(decision.refuse).toBe(true);
    expect(capEvidence({ decision })!.kind).toBe("usage-limit");
    expect(capEvidence({ decision })!.observedAtIso).toBe("2026-09-11T07:31:24.321Z");
  });

  it("allows when the rollout log carries only a healthy reading and nothing is cached", () => {
    const decision = currentCodexQuotaDecision({
      alias: ALIAS,
      codexHome: codexHomeWith({ lines: [REAL_HEALTHY_NO_CREDITS_LINE] }),
      home: tempDir({ prefix: "quota-now-home-" }),
      live: NO_LIVE,
      nowIso: NOW,
    });

    expect(decision.refuse).toBe(false);
    expect(capEvidence({ decision })).toBe(undefined);
  });

  it("refuses on the CACHED record when Codex's own log has nothing to say", () => {
    const home = tempDir({ prefix: "quota-now-home-" });
    writeCodexQuotaCache({
      alias: ALIAS,
      evidence: { kind: "credits-out", observedAtIso: "2026-09-14T08:00:00.000Z" },
      home,
    });

    const decision = currentCodexQuotaDecision({
      alias: ALIAS,
      codexHome: tempDir({ prefix: "quota-now-codex-" }),
      home,
      live: NO_LIVE,
      nowIso: NOW,
    });

    expect(decision.refuse).toBe(true);
    expect(capEvidence({ decision })!.kind).toBe("credits-out");
  });

  it("does not refuse a DIFFERENT destination on a cap cached against this one", () => {
    const home = tempDir({ prefix: "quota-now-home-" });
    const codexHome = tempDir({ prefix: "quota-now-codex-" });
    writeCodexQuotaCache({
      alias: ALIAS,
      evidence: { kind: "credits-out", observedAtIso: "2026-09-14T08:00:00.000Z" },
      home,
    });

    // The same home and the same (silent) rollout log: the alias is the ONLY thing that differs, so a pass
    // here is evidence the cache is per-destination rather than per-machine.
    expect(currentCodexQuotaDecision({ alias: ALIAS, codexHome, home, live: NO_LIVE, nowIso: NOW }).refuse).toBe(true);
    expect(currentCodexQuotaDecision({ alias: "codex-two", codexHome, home, live: NO_LIVE, nowIso: NOW }).refuse).toBe(
      false,
    );
  });

  it("allows when neither source has anything — an absent Codex home is not evidence of a cap", () => {
    const decision = currentCodexQuotaDecision({
      alias: ALIAS,
      codexHome: join(tempDir({ prefix: "quota-now-codex-" }), "never-created"),
      home: tempDir({ prefix: "quota-now-home-" }),
      live: NO_LIVE,
      nowIso: NOW,
    });

    expect(decision.refuse).toBe(false);
  });
});

describe("decideCurrentCodexQuota", () => {
  // A reset the owner made: a week-old 100% reading of the codex window, with a reset still in
  // the future, kept refusing although the account read 0% live.
  const staleCodexCap = {
    kind: "window-limit" as const,
    limitId: "codex",
    observedAtIso: "2026-09-12T09:00:00.000Z",
    resetAtIso: "2026-09-17T09:00:00.000Z",
    windowMinutes: 10080,
  };
  const liveHealthy: CodexAccountLive = {
    accountId: "acct-1",
    codexHome: "/stores/one",
    email: "someone@example.com",
    gauges: [
      {
        credits: undefined,
        limitId: "codex",
        observedAtIso: NOW,
        planType: "pro",
        reached: undefined,
        reachedType: undefined,
        windows: [
          {
            label: "weekly",
            resetAtIso: "2026-09-21T09:00:00.000Z",
            slot: "primary",
            usedPercent: 0,
            windowMinutes: 10080,
          },
        ],
      },
    ],
    kind: "signed-in",
    ordinaryUsageAllowed: undefined,
    planType: "pro",
    readAtIso: NOW,
    resetCreditsAvailable: 0,
  };

  it("refuses on a stale codex-window cap when no live read happened", () => {
    expect(
      decideCurrentCodexQuota({
        cached: staleCodexCap,
        clearedAtIso: undefined,
        live: NO_LIVE,
        nowIso: NOW,
        rolloutEvidence: undefined,
        rolloutObservations: [],
      }).refuse,
    ).toBe(true);
  });

  it("keeps refusing when the live codex bucket measured no window at all — absence is not health", () => {
    const liveEmptyBucket: CodexAccountLive = { ...liveHealthy, gauges: [{ ...liveHealthy.gauges[0]!, windows: [] }] };
    expect(
      decideCurrentCodexQuota({
        cached: undefined,
        clearedAtIso: undefined,
        live: liveEmptyBucket,
        nowIso: NOW,
        rolloutEvidence: staleCodexCap,
        rolloutObservations: [],
      }).refuse,
    ).toBe(true);
  });

  it("clears that cap on a strictly later live reading of the same window", () => {
    expect(
      decideCurrentCodexQuota({
        cached: undefined,
        clearedAtIso: undefined,
        live: liveHealthy,
        nowIso: NOW,
        rolloutEvidence: staleCodexCap,
        rolloutObservations: [],
      }),
    ).toEqual({ refuse: false });
  });

  it("refuses when the live read itself says ordinary usage is not allowed", () => {
    const decision = decideCurrentCodexQuota({
      cached: undefined,
      clearedAtIso: undefined,
      live: { ...liveHealthy, ordinaryUsageAllowed: false },
      nowIso: NOW,
      rolloutEvidence: undefined,
      rolloutObservations: [],
    });
    expect(capEvidence({ decision })).toEqual({ kind: "usage-limit", observedAtIso: NOW });
  });

  it("still refuses on the live read's own unscoped usage-limit after a clear — the mark never filters live evidence", () => {
    const decision = decideCurrentCodexQuota({
      cached: undefined,
      clearedAtIso: NOW,
      live: { ...liveHealthy, ordinaryUsageAllowed: false },
      nowIso: NOW,
      rolloutEvidence: undefined,
      rolloutObservations: [],
    });
    expect(capEvidence({ decision })).toEqual({ kind: "usage-limit", observedAtIso: NOW });
  });

  // The defect this row was opened for: an UNSCOPED spend cap in Codex's own rollout log (a `task_complete`,
  // no `limit_id`) kept a destination refusing — so out of routing — while its live read showed 0% weekly use,
  // and `codex quota clear` deleted no cache and cleared nothing.
  describe("an unscoped rollout-log spend cap beside a healthy live read", () => {
    /** The real spend-cap line, re-dated so a case can put a cap AFTER the clear. */
    const spendCapAt = ({ iso }: { iso: string }): string =>
      REAL_SPEND_CAP_TASK_COMPLETE_LINE.replace("2026-09-11T07:31:24.321Z", iso);

    it("refuses with no clear mark, although the live codex window reads 0%", () => {
      const decision = currentCodexQuotaDecision({
        alias: ALIAS,
        codexHome: codexHomeWith({ lines: [REAL_SPEND_CAP_TASK_COMPLETE_LINE] }),
        home: tempDir({ prefix: "quota-now-home-" }),
        live: liveHealthy,
        nowIso: NOW,
      });
      expect(capEvidence({ decision })).toEqual({ kind: "usage-limit", observedAtIso: "2026-09-11T07:31:24.321Z" });
    });

    it("allows once `codex quota clear` has recorded a mark strictly after the cap", () => {
      const home = tempDir({ prefix: "quota-now-home-" });
      writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "2026-09-14T09:00:00.000Z", home });
      const decision = currentCodexQuotaDecision({
        alias: ALIAS,
        codexHome: codexHomeWith({ lines: [REAL_SPEND_CAP_TASK_COMPLETE_LINE] }),
        home,
        live: liveHealthy,
        nowIso: NOW,
      });
      expect(decision).toEqual({ refuse: false });
    });

    it("refuses again on a spend cap observed AFTER the mark", () => {
      const home = tempDir({ prefix: "quota-now-home-" });
      writeCodexQuotaClearMark({ alias: ALIAS, clearedAtIso: "2026-09-14T09:00:00.000Z", home });
      const decision = currentCodexQuotaDecision({
        alias: ALIAS,
        codexHome: codexHomeWith({ lines: [spendCapAt({ iso: "2026-09-14T09:30:00.000Z" })] }),
        home,
        live: liveHealthy,
        nowIso: NOW,
      });
      expect(capEvidence({ decision })).toEqual({ kind: "usage-limit", observedAtIso: "2026-09-14T09:30:00.000Z" });
    });

    it("keeps refusing on a mark for a DIFFERENT destination", () => {
      const home = tempDir({ prefix: "quota-now-home-" });
      writeCodexQuotaClearMark({ alias: "codex-two", clearedAtIso: "2026-09-14T09:00:00.000Z", home });
      const decision = currentCodexQuotaDecision({
        alias: ALIAS,
        codexHome: codexHomeWith({ lines: [REAL_SPEND_CAP_TASK_COMPLETE_LINE] }),
        home,
        live: liveHealthy,
        nowIso: NOW,
      });
      expect(decision.refuse).toBe(true);
    });
  });
});
