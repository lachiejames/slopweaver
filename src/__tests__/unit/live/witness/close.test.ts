/**
 * A witness close goes through the RECORDING harness, so the ledger row the worker's boot opened is closed by the
 * same act: forced for the worker closing itself (row written before the park), bounded for any other (row written
 * only off a park that went through), a held park reported as the failure it is, and a workspace already gone —
 * at either resolve — counted closed with its row closed here.
 *
 * Every collaborator is a plain object: the real cmux harness over the hand-built client, wrapped by the real
 * recorder, writing into a collecting ledger.
 */
import { describe, expect, it } from "vitest";
import type { CmuxClient } from "../../../../cmux/client.js";
import { err, ok } from "../../../../lib/result.js";
import {
  closeWitnessWorkspace,
  type WitnessCloseTarget,
  witnessCloseDecision,
  witnessParkMode,
} from "../../../../live/witness/close.js";
import { cmuxSessionHarnessOver } from "../../../../sessionHarness/cmuxHarness.js";
import { sessionFromCmux } from "../../../../sessionHarness/cmuxSession.js";
import { SessionHarnessErrors } from "../../../../sessionHarness/errors.js";
import { recordingSessionHarness, type SessionLedgerDeps } from "../../../../sessionHarness/recordingHarness.js";
import type { SessionHarness } from "../../../../sessionHarness/sessionHarness.js";
import {
  CONFIRMATION_REQUIRED,
  fakeCmux,
  INSTANT_WAITS,
  RUNNING_SCREEN,
  workspaceRow,
} from "../../sessionHarness/fakeCmux.js";
import { collectingLedger, NOW } from "../../sessionHarness/recordingLedgerFixtures.js";

const NOT_FOUND = SessionHarnessErrors.sessionNotFound({ handle: "id-2", message: "no live cmux workspace" });
const UNAVAILABLE = SessionHarnessErrors.unavailable({
  causeCode: "SOCKET_UNAVAILABLE",
  message: "cmux socket is not answering",
  operation: "park",
});

/** The close target for fakeCmux's row `n`, registered under the fixture ledger's key. */
function targetOf({ n }: { n: number }): WitnessCloseTarget {
  return { sessionKey: "a-doc", workspaceId: `id-${String(n)}`, workspaceRef: `workspace:${String(n)}` };
}

/** The recording harness over a fake client, as `witness` wires it for real. */
function recordingOver({
  client,
  ledger,
  callerWorkspaceId,
}: {
  client: CmuxClient;
  ledger: SessionLedgerDeps;
  callerWorkspaceId: string | undefined;
}): SessionHarness {
  return recordingSessionHarness({
    callerSessionId: callerWorkspaceId,
    harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
    ledger,
  });
}

describe("witnessParkMode", () => {
  it("forces only the workspace this process runs in", () => {
    expect(witnessParkMode({ callerWorkspaceId: "id-3", workspaceId: "id-3" })).toBe("force");
    expect(witnessParkMode({ callerWorkspaceId: "id-1", workspaceId: "id-3" })).toBe("bounded");
    expect(witnessParkMode({ callerWorkspaceId: undefined, workspaceId: "id-3" })).toBe("bounded");
  });
});

describe("witnessCloseDecision", () => {
  it("maps every observation to its ending", () => {
    expect(witnessCloseDecision({ observation: { kind: "parked" } })).toEqual({
      failure: undefined,
      reconcileLedger: false,
    });
    expect(witnessCloseDecision({ observation: { handle: "workspace:2", kind: "held", reason: "queued" } })).toEqual({
      failure:
        "workspace:2 was held open (queued): its screen did not prove it idle at its prompt, so it was not forced",
      reconcileLedger: false,
    });
    expect(
      witnessCloseDecision({ observation: { handle: "workspace:2", kind: "foreign-row", ownerKey: "new-owner" } }),
    ).toEqual({
      failure:
        "workspace:2 is held under another session's ledger row (new-owner), so this witness close left it standing",
      reconcileLedger: false,
    });
    expect(witnessCloseDecision({ observation: { error: NOT_FOUND, kind: "resolve-failed" } })).toEqual({
      failure: undefined,
      reconcileLedger: true,
    });
    expect(witnessCloseDecision({ observation: { error: UNAVAILABLE, kind: "resolve-failed" } })).toEqual({
      failure: "cmux socket is not answering",
      reconcileLedger: false,
    });
    expect(witnessCloseDecision({ observation: { error: NOT_FOUND, kind: "park-failed", own: false } })).toEqual({
      failure: undefined,
      reconcileLedger: true,
    });
    expect(witnessCloseDecision({ observation: { error: NOT_FOUND, kind: "park-failed", own: true } })).toEqual({
      failure: undefined,
      reconcileLedger: false,
    });
    expect(witnessCloseDecision({ observation: { error: UNAVAILABLE, kind: "park-failed", own: false } })).toEqual({
      failure: "cmux socket is not answering",
      reconcileLedger: false,
    });
  });
});

