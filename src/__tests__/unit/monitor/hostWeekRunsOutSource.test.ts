/**
 * `readHostWeekRunsOut` over a REAL readings ledger in a throwaway home and a plain register seam: a Codex draw
 * filed across a day projects the plans out before their resets and fires, an unread register or no reading is
 * unmeasurable.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Ceiling } from "../../../capacity/ceilings.js";
import { ok, unwrap } from "../../../lib/result.js";
import { readHostWeekRunsOut } from "../../../monitor/hostWeekRunsOutSource.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { RegisteredPlan } from "../../../plans/types.js";
import { recordReading } from "../../../readings/store.js";
import { unavailablePlanRegisterPort } from "../../planRegisterFixture.js";

import { OPEN_MACHINE, readingOf, registered } from "./fleetRunsDryFixtures.js";

const NOW = "2026-11-08T12:00:00.000Z";
const HOUR_MS = 3_600_000;
const STEP_PREFIX = "mon-planweek-";
const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A throwaway state home this test may write into — never the ambient one. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-plan-week-"));
  homes.push(dir);
  return dir;
}

/** An instant `hours` from {@link NOW}. */
function at({ hours }: { hours: number }): string {
  return new Date(Date.parse(NOW) + hours * HOUR_MS).toISOString();
}

const CODEX_ONLY: readonly RegisteredPlan[] = [
  registered({ alias: "codex-one", provider: "codex" }),
  registered({ alias: "codex-two", provider: "codex" }),
];

/** A register seam answering `plans` under the default bars (Codex pauses at 99). */
function registerOf({ plans }: { plans: readonly RegisteredPlan[] }): PlanRegisterPort {
  const snapshot = {
    diagnostics: [],
    document: { rows: [], version: 1 },
    plans,
    revision: 1,
    source: "registered",
    thresholds: { ...DEFAULT_THRESHOLDS, codex: { alertAtPercent: 90, pauseAtPercent: 99 } },
  } as const;
  return { read: () => Promise.resolve(ok(snapshot)), write: () => Promise.resolve(ok(snapshot)) };
}

/** A Codex plan's ceiling at `used`, holding no free reset. */
function codex({ alias, resetHours, used }: { alias: string; resetHours: number; used: number }): Ceiling {
  return {
    account: `${alias} (acme)`,
    freeResets: 0,
    headroom: (99 - used) / 100,
    id: `codex:${alias}`,
    kind: "codex",
    reason: null,
    status: "open",
    windows: [{ available: 100, resetAtIso: at({ hours: resetHours }), used, window: "weekly" }],
  };
}

/** File one unheld `machine capacity` document with both plans at `used`, observed `hours` from now. */
function file({ dir, hours, used }: { dir: string; hours: number; used: number }): void {
  const ceilings = readingOf({
    ceilings: [
      OPEN_MACHINE,
      codex({ alias: "codex-one", resetHours: 30, used }),
      codex({ alias: "codex-two", resetHours: 40, used }),
    ],
    observedAtIso: at({ hours }),
  });
  unwrap(
    recordReading({
      by: "tick-1",
      document: JSON.stringify({ ceilings, hold: false }),
      home: dir,
      nowIso: at({ hours }),
      observedAtIso: at({ hours }),
      producer: "machine capacity",
    }),
  );
}

describe("readHostWeekRunsOut", () => {
  it("fires on the Codex plans when a day's filed draw runs them both out before either reset", async () => {
    const dir = home();
    file({ dir, hours: -30, used: 30 });
    file({ dir, hours: 0, used: 90 });
    const reading = await readHostWeekRunsOut({
      home: dir,
      nowIso: NOW,
      port: registerOf({ plans: CODEX_ONLY }),
      stepPrefix: STEP_PREFIX,
    });
    expect(reading.state).toBe("firing");
    const firing = reading as Extract<typeof reading, { state: "firing" }>;
    expect(firing.subjects.map((subject) => subject.id)).toEqual(["the Codex plans' week"]);
  });

  it("is clear when the filed draw is light enough that the resets come first, carrying the maths it read", async () => {
    const dir = home();
    file({ dir, hours: -30, used: 89 });
    file({ dir, hours: 0, used: 90 });
    await expect(
      readHostWeekRunsOut({
        home: dir,
        nowIso: NOW,
        port: registerOf({ plans: CODEX_ONLY }),
        stepPrefix: STEP_PREFIX,
      }),
    ).resolves.toEqual({
      evidence: [
        "Codex, projected at 90% of the trailing draw: 0.01 plan-weeks/day (trailing 0.02 plan-weeks/day, over 30h of capacity readings), 0.10 plan-weeks over the next 7 days, 0.00 of them unmet; 0 free reset(s) the chair may claim, 0 claimed; 0.16 plan-weeks left unspent at the current resets",
        "codex-one: 90% used of a 99% ceiling, 9% of a week left before its 2026-11-09T18:00Z reset; the routed draw takes it to 92% by then, 7% unspent; 0 free reset(s) held, 0 claimed in the projection",
        "codex-two: 90% used of a 99% ceiling, 9% of a week left before its 2026-11-10T04:00Z reset; the routed draw takes it to 91% by then, 8% unspent; 0 free reset(s) held, 0 claimed in the projection",
      ],
      monitorId: "host-week-runs-out",
      state: "clear",
    });
  });

  it("reads the week unmeasurable, never firing, when an earlier filed reading does not decode", async () => {
    const dir = home();
    unwrap(
      recordReading({
        by: "tick-1",
        document: JSON.stringify({ ceilings: { garbled: true }, hold: false }),
        home: dir,
        nowIso: at({ hours: -54 }),
        observedAtIso: at({ hours: -54 }),
        producer: "machine capacity",
      }),
    );
    file({ dir, hours: -30, used: 30 });
    file({ dir, hours: 0, used: 90 });
    const reading = await readHostWeekRunsOut({
      home: dir,
      nowIso: NOW,
      port: registerOf({ plans: CODEX_ONLY }),
      stepPrefix: STEP_PREFIX,
    });
    expect(reading.state).toBe("unmeasurable");
    const unmeasured = reading as Extract<typeof reading, { state: "unmeasurable" }>;
    expect(unmeasured.because).toContain("a capacity reading in the trailing week does not decode");
  });

  it("is unmeasurable with no filed reading, and with an unread register", async () => {
    const dir = home();
    const none = await readHostWeekRunsOut({
      home: dir,
      nowIso: NOW,
      port: registerOf({ plans: CODEX_ONLY }),
      stepPrefix: STEP_PREFIX,
    });
    expect(none.state).toBe("unmeasurable");
    const unread = await readHostWeekRunsOut({
      home: dir,
      nowIso: NOW,
      port: unavailablePlanRegisterPort(),
      stepPrefix: STEP_PREFIX,
    });
    expect(unread.state).toBe("unmeasurable");
  });
});
