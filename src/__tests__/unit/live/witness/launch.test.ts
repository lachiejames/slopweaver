/**
 * A witness worker's boot writes its session-ledger row, and a witness close retires it — a round trip through a
 * temp home's real JSONL, read back by the real fold, so the session board sees exactly what these writes produce.
 *
 * The boot is a plain fake answering a scripted outcome; the close runs the real cmux harness over the hand-built
 * client, wrapped by the real recorder, writing the real ledger.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planWitnessSession } from "../../../../cmux/planWitness.js";
import type { VisibleSessionLaunchOutcome } from "../../../../live/turn/tier.js";
import { closeWitnessWorkspace } from "../../../../live/witness/close.js";
import { launchWitnessSession } from "../../../../live/witness/launch.js";
import { cmuxSessionHarnessOver } from "../../../../sessionHarness/cmuxHarness.js";
import { recordingSessionHarness } from "../../../../sessionHarness/recordingHarness.js";
import { sessionLedgerDeps } from "../../../../sessionHarness/sessionLedger.js";
import { foldSessions, parseSessionLog } from "../../../../sessions/session.js";
import { readSessionLogText } from "../../../../sessions/sessionStore.js";
import { fakeCmux, INSTANT_WAITS, workspaceRow } from "../../sessionHarness/fakeCmux.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A fresh, empty temp home. */
function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-witness-ledger-"));
  homes.push(home);
  return home;
}

const PLAN = planWitnessSession({
  branch: "main",
  channel: "C0SYN000001",
  host: "claude-code",
  messageTs: "1789000000.000100",
  model: "opus",
  pickupCommand: "slopweaver witness resume w-abc",
  repoRoot: "/w/main",
  spawnedAt: "2026-11-09T01:00:00.000Z",
  text: "the other bot said the pool is exhausted",
});

/** The session the fake boot opens — fakeCmux's row 4, so a close can find it. */
const BOOTED: VisibleSessionLaunchOutcome = {
  session: {
    cwd: PLAN.cwd,
    host: PLAN.host,
    ...(PLAN.sessionName === undefined ? {} : { sessionName: PLAN.sessionName }),
    surfaceId: "surface-id-4",
    surfaceRef: "surface:4",
    workspaceId: "id-4",
    workspaceRef: "workspace:4",
  },
};

/** Every folded row in the home's ledger, as `[key, ref, status]`. */
function rowsOf({ home }: { home: string }): readonly (readonly [string, string | undefined, string])[] {
  const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
  return foldSessions({ events }).map((row) => [row.sessionKey, row.workspaceRef, row.status] as const);
}

