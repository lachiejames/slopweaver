/**
 * `claude seat`'s per-turn usage half: the hold's exit contract, which takes no hatch, the read a limited plan's seat
 * is judged by over a real temporary home, and the cache policy the verdict earns.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../../../claude/contracts.js";
import { recordClaudePlanUsageSnapshot } from "../../../../../claude/planUsageSnapshotStore.js";
import type { ClaudeSeatUsageRefusal, ClaudeSeatUsageVerdict } from "../../../../../claude/seatUsageGate.js";
import { hookBlockLine, seatOutcome, seatUsageOutcome } from "../../../../../cli/commands/claude/seatRun.js";
import {
  judgeSeatUsage,
  type SeatUsageJudgement,
  seatPassCacheFor,
} from "../../../../../cli/commands/claude/seatUsageRead.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const NOW = "2026-11-05T12:00:00.000Z";
const AT_LIMIT: ClaudeSeatUsageRefusal = {
  alias: "plan-one",
  kind: "usage-limit",
  reason: "plan-one: seven_day at 50%, at its usage limit of 50%",
};

describe("seatUsageOutcome", () => {
  it("blocks the hook's prompt with one stdout decision and exits 0", () => {
    const outcome = seatUsageOutcome({
      allowance: { kind: "weekly-window" },
      mode: "hook",
      refusal: AT_LIMIT,
      usageLimitPercent: 50,
    });
    expect(outcome.code).toBe(EXIT_OK);
    expect(outcome.lines).toStrictEqual([]);
    expect(outcome.stdout).toHaveLength(1);
    expect(outcome.stdout[0]).toContain('"decision":"block"');
  });

  it("refuses by hand with exit 1, naming the limit-raising remedy and that there is no hatch", () => {
    const outcome = seatUsageOutcome({
      allowance: { kind: "weekly-window" },
      mode: "hand",
      refusal: AT_LIMIT,
      usageLimitPercent: 50,
    });
    expect(outcome.code).toBe(EXIT_ERROR);
    expect(outcome.stdout).toStrictEqual([]);
    expect(outcome.lines.join("\n")).toContain("--percent 60 --allowance weekly-window");
    expect(outcome.lines.join("\n")).toContain("This hold has no escape hatch");
  });

  it("carries the same hold in the hook decision as by hand", () => {
    const args = { allowance: { kind: "weekly-window" }, refusal: AT_LIMIT, usageLimitPercent: 50 } as const;
    const hand = seatUsageOutcome({ ...args, mode: "hand" });
    expect(seatUsageOutcome({ ...args, mode: "hook" }).stdout).toStrictEqual([
      hookBlockLine({ reason: hand.lines.join("\n") }),
    ]);
  });

  it("is a different renderer from the identity gate's, whose open hatch still passes an off-plan seat", () => {
    const offPlan = { kind: "off-plan", why: "the default login" } as const;
    expect(seatOutcome({ hatchIsOpen: true, mode: "hook", verdict: offPlan }).stdout).toStrictEqual([]);
  });
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-seat-usage-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The verdict of a limited plan's judgement, throwing on an unlimited one exactly as `unwrap` throws on an error. */
function limitedVerdict({ usage }: { usage: SeatUsageJudgement }): ClaudeSeatUsageVerdict {
  if (usage.kind !== "limited") {
    throw new Error("expected a limited plan's judgement");
  }
  return usage.verdict;
}

/** One configured plan. */
function account(over: Partial<ClaudeAccount>): ClaudeAccount {
  return { alias: "plan-one", storeDir: "/Users/someone/.claude-plan-one", ...over };
}

describe("judgeSeatUsage", () => {
  it("reads nothing for a plan with no usage limit, so the pass is today's", () => {
    const usage = judgeSeatUsage({
      accounts: [account({})],
      alias: "plan-one",
      home,
      nowIso: NOW,
    });
    expect(usage).toStrictEqual({ kind: "unlimited" });
    expect(seatPassCacheFor({ usage })).toStrictEqual({ kind: "unlimited" });
  });

  it("holds a limited weekly plan nothing has gauged as NOT MEASURED, and caches nothing", () => {
    const usage = judgeSeatUsage({
      accounts: [account({ usageLimitPercent: 50 })],
      alias: "plan-one",
      home,
      nowIso: NOW,
    });
    expect(usage).toStrictEqual({
      allowance: { kind: "weekly-window" },
      kind: "limited",
      usageLimitPercent: 50,
      verdict: { alias: "plan-one", kind: "not-measured", reason: "plan-one has no usage reading recorded" },
    });
    expect(seatPassCacheFor({ usage })).toStrictEqual({ kind: "uncacheable" });
  });

  it("passes a limited weekly plan its recorded reading puts under the limit, cached until the reading ages out", () => {
    recordClaudePlanUsageSnapshot({
      gauge: {
        alias: "plan-one",
        observedAtIso: "2026-11-05T11:50:00.000Z",
        sevenDay: { resetAtIso: "2026-11-08T12:00:00.000Z", status: "allowed", utilization: 0.2 },
      },
      home,
      now: () => NOW,
    });
    const usage = judgeSeatUsage({
      accounts: [account({ usageLimitPercent: 50 })],
      alias: "plan-one",
      home,
      nowIso: NOW,
    });
    expect(seatPassCacheFor({ usage })).toStrictEqual({
      alias: "plan-one",
      kind: "limited-weekly",
      validFromEpochSeconds: Math.floor(Date.parse(NOW) / 1000),
      validUntilEpochSeconds: Math.floor(Date.parse("2026-11-05T12:50:00.000Z") / 1000),
    });
  });

  it("holds a limited weekly plan whose recorded snapshot does not decode as NOT MEASURED, never open", () => {
    const dir = stateHomePaths({ home }).live.claudeUsageSnapshotsDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan-one.json"), "{not json");
    const usage = judgeSeatUsage({
      accounts: [account({ usageLimitPercent: 50 })],
      alias: "plan-one",
      home,
      nowIso: NOW,
    });
    expect(limitedVerdict({ usage }).kind).toBe("not-measured");
  });

  it("holds a limited monthly-spend plan with no spend reading as NOT MEASURED", () => {
    const usage = judgeSeatUsage({
      accounts: [account({ allowance: { kind: "monthly-spend" }, usageLimitPercent: 50 })],
      alias: "plan-one",
      home,
      nowIso: NOW,
    });
    expect(limitedVerdict({ usage }).kind).toBe("not-measured");
    expect(seatPassCacheFor({ usage })).toStrictEqual({ kind: "uncacheable" });
  });
});
