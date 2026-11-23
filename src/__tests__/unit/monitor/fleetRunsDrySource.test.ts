/**
 * `readFleetRunsDry` over a REAL readings ledger in a throwaway home and a plain register seam: it judges the newest
 * `machine capacity` reading filed by the judged instant against the register, and reads a missing, ceiling-less,
 * held or undecodable document, one whose ceilings claim an instant after its own ledger row, or an unread register,
 * as unmeasurable.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ok, unwrap } from "../../../lib/result.js";
import { readFleetRunsDry } from "../../../monitor/fleetRunsDrySource.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { DEFAULT_THRESHOLDS, type PlanThresholds } from "../../../plans/thresholds.js";
import type { RegisteredPlan } from "../../../plans/types.js";
import { recordReading } from "../../../readings/store.js";
import { unavailablePlanRegisterPort } from "../../planRegisterFixture.js";

import { DRY_REGISTER, dryReading, NOW, registered } from "./fleetRunsDryFixtures.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A throwaway state home this test may write into — never the ambient one. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-fleet-dry-"));
  homes.push(dir);
  return dir;
}

/** The default bars with Claude's spend-out lowered under 100, so a week read at its whole 100 is proof it is spent. */
const SPEND_OUT_UNDER_WHOLE: PlanThresholds = {
  ...DEFAULT_THRESHOLDS,
  claude: { ...DEFAULT_THRESHOLDS.claude, spendOutAt: 0.98 },
};

/** A register seam answering `plans` under `thresholds` on every read; a write is never made here. */
function registerOf({
  plans,
  thresholds = SPEND_OUT_UNDER_WHOLE,
}: {
  plans: readonly RegisteredPlan[];
  thresholds?: PlanThresholds;
}): PlanRegisterPort {
  const snapshot = {
    diagnostics: [],
    document: { rows: [], version: 1 },
    plans,
    revision: 1,
    source: "registered",
    thresholds,
  } as const;
  return { read: () => Promise.resolve(ok(snapshot)), write: () => Promise.resolve(ok(snapshot)) };
}

/** File one `machine capacity` document, observed and recorded at `atIso`. */
function file({ dir, document, atIso }: { dir: string; document: unknown; atIso: string }): void {
  unwrap(
    recordReading({
      by: "tick-1",
      document: JSON.stringify(document),
      home: dir,
      nowIso: atIso,
      observedAtIso: atIso,
      producer: "machine capacity",
    }),
  );
}

/** Judge `dir` at {@link NOW} against `port`, the dry fixture's own register unless told otherwise. */
function judge({ dir, port = registerOf({ plans: DRY_REGISTER }) }: { dir: string; port?: PlanRegisterPort }) {
  return readFleetRunsDry({ home: dir, nowIso: NOW, port });
}

describe("readFleetRunsDry", () => {
  it("fires on the newest filed reading whose ceilings prove the fleet spent", async () => {
    const dir = home();
    file({ atIso: NOW, dir, document: { ceilings: dryReading(), hold: false } });
    expect((await judge({ dir })).state).toBe("firing");
  });

  it("fires when the tick filed the reading after its ceilings were measured", async () => {
    const dir = home();
    const ceilings = { ...dryReading(), observedAtIso: "2026-11-05T09:59:00.000Z" };
    file({ atIso: NOW, dir, document: { ceilings, hold: false } });
    expect((await judge({ dir })).state).toBe("firing");
  });

  it("is unmeasurable when a stale row's ceilings claim a later, fresh observation", async () => {
    const dir = home();
    file({ atIso: "2026-11-05T07:00:00.000Z", dir, document: { ceilings: dryReading(), hold: false } });
    expect(await judge({ dir })).toEqual({
      because:
        "the newest machine capacity reading's ceilings claim 2026-11-05T10:00:00.000Z, after its ledger row was observed at 2026-11-05T07:00:00.000Z",
      monitorId: "fleet-runs-dry",
      state: "unmeasurable",
    });
  });

  it("is unmeasurable when the register names a plan configured after the reading", async () => {
    const dir = home();
    file({ atIso: NOW, dir, document: { ceilings: dryReading(), hold: false } });
    const port = registerOf({ plans: [...DRY_REGISTER, registered({ alias: "plan-new", provider: "claude" })] });
    expect(await judge({ dir, port })).toEqual({
      because: "the plan register names claude:plan-new, which the filed reading never measured",
      monitorId: "fleet-runs-dry",
      state: "unmeasurable",
    });
  });

  it("never fires on Claude weeks at their whole 100 under the default spend-out bar of 100", async () => {
    const dir = home();
    file({ atIso: NOW, dir, document: { ceilings: dryReading(), hold: false } });
    const port = registerOf({ plans: DRY_REGISTER, thresholds: DEFAULT_THRESHOLDS });
    expect(await judge({ dir, port })).toEqual({
      because:
        "claude:plan-one is refusing with no spent window resetting ahead, so no capacity measure explains it: seven-day at 100%",
      monitorId: "fleet-runs-dry",
      state: "unmeasurable",
    });
  });

  it("is unmeasurable when the plan register cannot be read", async () => {
    const dir = home();
    file({ atIso: NOW, dir, document: { ceilings: dryReading(), hold: false } });
    const reading = await judge({ dir, port: unavailablePlanRegisterPort() });
    expect(reading.state).toBe("unmeasurable");
    expect((reading as { readonly because: string }).because).toContain("the plan register could not be read");
  });

  it("never sees a reading filed after the instant judged", async () => {
    const dir = home();
    file({ atIso: "2026-11-05T10:30:00.000Z", dir, document: { ceilings: dryReading(), hold: false } });
    expect((await judge({ dir })).state).toBe("unmeasurable");
  });

  it("is unmeasurable when no reading was ever filed", async () => {
    const reading = await judge({ dir: home() });
    expect(reading.state).toBe("unmeasurable");
    expect((reading as { readonly because: string }).because).toContain("no machine capacity reading could be read");
  });

  it("is unmeasurable when the newest reading carries no ceilings", async () => {
    const dir = home();
    file({ atIso: NOW, dir, document: { hold: false } });
    expect(await judge({ dir })).toEqual({
      because: "the newest machine capacity reading carries no plans' ceilings",
      monitorId: "fleet-runs-dry",
      state: "unmeasurable",
    });
  });

  it("is unmeasurable when the document holds the machine, whatever its ceiling says", async () => {
    const dir = home();
    file({ atIso: NOW, dir, document: { ceilings: dryReading(), hold: true, holdSubjects: ["cpu"] } });
    expect(await judge({ dir })).toEqual({
      because: "the newest machine capacity reading does not say the machine is unheld: its hold is true",
      monitorId: "fleet-runs-dry",
      state: "unmeasurable",
    });
  });

  it("is unmeasurable when the newest reading's ceilings do not decode", async () => {
    const dir = home();
    file({ atIso: NOW, dir, document: { ceilings: { ...dryReading(), problems: "none" }, hold: false } });
    const reading = await judge({ dir });
    expect(reading.state).toBe("unmeasurable");
    expect((reading as { readonly because: string }).because).toContain(
      "the newest machine capacity reading's ceilings did not decode",
    );
  });
});
