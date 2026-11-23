/**
 * `openRecordedCmuxSession`, the one way both drawdown investigations open their session: a launch over a fake
 * cmux client writes exactly one `spawned` row the dispatched close still retires, and a failed launch hands back
 * cmux's own failure shape. A filesystem round-trip through a temp home, so the row is the one the real appender
 * wrote.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseRenderGrid } from "../../../cmux/renderGrid.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { closeDispatchedSession } from "../../../live/turn/sessionLedger.js";
import { launchSpecFromPlan } from "../../../sessionHarness/cmuxLaunch.js";
import { openRecordedCmuxSession } from "../../../sessionHarness/recordedSpawn.js";
import { recordBootedSession } from "../../../sessionHarness/recordingHarness.js";
import { sessionLedgerDeps } from "../../../sessionHarness/sessionLedger.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { fakeClient } from "../cmux/spawn/fakeClient.js";
import { deps, PLAN } from "../cmux/spawn/harness.js";

const COMPOSER_FIXTURES = join(import.meta.dirname, "../../fixtures/composer");
const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A fresh, empty temp home. */
function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-recorded-"));
  homes.push(home);
  return home;
}

describe("openRecordedCmuxSession", () => {
  it("returns the workspace it booted and writes one spawned row under the plan's workspace name", async () => {
    const home = emptyHome();
    const { client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booted…"] });
    const { deps: spawnDeps } = deps({ client });

    const opened = await openRecordedCmuxSession({ deps: spawnDeps, home, plan: PLAN });

    expect(unwrap(opened)).toEqual({ workspaceRef: "workspace:1" });
    const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
    expect(events.map((event) => [event.kind, event.sessionKey, "harness" in event ? event.harness : ""])).toEqual([
      ["spawned", "a-doc", "cmux"],
    ]);
  });

  it("writes a row the dispatched close retires by workspace ref", async () => {
    const home = emptyHome();
    const { client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booted…"] });
    const { deps: spawnDeps } = deps({ client });

    await openRecordedCmuxSession({ deps: spawnDeps, home, plan: PLAN });
    closeDispatchedSession({
      home,
      sessionKey: "a-doc",
      tsIso: "2026-11-09T02:00:00.000Z",
      workspaceRef: "workspace:1",
    });

    const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
    expect(foldSessions({ events }).map((row) => [row.sessionKey, row.workspaceRef, row.status])).toEqual([
      ["a-doc", "workspace:1", "closed"],
    ]);
  });

  it("hands a boot that never confirms back with no workspace ref, since spawn closed both tries, and writes no row", async () => {
    const home = emptyHome();
    const { client } = fakeClient({ screens: ["$ "] });
    const { deps: spawnDeps } = deps({ client });

    const opened = await openRecordedCmuxSession({ deps: spawnDeps, home, plan: PLAN });

    expect(unwrapErr(opened).workspaceRef).toBe("");
    expect(unwrapErr(opened).reason).toContain("claude failed to boot twice");
    expect(readSessionLogText({ home })).toBe("");
  });

  // A pickup left typed in a LIVE session is a session a caller must neither close nor relaunch beside, so the
  // seam records it — the drawdown caller leaves the workspace standing, and the row is what lets it be found.
  it("hands a stranded pickup back with the workspace still standing, and records that standing session", async () => {
    const home = emptyHome();
    const typed = unwrap(
      parseRenderGrid({ value: JSON.parse(readFileSync(join(COMPOSER_FIXTURES, "typed.json"), "utf8")) }),
    );
    const screens = ["$ ", "Claude Code v2.1.231 booting…", `❯ ${PLAN.pickupCommand}`];
    const { client } = fakeClient({ grids: [typed], screens });
    const { deps: spawnDeps } = deps({ client });

    const opened = await openRecordedCmuxSession({ deps: spawnDeps, home, plan: PLAN });

    expect(unwrapErr(opened).workspaceRef).toBe("workspace:1");
    const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
    expect(foldSessions({ events }).map((row) => [row.sessionKey, row.workspaceRef, row.status])).toEqual([
      ["a-doc", "workspace:1", "open"],
    ]);
  });
});

describe("recordBootedSession", () => {
  it("writes the open row for a session booted in two halves, at the address the boot named", () => {
    const home = emptyHome();

    recordBootedSession({
      address: { endpointHandle: "surface:7", handle: "workspace:7", sessionId: "id-7" },
      implementation: "cmux",
      ledger: sessionLedgerDeps({ home }),
      spec: launchSpecFromPlan({ ledgerKey: "fresh-turn", plan: PLAN }),
    });

    const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
    expect(foldSessions({ events }).map((row) => [row.sessionKey, row.workspaceRef, row.status])).toEqual([
      ["fresh-turn", "workspace:7", "open"],
    ]);
  });
});
