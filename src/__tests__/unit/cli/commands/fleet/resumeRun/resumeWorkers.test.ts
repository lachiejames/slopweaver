/**
 * The recovery pass's worker half, driven on its own with no chair standing, because the chair's state is exactly
 * what must never hold it.
 */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resumeWorkers } from "../../../../../../cli/commands/fleet/resumeWorkers.js";
import { unwrap } from "../../../../../../lib/result.js";
import { memoryFleetPort } from "../../../../../fleetStoreFixture.js";
import { fakeClient, fakeDeps, makeHome, passState, workspace } from "../fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A signed-out worker's entry, as the pass builds one from its wall read. */
const LOGGED_OUT_ENTRY = { entry: { kind: "walled", wall: { kind: "logged-out" } }, sessionId: undefined } as const;

describe("resumeWorkers", () => {
  it("relaunches a walled worker with no supervisor standing, and holds a looping one saying no one was asked", async () => {
    const client = fakeClient({});
    const fleet = memoryFleetPort();
    const state = passState({ fleet, home });
    const walled = workspace({ id: "walled" });
    const looping = workspace({ id: "looping" });
    await resumeWorkers({
      accounts: [],
      chair: undefined,
      client,
      deps: fakeDeps({ client, ownWorkspaceId: undefined }),
      entries: new Map([
        ["walled", LOGGED_OUT_ENTRY],
        ["looping", LOGGED_OUT_ENTRY],
      ]),
      loops: new Map([
        ["workspace:looping", { reseats: 3, sinceIso: "2026-10-11T00:00:00.000Z", workspaceRef: "workspace:looping" }],
      ]),
      signedOut: new Map(),
      state,
      targets: [
        { priority: "p1", title: "walled", workspace: walled },
        { priority: "p2", title: "looping", workspace: looping },
      ],
    });
    expect(
      unwrap(await fleet.readResumeJournal({ home })).events.map((event) => [
        event.kind,
        "phase" in event ? event.phase : "",
      ]),
    ).toEqual([
      ["seat", "recovering"],
      ["seat", "refused"],
      ["seat", "held"],
    ]);
    expect(state.lines.at(-1)).toBe("workspace:looping\tno supervisor stands to investigate this loop");
  });

  it("passes over every later worker only when an earlier relaunch failed after its stop", async () => {
    const client = fakeClient({});
    const state = { ...passState({ fleet: memoryFleetPort(), home }), deferred: true };
    await resumeWorkers({
      accounts: [],
      chair: undefined,
      client,
      deps: fakeDeps({ client, ownWorkspaceId: undefined }),
      entries: new Map([["walled", LOGGED_OUT_ENTRY]]),
      loops: new Map(),
      signedOut: new Map(),
      state,
      targets: [{ priority: "p1", title: "walled", workspace: workspace({ id: "walled" }) }],
    });
    expect(state.lines).toEqual([
      "workspace:walled\tnot yet — an earlier relaunch failed after its stop, so this one waits for the next attempt",
    ]);
  });
});
