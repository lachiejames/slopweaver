/**
 * `session close-done`'s keep-alive arm on one seat, and its per-row act, called directly: what the verdict answers
 * and what it records on the sweep. The whole sweep over the same chair is `./closeDoneKeepAlive.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { sweepItem } from "../../../../../cli/commands/session/closeDoneCandidate.js";
import { type KeepAliveSweep, keepAliveSeatVerdict } from "../../../../../cli/commands/session/closeDoneKeepAlive.js";
import { ok } from "../../../../../lib/result.js";
import type { CloseDonePlanItem } from "../../../../../sessions/closeDone.js";
import {
  BARE_KEEP_ALIVE,
  bashToolArgv,
  CHAIR_TREE,
  CHAIR_WATCH_ONLY,
  COVERED,
  claudeRow,
  ONE_SHELL,
  SUCCESSOR_QUEUED,
  shellRow,
} from "../../../sessions/keepAliveChairFixture.js";
import { fakeClient } from "./closeDoneFakeCmux.js";
import { deps, home, removeFixtureDirs, workspace } from "./closeDoneHarness.js";

afterEach(removeFixtureDirs);

/** Chair 366 retired: unpinned, still titled as the supervisor. */
const CHAIR = workspace({ title: "/slopweaver:supervisor", workspaceId: "id-366", workspaceRef: "workspace:366" });

/** A fresh sweep record, nothing retired yet. */
function freshSweep(): KeepAliveSweep {
  return { blind: false, retiring: new Set() };
}

describe("keepAliveSeatVerdict", () => {
  it("forces the covered chair and records every pid it held as retiring", async () => {
    const fixture = home();
    const fake = fakeClient({ trees: { "id-366": [CHAIR_TREE] }, workspaces: [CHAIR] });
    const sweep = freshSweep();

    const verdict = await keepAliveSeatVerdict({
      deps: deps({ client: fake.client, fixture, processes: COVERED }),
      screen: ONE_SHELL,
      sweep,
      workspace: CHAIR,
    });

    expect(verdict).toEqual({
      kind: "force",
      note: "its keep-alive (pid 85912) retires with it; pid 67939 keeps the stores alive",
    });
    expect([...sweep.retiring].toSorted((a, b) => a - b)).toEqual([42315, 44500, 84990, 84992, 85912]);
  });

  it("holds the covered chair once the sweep is blind, recording nothing", async () => {
    const fixture = home();
    const fake = fakeClient({ trees: { "id-366": [CHAIR_TREE] }, workspaces: [CHAIR] });
    const sweep: KeepAliveSweep = { blind: true, retiring: new Set() };

    const verdict = await keepAliveSeatVerdict({
      deps: deps({ client: fake.client, fixture, processes: COVERED }),
      screen: ONE_SHELL,
      sweep,
      workspace: CHAIR,
    });

    expect(verdict).toEqual({
      kind: "held",
      note: "a retired chair this sweep closed did not show its processes, so its keep-alive is unknown; the next tick closes this one",
    });
    expect(sweep.retiring.size).toBe(0);
  });

  it("answers not-keep-alive for the pinned chair, which is the live one", async () => {
    const fixture = home();
    const pinned = { ...CHAIR, pinned: true };
    const fake = fakeClient({ trees: { "id-366": [CHAIR_TREE] }, workspaces: [pinned] });

    const verdict = await keepAliveSeatVerdict({
      deps: deps({ client: fake.client, fixture, processes: COVERED }),
      screen: ONE_SHELL,
      sweep: freshSweep(),
      workspace: pinned,
    });

    expect(verdict).toEqual({ kind: "not-keep-alive" });
  });

  // Every held reason once collapsed to `not-keep-alive` bar two, so 50 chairs printed a bare
  // `screen busy` while each failed on its shell command.
  it("holds a retired chair whose keep-alive shell runs other work with that reason as its note", async () => {
    const fixture = home();
    const fake = fakeClient({ trees: { "id-366": [CHAIR_TREE] }, workspaces: [CHAIR] });
    const processes = ok([
      claudeRow({ pid: 42315 }),
      shellRow({ argv: bashToolArgv({ command: `${BARE_KEEP_ALIVE}; sleep 600` }), pid: 84990 }),
      ...CHAIR_WATCH_ONLY,
      ...SUCCESSOR_QUEUED,
    ]);

    const verdict = await keepAliveSeatVerdict({
      deps: deps({ client: fake.client, fixture, processes }),
      screen: ONE_SHELL,
      sweep: freshSweep(),
      workspace: CHAIR,
    });

    expect(verdict).toEqual({
      kind: "held",
      note: "its keep-alive's shell (pid 84990) runs something other than `slopweaver claude watch` and admitted read-only filters",
    });
  });
});

describe("sweepItem", () => {
  it("answers a kept row as kept, touching nothing", async () => {
    const fixture = home();
    const fake = fakeClient({ workspaces: [] });
    const item: CloseDonePlanItem = {
      kind: "kept",
      reason: "pinned",
      row: { lastEventIso: "2026-11-06T04:46:00.000Z", sessionKey: "k", status: "open" },
    };

    const outcome = await sweepItem({ deps: deps({ client: fake.client, fixture }), item, sweep: freshSweep() });

    expect(outcome).toEqual({ item, kind: "kept" });
    expect(fake.closed).toEqual([]);
  });
});