describe("closeWitnessWorkspace", () => {
  it("force-closes the worker's own workspace and records its row closed BEFORE the park", async () => {
    const { calls, client } = fakeCmux({
      close: { forced: undefined, plain: CONFIRMATION_REQUIRED },
      screens: [RUNNING_SCREEN],
      workspaces: [workspaceRow({ n: 3 })],
    });
    const { at, events, ledger } = collectingLedger({ clock: () => calls.length });
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: "id-3",
      harness: recordingOver({ callerWorkspaceId: "id-3", client, ledger }),
      ledger,
      target: targetOf({ n: 3 }),
    });

    expect(failure).toBe(undefined);
    expect(calls.filter((c) => c.op === "closeWorkspace")).toEqual([{ force: true, op: "closeWorkspace" }]);
    expect(events).toEqual([
      { kind: "closed", sessionId: "id-3", sessionKey: "a-doc", tsIso: NOW, workspaceRef: "workspace:3" },
    ]);
    // Written after the resolve and before the park's own re-resolve and close.
    expect(at).toEqual([1]);
  });

  it("closes a foreign idle workspace unforced and records its row closed after the park", async () => {
    const { calls, client } = fakeCmux({ workspaces: [workspaceRow({ n: 2 })] });
    const { at, events, ledger } = collectingLedger({ clock: () => calls.length });
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: "id-1",
      harness: recordingOver({ callerWorkspaceId: "id-1", client, ledger }),
      ledger,
      target: targetOf({ n: 2 }),
    });

    expect(failure).toBe(undefined);
    expect(calls.filter((c) => c.op === "closeWorkspace")).toEqual([{ force: false, op: "closeWorkspace" }]);
    expect(events).toEqual([
      { kind: "closed", sessionId: "id-2", sessionKey: "a-doc", tsIso: NOW, workspaceRef: "workspace:2" },
    ]);
    expect(at).toEqual([3]);
  });

  it("reports a foreign workspace its screen held open as a failure, and leaves its row open", async () => {
    const { calls, client } = fakeCmux({
      close: { forced: undefined, plain: CONFIRMATION_REQUIRED },
      screens: [RUNNING_SCREEN],
      workspaces: [workspaceRow({ n: 2 })],
    });
    const { events, ledger } = collectingLedger({});
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: undefined,
      harness: recordingOver({ callerWorkspaceId: undefined, client, ledger }),
      ledger,
      target: targetOf({ n: 2 }),
    });

    expect(failure).toBe(
      "workspace:2 was held open (busy): its screen did not prove it idle at its prompt, so it was not forced",
    );
    expect(calls.filter((c) => c.op === "closeWorkspace")).toEqual([{ force: false, op: "closeWorkspace" }]);
    expect(events).toEqual([]);
  });

  it("leaves a live workspace the ledger holds under another key standing, and writes no row", async () => {
    const { calls, client } = fakeCmux({ workspaces: [workspaceRow({ n: 9 })] });
    const { events, ledger } = collectingLedger({});
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: "id-1",
      harness: recordingOver({ callerWorkspaceId: "id-1", client, ledger }),
      ledger,
      target: { ...targetOf({ n: 9 }), sessionKey: "witness-old" },
    });

    expect(failure).toBe(
      "workspace:9 is held under another session's ledger row (a-doc), so this witness close left it standing",
    );
    expect(calls.filter((c) => c.op === "closeWorkspace")).toEqual([]);
    expect(events).toEqual([]);
  });

  it("closes a live workspace the ledger cannot be read for, the recorder carrying the warning", async () => {
    const { calls, client } = fakeCmux({ workspaces: [workspaceRow({ n: 2 })] });
    const { events, ledger } = collectingLedger({ unreadable: "line 3 does not parse" });
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: "id-1",
      harness: recordingOver({ callerWorkspaceId: "id-1", client, ledger }),
      ledger,
      target: targetOf({ n: 2 }),
    });

    expect(failure).toBe(undefined);
    expect(calls.filter((c) => c.op === "closeWorkspace")).toEqual([{ force: false, op: "closeWorkspace" }]);
    expect(events).toEqual([]);
  });

  it("counts a workspace already gone at the first resolve as closed, and closes its row by id", async () => {
    const { calls, client } = fakeCmux({ workspaces: [] });
    const { events, ledger } = collectingLedger({});
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: "id-1",
      harness: recordingOver({ callerWorkspaceId: "id-1", client, ledger }),
      ledger,
      target: targetOf({ n: 9 }),
    });

    expect(failure).toBe(undefined);
    expect(calls.filter((c) => c.op === "closeWorkspace")).toEqual([]);
    expect(events).toEqual([
      { kind: "closed", sessionId: "id-9", sessionKey: "a-doc", tsIso: NOW, workspaceRef: "workspace:9" },
    ]);
  });

  it("counts a workspace gone by the park's own re-resolve as closed, and closes its row by id", async () => {
    // A plain harness: resolve finds the session, then the park's re-resolve by id no longer does.
    const { events, ledger } = collectingLedger({});
    const harness: Pick<SessionHarness, "park" | "resolve"> = {
      park: () => Promise.resolve(err(NOT_FOUND)),
      resolve: () => Promise.resolve(ok({ session: sessionFromCmux({ workspace: workspaceRow({ n: 2 }) }) })),
    };
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: "id-1",
      harness,
      ledger,
      target: targetOf({ n: 2 }),
    });

    expect(failure).toBe(undefined);
    expect(events).toEqual([
      { kind: "closed", sessionId: "id-2", sessionKey: "a-doc", tsIso: NOW, workspaceRef: "workspace:2" },
    ]);
  });

  it("closes no row for a gone workspace whose dispatched row predates boot registration", async () => {
    const { client } = fakeCmux({ workspaces: [] });
    const { events, ledger } = collectingLedger({});
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: undefined,
      harness: recordingOver({ callerWorkspaceId: undefined, client, ledger }),
      ledger,
      target: { sessionKey: undefined, workspaceId: "id-9", workspaceRef: "workspace:9" },
    });

    expect(failure).toBe(undefined);
    expect(events).toEqual([]);
  });

  it("closes no row for a gone workspace the ledger holds no open row for, or holds under another key", async () => {
    const { client } = fakeCmux({ workspaces: [] });
    const untracked = collectingLedger({ untracked: true });
    const otherKey = collectingLedger({});
    const untrackedFailure = await closeWitnessWorkspace({
      callerWorkspaceId: undefined,
      harness: recordingOver({ callerWorkspaceId: undefined, client, ledger: untracked.ledger }),
      ledger: untracked.ledger,
      target: targetOf({ n: 9 }),
    });
    const otherKeyFailure = await closeWitnessWorkspace({
      callerWorkspaceId: undefined,
      harness: recordingOver({ callerWorkspaceId: undefined, client, ledger: otherKey.ledger }),
      ledger: otherKey.ledger,
      target: { ...targetOf({ n: 9 }), sessionKey: "witness-C0SYN000001-1789000000.000100" },
    });

    expect([untrackedFailure, otherKeyFailure]).toEqual([undefined, undefined]);
    expect([untracked.events, otherKey.events]).toEqual([[], []]);
  });

  it("warns, never fails, when the ledger cannot be read to close a gone workspace's row", async () => {
    const { client } = fakeCmux({ workspaces: [] });
    const { events, warnings, ledger } = collectingLedger({ unreadable: "line 3 does not parse" });
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: undefined,
      harness: recordingOver({ callerWorkspaceId: undefined, client, ledger }),
      ledger,
      target: targetOf({ n: 9 }),
    });

    expect(failure).toBe(undefined);
    expect(events).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the close of a-doc (line 3 does not parse) — the workspace is gone; the ledger is missing this row's close",
    ]);
  });

  it("warns, never fails, when the gone workspace's row cannot be written", async () => {
    const { client } = fakeCmux({ workspaces: [] });
    const { warnings, ledger } = collectingLedger({ failWith: "disk full" });
    const failure = await closeWitnessWorkspace({
      callerWorkspaceId: undefined,
      harness: recordingOver({ callerWorkspaceId: undefined, client, ledger }),
      ledger,
      target: targetOf({ n: 9 }),
    });

    expect(failure).toBe(undefined);
    expect(warnings).toEqual([
      "session ledger: could not record the close of a-doc (disk full) — the workspace is gone; the ledger is missing this row's close",
    ]);
  });
});