describe("launchWitnessSession", () => {
  it("writes one open row keyed by the witness session name, carrying the workspace id", async () => {
    const home = emptyHome();
    const launched = await launchWitnessSession({ boot: () => Promise.resolve(BOOTED), home, plan: PLAN });

    expect(launched).toEqual(BOOTED);
    expect(PLAN.sessionName).toBe("witness-C0SYN000001-1789000000.000100");
    const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
    expect(events.map((event) => ({ ...event, tsIso: "<now>" }))).toEqual([
      {
        bootModel: { kind: "pinned", model: "opus" },
        branch: "main",
        cwd: "/w/main",
        harness: "cmux",
        kind: "spawned",
        openedBy: "open",
        sessionId: "id-4",
        sessionKey: "witness-C0SYN000001-1789000000.000100",
        surfaceRef: "surface:4",
        tsIso: "<now>",
        workspaceId: "id-4",
        workspaceRef: "workspace:4",
      },
    ]);
  });

  it("writes nothing for a boot that failed", async () => {
    const home = emptyHome();
    const launched = await launchWitnessSession({
      boot: () => Promise.resolve({ reason: "cmux refused the workspace" }),
      home,
      plan: PLAN,
    });

    expect(launched).toEqual({ reason: "cmux refused the workspace" });
    expect(readSessionLogText({ home })).toBe("");
  });

  it("leaves the row closed once a witness close parks the workspace it booted", async () => {
    const home = emptyHome();
    await launchWitnessSession({ boot: () => Promise.resolve(BOOTED), home, plan: PLAN });
    const ledger = sessionLedgerDeps({ home });
    const { client } = fakeCmux({ workspaces: [workspaceRow({ n: 4 })] });
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: "id-4",
      harness: recordingSessionHarness({
        callerSessionId: "id-4",
        harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
        ledger,
      }),
      ledger,
      target: { sessionKey: PLAN.sessionName, workspaceId: "id-4", workspaceRef: "workspace:4" },
    });

    expect(failure).toBe(undefined);
    expect(rowsOf({ home })).toEqual([["witness-C0SYN000001-1789000000.000100", "workspace:4", "closed"]]);
  });

  it("leaves the row closed when the workspace was already gone before the close", async () => {
    const home = emptyHome();
    await launchWitnessSession({ boot: () => Promise.resolve(BOOTED), home, plan: PLAN });
    const ledger = sessionLedgerDeps({ home });
    const { client } = fakeCmux({ workspaces: [] });
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: undefined,
      harness: recordingSessionHarness({
        callerSessionId: undefined,
        harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
        ledger,
      }),
      ledger,
      target: { sessionKey: PLAN.sessionName, workspaceId: "id-4", workspaceRef: "workspace:4" },
    });

    expect(failure).toBe(undefined);
    expect(rowsOf({ home })).toEqual([["witness-C0SYN000001-1789000000.000100", "workspace:4", "closed"]]);
  });

  it("leaves another session's open row and its live workspace alone, when a stale witness row names it", async () => {
    const home = emptyHome();
    await launchWitnessSession({ boot: () => Promise.resolve(BOOTED), home, plan: PLAN });
    const ledger = sessionLedgerDeps({ home });
    const { calls, client } = fakeCmux({ workspaces: [workspaceRow({ n: 4 })] });
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: "id-1",
      harness: recordingSessionHarness({
        callerSessionId: "id-1",
        harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
        ledger,
      }),
      ledger,
      target: { sessionKey: "witness-old", workspaceId: "id-4", workspaceRef: "workspace:4" },
    });

    expect(failure).toBe(
      "workspace:4 is held under another session's ledger row (witness-C0SYN000001-1789000000.000100), so this witness close left it standing",
    );
    expect(calls.filter((c) => c.op === "closeWorkspace")).toEqual([]);
    expect(rowsOf({ home })).toEqual([["witness-C0SYN000001-1789000000.000100", "workspace:4", "open"]]);
  });

  it("writes one close only, when a close is retried after the workspace it closed is gone", async () => {
    const home = emptyHome();
    await launchWitnessSession({ boot: () => Promise.resolve(BOOTED), home, plan: PLAN });
    const ledger = sessionLedgerDeps({ home });
    const target = { sessionKey: PLAN.sessionName, workspaceId: "id-4", workspaceRef: "workspace:4" };
    const first = fakeCmux({ workspaces: [workspaceRow({ n: 4 })] });
    const retried = fakeCmux({ workspaces: [] });
    const failures = [
      await closeWitnessWorkspace({
        callerWorkspaceId: "id-1",
        harness: recordingSessionHarness({
          callerSessionId: "id-1",
          harness: cmuxSessionHarnessOver({ client: first.client, waits: INSTANT_WAITS }),
          ledger,
        }),
        ledger,
        target,
      }),
      await closeWitnessWorkspace({
        callerWorkspaceId: "id-1",
        harness: recordingSessionHarness({
          callerSessionId: "id-1",
          harness: cmuxSessionHarnessOver({ client: retried.client, waits: INSTANT_WAITS }),
          ledger,
        }),
        ledger,
        target,
      }),
    ];

    expect(failures).toEqual([undefined, undefined]);
    const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
    expect(events.map((event) => event.kind)).toEqual(["spawned", "closed"]);
  });
});
