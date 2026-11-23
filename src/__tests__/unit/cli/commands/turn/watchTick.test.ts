/**
 * `watchTick` — one ticker write, over a real temp home and a plain fake card writer (a seam, not a mock).
 * A blocked ask keeps the hourglass `turn block` wrote; any other ask gets its card rewritten and the write
 * recorded at the tick's own instant, which is the instant the caller's reap judges.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LiveChecklistUpdatePlan } from "../../../../../cli/commands/turn/sweepCard.js";
import { watchTick } from "../../../../../cli/commands/turn/watchTick.js";
import { readProgressLog } from "../../../../../live/turn/progressLog.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const ASK = { channel: "C1", messageTs: "1789788122.066099", threadTs: "1789788122.066099" };
const NOW = "2026-09-19T03:45:00.000Z";

/** A watch over a fresh home whose card writer records every plan it is handed, or throws when told to. */
function watchOver({ fail }: { fail: boolean }): {
  plans: LiveChecklistUpdatePlan[];
  watch: Parameters<typeof watchTick>[0]["watch"];
} {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-watch-tick-"));
  dirs.push(home);
  const plans: LiveChecklistUpdatePlan[] = [];
  const advanceWorking = async (plan: LiveChecklistUpdatePlan): Promise<void> => {
    if (fail) {
      throw new Error("ratelimited");
    }
    plans.push(plan);
  };
  return {
    plans,
    watch: {
      advancer: { advanceWorking },
      askIdentity: ASK,
      home,
      question: "yo",
      sessionId: "no-such-session",
      workerCwd: home,
      workingTs: "1789788130.088049",
    },
  };
}

describe("watchTick", () => {
  it("writes nothing over a turn blocked on the owner", async () => {
    const { plans, watch } = watchOver({ fail: false });
    const tick = await watchTick({ blockedOnHuman: true, nowIso: NOW, watch });
    expect(tick.line).toBe("blocked on the owner — the card keeps its hourglass");
    expect(plans).toEqual([]);
    expect(readProgressLog({ askIdentity: ASK, home: watch.home }).writes).toEqual([]);
  });

  it("rewrites a running card with the clock and records the write at the tick's instant", async () => {
    const { plans, watch } = watchOver({ fail: false });
    const tick = await watchTick({ blockedOnHuman: false, nowIso: NOW, watch });
    expect(tick).toEqual({ latestActivityIso: undefined, line: "now: still working, 22m", ok: true });
    expect(plans.length).toBe(1);
    expect(plans[0]!.posted).toEqual({ channel: "C1", ts: "1789788130.088049" });
    expect(readProgressLog({ askIdentity: ASK, home: watch.home }).writes.map((w) => w.tsIso)).toEqual([NOW]);
  });

  it("reports a failed write, records none, and withholds the instant a reap would judge", async () => {
    const { watch } = watchOver({ fail: true });
    const tick = await watchTick({ blockedOnHuman: false, nowIso: NOW, watch });
    expect(tick).toEqual({
      latestActivityIso: undefined,
      line: "could not advance the card — ratelimited",
      ok: false,
    });
    expect(readProgressLog({ askIdentity: ASK, home: watch.home }).writes).toEqual([]);
  });
});
