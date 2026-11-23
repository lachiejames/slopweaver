/**
 * `handover wake`'s finish pass across runs: a capped run asks parks never asked before
 * ahead of the ones whose finish keeps refusing, and the boot window is read only once every finish has ended.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WAKE_FINISH_ASKS } from "../../../../../../cli/commands/handover/wakeFinish.js";
import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { EXIT_DEFERRED, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { NOW, record } from "./fixtures.js";
import { fakes, journalPath, mintWakeHome, parkedRow, wakeJson } from "./harness.js";

/** Seven merged parks, `m0` parked first; none of their finishes closes the run. */
function sevenRefusingMergedParks(): {
  readonly slugs: readonly string[];
  readonly checks: Record<number, { prState: "MERGED" }>;
} {
  const slugs = Array.from({ length: WAKE_FINISH_ASKS + 1 }, (_, index) => `m${String(index)}`);
  const checks: Record<number, { prState: "MERGED" }> = {};
  slugs.forEach((slug, index) => {
    const minute = String(10 + index).padStart(2, "0");
    parkedRow({
      parkedAtIso: `2026-10-15T02:${minute}:00.000Z`,
      slug,
      wake: { kind: "checks", number: index + 1, repo: "o/r" },
    });
    checks[index + 1] = { prState: "MERGED" };
  });
  return { checks, slugs };
}

describe("handover wake's finish pass", () => {
  let home: string;

  beforeEach(() => {
    ({ home } = mintWakeHome());
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("asks a park never asked before ahead of the ones that refused last run, with no boot to spare", async () => {
    const { checks, slugs } = sevenRefusingMergedParks();
    const first = record();
    const firstRun = await wakeJson({ deps: fakes({ bootsInFlight: 3, checks, recorded: first }), recorded: first });
    const second = record();
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const deps: HandoverWakeDeps = { ...fakes({ bootsInFlight: 3, checks, recorded: second }), now: () => later };
    const secondRun = await wakeJson({ deps, recorded: second });
    expect([firstRun.code, first.finished, first.spawned]).toEqual([EXIT_DEFERRED, slugs.slice(0, 6), []]);
    expect([secondRun.code, second.finished, second.spawned]).toEqual([
      EXIT_DEFERRED,
      ["m6", "m0", "m1", "m2", "m3", "m4"],
      [],
    ]);
  });

  it("records each read and ask in the turn snapshot, never the wake journal", async () => {
    parkedRow({ slug: "landed", wake: { kind: "checks", number: 7, repo: "o/r" } });
    const recorded = record();
    await wakeJson({ deps: fakes({ bootsInFlight: 3, checks: { 7: { prState: "MERGED" } }, recorded }), recorded });
    const at = NOW.toISOString();
    expect(JSON.parse(readFileSync(stateHomePaths({ home }).handoverWakeTurnsJson, "utf8"))).toEqual({
      turns: { "landed:2:2026-10-15T02:00:00.000Z": { askedAtIso: at, readAtIso: at } },
      version: 1,
    });
    expect(() => readFileSync(journalPath(), "utf8")).toThrow("ENOENT");
  });

  it("records nothing on a dry run", async () => {
    parkedRow({ slug: "landed", wake: { kind: "checks", number: 7, repo: "o/r" } });
    const recorded = record();
    const deps = fakes({ checks: { 7: { prState: "MERGED" } }, finishes: { landed: 0 }, recorded });
    await wakeJson({ deps, extra: ["--dry-run"], recorded });
    expect(() => readFileSync(stateHomePaths({ home }).handoverWakeTurnsJson, "utf8")).toThrow("ENOENT");
  });

  it("recovers from a torn snapshot in one run: says so, asks oldest first, and rewrites it whole", async () => {
    const { checks } = sevenRefusingMergedParks();
    const path = stateHomePaths({ home }).handoverWakeTurnsJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"turns":{"m0:2:2026-10-15T02:10');
    const first = record();
    await wakeJson({ deps: fakes({ bootsInFlight: 3, checks, recorded: first }), recorded: first });
    const second = record();
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const deps: HandoverWakeDeps = { ...fakes({ bootsInFlight: 3, checks, recorded: second }), now: () => later };
    await wakeJson({ deps, recorded: second });
    expect(first.diagnostics.filter((line) => line.includes("are not JSON"))).toHaveLength(1);
    expect([first.finished, second.finished, second.diagnostics]).toEqual([
      ["m0", "m1", "m2", "m3", "m4", "m5"],
      ["m6", "m0", "m1", "m2", "m3", "m4"],
      [],
    ]);
  });

  it("reads the boot window only after every finish has ended", async () => {
    parkedRow({ slug: "refused", wake: { kind: "checks", number: 7, repo: "o/r" } });
    const recorded = record();
    const base = fakes({ checks: { 7: { prState: "MERGED" } }, recorded });
    const order: string[] = [];
    const deps: HandoverWakeDeps = {
      ...base,
      bootsInFlight: (args) => {
        order.push("boots");
        return base.bootsInFlight(args);
      },
      finish: async (args) => {
        order.push("finish");
        return base.finish(args);
      },
    };
    const { code } = await wakeJson({ deps, recorded });
    expect([code, order, recorded.spawned]).toEqual([EXIT_OK, ["finish", "boots"], ["refused"]]);
  });
});
