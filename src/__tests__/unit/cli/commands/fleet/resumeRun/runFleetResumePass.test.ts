/**
 * The recovery pass entry point, driven only to the refusals that return before the console or cmux is touched:
 * another live pass holding the lock, a journal the pass cannot read, one that will not take the start, and a store
 * that cannot be reached. No case here gets past opening the attempt — the lock-held case takes the lock itself
 * first, in this live process, so the pass can never be let through to the console step.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runFleetResumePass } from "../../../../../../cli/commands/fleet/resumeRun.js";
import { FleetErrors } from "../../../../../../fleet/errors.js";
import { acquireFleetLock } from "../../../../../../fleet/locks.js";
import type { FleetPort } from "../../../../../../fleet/port.js";
import { err, unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { memoryFleetPort, unavailableFleetPort } from "../../../../../fleetStoreFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../../planRegisterFixture.js";
import { fakeClient, makeHome } from "../fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The request a pass is given for the throwaway home. */
function requestFor(): { home: string; episodeId: string; bootPaceSeconds: number; reorientSeconds: number } {
  return { bootPaceSeconds: 1, episodeId: "ep-1", home, reorientSeconds: 1 };
}

/** Whether the recovery lock is free now — taking it proves so, and it is released again at once. */
function lockFree(): boolean {
  const taken = acquireFleetLock({ home, nowIso: "2026-10-04T06:00:00.000Z" });
  if (taken.isOk()) {
    taken.value.release();
  }
  return taken.isOk();
}

describe("runFleetResumePass", () => {
  it("refuses to start while a live pass holds the lock, naming its pid, and journals nothing", async () => {
    const fleet = memoryFleetPort();
    const held = unwrap(acquireFleetLock({ home, nowIso: "2026-10-04T05:00:00.000Z" }));
    const message = unwrapErr(
      await runFleetResumePass({
        client: fakeClient({}),
        fleet,
        port: memoryPlanRegisterPort(),
        request: requestFor(),
      }),
    );
    expect(message).toContain("the recovery lock was not free, so this pass touched nothing");
    expect(message).toContain(`held by pid ${String(process.pid)}`);
    expect(unwrap(await fleet.readResumeJournal({ home })).events).toEqual([]);
    held.release();
  });

  // The legacy file is imported once, on the first read, and a damaged one is refused rather than skipped: the pass
  // stops, naming the file, with nothing journalled.
  it("refuses to start on a legacy journal the import cannot read, and releases the lock it took", async () => {
    mkdirSync(join(home, "fleet", "resume.jsonl"), { recursive: true });
    const message = unwrapErr(
      await runFleetResumePass({
        client: fakeClient({}),
        fleet: memoryFleetPort(),
        port: memoryPlanRegisterPort(),
        request: requestFor(),
      }),
    );
    expect(message).toContain(join(home, "fleet", "resume.jsonl"));
    expect(lockFree()).toBe(true);
  });

  it("refuses to start when the journal will not take its start, touching nothing and releasing the lock", async () => {
    const outage = FleetErrors.storeUnavailable({ doing: "take a write", reason: "a fixture refusal on append" });
    const fleet: FleetPort = { ...memoryFleetPort(), appendResumeEvent: () => Promise.resolve(err(outage)) };
    const message = unwrapErr(
      await runFleetResumePass({
        client: fakeClient({}),
        fleet,
        port: memoryPlanRegisterPort(),
        request: requestFor(),
      }),
    );
    expect(message).toContain("the recovery journal would not take this attempt's start, so nothing was touched");
    expect(message).toContain("a fixture refusal on append");
    expect(lockFree()).toBe(true);
  });

  // The outage is a typed refusal: no file stands in for the store, and nothing is touched or journalled.
  it("refuses to start when the store cannot be reached, naming the store and releasing the lock", async () => {
    const sent: string[] = [];
    const message = unwrapErr(
      await runFleetResumePass({
        client: fakeClient({ sent }),
        fleet: unavailableFleetPort(),
        port: memoryPlanRegisterPort(),
        request: requestFor(),
      }),
    );
    expect(message).toContain(
      "the fleet's configuration and journals live in the store, and the store could not be opened",
    );
    expect(message).toContain("ECONNREFUSED");
    expect(sent).toEqual([]);
    expect(existsSync(join(home, "fleet"))).toBe(false);
    expect(lockFree()).toBe(true);
  });

  // The refusal lands before `resumeConsole`, so this case cannot start a real console: an outage stops the pass
  // with the reason journalled, nothing typed into any tab and no seat event written.
  it("refuses the whole pass when the plan register's store is unreachable, touching no seat", async () => {
    const sent: string[] = [];
    const fleet = memoryFleetPort();
    const completion = unwrap(
      await runFleetResumePass({
        client: fakeClient({ sent }),
        fleet,
        port: unavailablePlanRegisterPort(),
        request: requestFor(),
      }),
    );
    expect(completion.result.refusals.map((refusal) => refusal.code)).toEqual(["STORE_REFUSED"]);
    expect(completion.result.refusals[0]!.message).toContain("no seat was touched");
    expect(completion.result.refusals[0]!.message).toContain("ECONNREFUSED");
    expect(sent).toEqual([]);
    const kinds = unwrap(await fleet.readResumeJournal({ home })).events.map((event) => event.kind);
    expect(kinds.includes("seat")).toBe(false);
    expect(kinds.at(-1)).toBe("attempt-finished");
    expect(lockFree()).toBe(true);
  });
});
