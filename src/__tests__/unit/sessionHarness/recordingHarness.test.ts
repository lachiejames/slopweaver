/**
 * The control plane's one writer: the recording decorator writes a session's ledger row from what the seam DID.
 * A launch opens a row naming its act; a park closes it — before the park for the caller's own session, only after
 * a park that went through for any other — and a ledger that cannot be written warns without changing the act.
 *
 * Every collaborator is a plain object: the cmux harness over the hand-built client (`./fakeCmux.ts`), a launcher
 * answering a scripted outcome, and a ledger collecting what it was handed.
 */
import { describe, expect, it } from "vitest";

import { CODEX_MODEL } from "../../../codex/profiles.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { cmuxSessionHarnessOver } from "../../../sessionHarness/cmuxHarness.js";
import { sessionFromCmux } from "../../../sessionHarness/cmuxSession.js";
import { SessionHarnessErrors } from "../../../sessionHarness/errors.js";
import type { HarnessOpenedSession } from "../../../sessionHarness/launch.js";
import {
  bootModelForLaunch,
  recordingSessionHarness,
  recordingSessionLauncher,
  spawnedEventOf,
} from "../../../sessionHarness/recordingHarness.js";
import type { HarnessSession } from "../../../sessionHarness/sessionHarness.js";
import { CONFIRMATION_REQUIRED, fakeCmux, INSTANT_WAITS, RUNNING_SCREEN, workspaceRow } from "./fakeCmux.js";
import { collectingLedger, hostileLedger, NOW, OPENED, SPEC, scriptedLauncher } from "./recordingLedgerFixtures.js";

describe("spawnedEventOf", () => {
  it("names the act, the harness and the session id the row is keyed by for life", () => {
    expect(
      spawnedEventOf({
        address: { endpointHandle: "surface:7", handle: "workspace:7", sessionId: "id-7" },
        implementation: "cmux",
        operation: "resume",
        spec: SPEC,
        tsIso: NOW,
      }),
    ).toEqual({
      bootModel: { kind: "pinned", model: "opus" },
      branch: "a-branch",
      cwd: "/work/tree-7",
      harness: "cmux",
      kind: "spawned",
      openedBy: "resume",
      sessionId: "id-7",
      sessionKey: "a-doc",
      slug: "a-doc",
      surfaceRef: "surface:7",
      tsIso: NOW,
      workspaceId: "id-7",
      workspaceRef: "workspace:7",
    });
  });

  it("records the repository's Codex pin for a Codex seat, never the Claude tier the spawn was handed", () => {
    expect(
      spawnedEventOf({
        address: { endpointHandle: "app:id-7", handle: "app:id-7", sessionId: "id-7" },
        implementation: "app",
        operation: "open",
        spec: { ...SPEC, host: "codex", model: "sonnet" },
        tsIso: NOW,
      }),
    ).toEqual({
      bootModel: { kind: "pinned", model: CODEX_MODEL },
      branch: "a-branch",
      cwd: "/work/tree-7",
      harness: "app",
      kind: "spawned",
      openedBy: "open",
      sessionId: "id-7",
      sessionKey: "a-doc",
      slug: "a-doc",
      surfaceRef: "app:id-7",
      tsIso: NOW,
      workspaceId: "id-7",
      workspaceRef: "app:id-7",
    });
  });

  it("omits both ids when the launch named none", () => {
    const event = spawnedEventOf({
      address: { endpointHandle: "", handle: "workspace:7" },
      implementation: "cmux",
      operation: "open",
      spec: SPEC,
      tsIso: NOW,
    });
    expect(Object.keys(event).filter((k) => k === "sessionId" || k === "workspaceId")).toEqual([]);
  });
});

describe("bootModelForLaunch", () => {
  it("records the Codex pin for a Codex seat whatever the spec's model", () => {
    expect(bootModelForLaunch({ spec: { ...SPEC, host: "codex", model: "sonnet" } })).toEqual({
      kind: "pinned",
      model: CODEX_MODEL,
    });
  });

  it("records the Codex pin for a Codex seat that pinned no model", () => {
    expect(bootModelForLaunch({ spec: { ...SPEC, host: "codex", model: undefined } })).toEqual({
      kind: "pinned",
      model: CODEX_MODEL,
    });
  });

  it("keeps a Claude seat's pinned tier", () => {
    expect(bootModelForLaunch({ spec: { ...SPEC, host: "claude-code", model: "sonnet" } })).toEqual({
      kind: "pinned",
      model: "sonnet",
    });
  });

  it("keeps an unpinned Claude seat inherited", () => {
    expect(bootModelForLaunch({ spec: { ...SPEC, host: "claude-code", model: undefined } })).toEqual({
      kind: "inherited",
    });
  });
});

describe("recordingSessionLauncher", () => {
  it("records an opened session as `open`, through the act it was asked for", async () => {
    const { acts, launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { events, ledger } = collectingLedger({});
    const launched = await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });

    expect(unwrap(launched)).toEqual(OPENED);
    expect(acts).toEqual(["open"]);
    expect(events).toEqual([
      spawnedEventOf({
        address: { endpointHandle: "surface:7", handle: "workspace:7", sessionId: "id-7" },
        implementation: "cmux",
        operation: "open",
        spec: SPEC,
        tsIso: NOW,
      }),
    ]);
  });

  it("records a resumed session as `resume`", async () => {
    const { acts, launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { events, ledger } = collectingLedger({});
    await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).resume({ spec: SPEC });

    expect(acts).toEqual(["resume"]);
    expect(events).toMatchObject([{ kind: "spawned", openedBy: "resume", sessionId: "id-7" }]);
  });

  it("records a session continued on its own transcript as `resumed` on its row, never a second `spawned` one", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok({ ...OPENED, resumed: true }) });
    const { events, ledger } = collectingLedger({});
    await recordingSessionLauncher({ implementation: "app", launcher, ledger }).resume({ spec: SPEC });

    expect(events).toEqual([{ kind: "resumed", sessionId: "id-7", sessionKey: "a-doc", tsIso: NOW }]);
  });

  it("records a resumed session left standing with its delivery unproven as `resumed` on its row too", async () => {
    const failure = SessionHarnessErrors.launchFailed({
      initialMessageUnproven: true,
      message: "the initial message's delivery was not confirmed",
      opened: { endpointHandle: "app:7", handle: "app:7", sessionId: "id-7" },
      operation: "resume",
      resumed: true,
    });
    const { launcher } = scriptedLauncher({ outcome: err(failure) });
    const { events, ledger } = collectingLedger({});
    await recordingSessionLauncher({ implementation: "app", launcher, ledger }).resume({ spec: SPEC });

    expect(events).toEqual([{ kind: "resumed", sessionId: "id-7", sessionKey: "a-doc", tsIso: NOW }]);
  });

  it("records the act the sent line was resolved for when the journal moved after the act was picked", async () => {
    const { acts, launcher } = scriptedLauncher({ outcome: ok(OPENED) });
    const { events, ledger } = collectingLedger({});
    await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({
      resolveInitialMessage: () => ok({ operation: "resume", text: "/slopweaver:handover resume a-doc" }),
      spec: SPEC,
    });

    expect(acts).toEqual(["open"]);
    expect(events).toMatchObject([{ kind: "spawned", openedBy: "resume", sessionId: "id-7" }]);
  });

  it("warns, rather than skipping silently, when a launch left a session holding its message at no address", async () => {
    const failure = SessionHarnessErrors.launchFailed({
      initialMessageUnproven: true,
      message: "nothing saw the message submitted",
      operation: "open",
    });
    const { launcher } = scriptedLauncher({ outcome: err(failure) });
    const { events, ledger, warnings } = collectingLedger({});
    const launched = await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });

    expect(unwrapErr(launched)).toEqual(failure);
    expect(events).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (the launch left a session at no address it named) — the ledger is missing this row",
    ]);
  });

  it("warns, and writes no row naming nothing, when a launch that went through named no address", async () => {
    const unnamed: HarnessOpenedSession = { ...OPENED, endpointHandle: "", handle: "", sessionId: "" };
    const { launcher } = scriptedLauncher({ outcome: ok(unnamed) });
    const { events, ledger, warnings } = collectingLedger({});
    const launched = await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });

    expect(unwrap(launched)).toEqual(unnamed);
    expect(events).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not record the open for a-doc (the launch left a session at no address it named) — the ledger is missing this row",
    ]);
  });

  it("warns, and writes no row naming nothing, when the address a held-open launch left is empty", async () => {
    const written: number[] = [];
    const warned: string[] = [];
    for (const opened of [
      { endpointHandle: "", handle: "" },
      { endpointHandle: "", handle: "", sessionId: "" },
    ]) {
      const failure = SessionHarnessErrors.launchFailed({
        initialMessageUnproven: true,
        message: "nothing saw the message submitted",
        opened,
        operation: "open",
      });
      const { launcher } = scriptedLauncher({ outcome: err(failure) });
      const { events, ledger, warnings } = collectingLedger({});
      await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });
      written.push(events.length);
      warned.push(...warnings);
    }

    expect(written).toEqual([0, 0]);
    expect(warned).toEqual(
      Array(2).fill(
        "session ledger: could not record the open for a-doc (the launch left a session at no address it named) — the ledger is missing this row",
      ),
    );
  });

  it("records a failed launch that left its session holding the message, at the address it left", async () => {
    const failure = SessionHarnessErrors.launchFailed({
      initialMessageUnproven: true,
      message: "nothing saw the message submitted",
      opened: { endpointHandle: "surface:9", handle: "workspace:9", sessionId: "id-9" },
      operation: "open",
    });
    const { launcher } = scriptedLauncher({ outcome: err(failure) });
    const { events, ledger } = collectingLedger({});
    const launched = await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });

    expect(unwrapErr(launched)).toEqual(failure);
    expect(events).toMatchObject([
      { kind: "spawned", openedBy: "open", sessionId: "id-9", surfaceRef: "surface:9", workspaceRef: "workspace:9" },
    ]);
  });

  it("writes no row for a failed launch that left nothing holding the message", async () => {
    const failure = SessionHarnessErrors.launchFailed({
      message: "the boot was never witnessed",
      opened: { endpointHandle: "surface:9", handle: "workspace:9", sessionId: "id-9" },
      operation: "open",
    });
    const { launcher } = scriptedLauncher({ outcome: err(failure) });
    const { events, ledger } = collectingLedger({});
    const launched = await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({ spec: SPEC });

    expect(unwrapErr(launched).code).toBe("SESSION_LAUNCH_FAILED");
    expect(events).toEqual([]);
  });
});

describe("recordingSessionHarness — park", () => {
  it("records a foreign session closed only after its park went through", async () => {
    const row = workspaceRow({ n: 2 });
    const { calls, client } = fakeCmux({ workspaces: [row] });
    const { at, events, ledger } = collectingLedger({ clock: () => calls.length });
    const harness = recordingSessionHarness({
      callerSessionId: "id-1",
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const parked = await harness.park({ mode: "force", target: { session: sessionFromCmux({ workspace: row }) } });

    expect(unwrap(parked)).toEqual({ forced: true, kind: "parked", session: sessionFromCmux({ workspace: row }) });
    expect(calls.map((c) => c.op)).toEqual(["resolveWorkspace", "closeWorkspace"]);
    expect(events).toEqual([
      { kind: "closed", sessionId: "id-2", sessionKey: "a-doc", tsIso: NOW, workspaceRef: "workspace:2" },
    ]);
    // Appended once both cmux calls had been made.
    expect(at).toEqual([2]);
  });

  it("records the caller's own session closed BEFORE its park, since it does not outlive it", async () => {
    const row = workspaceRow({ n: 1 });
    const { calls, client } = fakeCmux({ workspaces: [row] });
    const { at, events, ledger } = collectingLedger({ clock: () => calls.length });
    const harness = recordingSessionHarness({
      callerSessionId: "id-1",
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    await harness.park({ mode: "force", target: { session: sessionFromCmux({ workspace: row }) } });

    expect(events).toEqual([
      { kind: "closed", sessionId: "id-1", sessionKey: "a-doc", tsIso: NOW, workspaceRef: "workspace:1" },
    ]);
    expect(at).toEqual([0]);
  });

  it("leaves a foreign session's row open when its screen held the park, naming the ref it has NOW", async () => {
    // Picked as workspace:2; a cmux restart since renumbered the same id to workspace:7.
    const picked = workspaceRow({ n: 2 });
    const renumbered = { ...picked, workspaceRef: "workspace:7" };
    const { client } = fakeCmux({
      close: { forced: undefined, plain: CONFIRMATION_REQUIRED },
      screens: [RUNNING_SCREEN],
      workspaces: [renumbered],
    });
    const { events, ledger } = collectingLedger({});
    const harness = recordingSessionHarness({
      callerSessionId: "id-1",
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const parked = await harness.park({ mode: "bounded", target: { session: sessionFromCmux({ workspace: picked }) } });

    expect(unwrap(parked)).toEqual({
      kind: "held",
      reason: "busy",
      session: sessionFromCmux({ workspace: renumbered }),
    });
    expect(sessionFromCmux({ workspace: renumbered }).handle).toBe("workspace:7");
    expect(events).toEqual([]);
  });

  it("leaves a foreign session's row open when its park failed", async () => {
    const { client } = fakeCmux({ workspaces: [] });
    const { events, ledger } = collectingLedger({});
    const harness = recordingSessionHarness({
      callerSessionId: "id-1",
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const parked = await harness.park({
      mode: "force",
      target: { session: sessionFromCmux({ workspace: workspaceRow({ n: 2 }) }) },
    });

    expect(unwrapErr(parked).code).toBe("SESSION_NOT_FOUND");
    expect(events).toEqual([]);
  });

  it("writes nothing for a session the ledger tracks no open row for", async () => {
    const row = workspaceRow({ n: 2 });
    const { client } = fakeCmux({ workspaces: [row] });
    const { events, ledger } = collectingLedger({ untracked: true });
    const harness = recordingSessionHarness({
      callerSessionId: "id-1",
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const parked = await harness.park({ mode: "force", target: { session: sessionFromCmux({ workspace: row }) } });

    expect(unwrap(parked).kind).toBe("parked");
    expect(events).toEqual([]);
  });

  it("warns when the close cannot be recorded and returns the park unchanged", async () => {
    const row = workspaceRow({ n: 2 });
    const { client } = fakeCmux({ workspaces: [row] });
    const { ledger, warnings } = collectingLedger({ failWith: "ENOSPC" });
    const harness = recordingSessionHarness({
      callerSessionId: undefined,
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const parked = await harness.park({ mode: "force", target: { session: sessionFromCmux({ workspace: row }) } });

    expect(unwrap(parked).kind).toBe("parked");
    expect(warnings).toEqual([
      "session ledger: could not record the park for a-doc (ENOSPC) — the act itself went through; the ledger is missing this row",
    ]);
  });

  it("still parks the caller's own session when the ledger clock throws before the park", async () => {
    const row = workspaceRow({ n: 1 });
    const { calls, client } = fakeCmux({ workspaces: [row] });
    const { ledger, warnings } = collectingLedger({ clockFails: "clock failed" });
    const harness = recordingSessionHarness({
      callerSessionId: "id-1",
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const parked = await harness.park({ mode: "force", target: { session: sessionFromCmux({ workspace: row }) } });

    expect(unwrap(parked).kind).toBe("parked");
    expect(calls.map((c) => c.op)).toEqual(["resolveWorkspace", "closeWorkspace"]);
    expect(warnings).toEqual([
      "session ledger: could not record the park for a-doc (clock failed) — the act itself went through; the ledger is missing this row",
    ]);
  });

  it("still parks the caller's own session, and warns, when the ledger throws a value whose string form throws", async () => {
    const row = workspaceRow({ n: 1 });
    const { calls, client } = fakeCmux({ workspaces: [row] });
    const { ledger, warnings } = hostileLedger();
    const harness = recordingSessionHarness({
      callerSessionId: "id-1",
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const parked = await harness.park({ mode: "force", target: { session: sessionFromCmux({ workspace: row }) } });

    expect(unwrap(parked).kind).toBe("parked");
    expect(calls.map((c) => c.op)).toEqual(["resolveWorkspace", "closeWorkspace"]);
    expect(warnings).toEqual([
      "session ledger: could not read it to record the park of workspace:1 (a thrown value that could not be read as text) — the act itself went through; the ledger may be missing this row's close",
    ]);
  });

  // Counterexample: a read answering past its type, whose coercion throws.
  it("still parks the caller's own session, and warns, when the ledger read answers a non-key", async () => {
    const row = workspaceRow({ n: 1 });
    const { calls, client } = fakeCmux({ workspaces: [row] });
    const collected = collectingLedger({});
    const hostileKey = {
      [Symbol.toPrimitive]: (): never => {
        throw new Error("coercion");
      },
    } as unknown as string;
    const ledger = { ...collected.ledger, openSessionKey: () => hostileKey };
    const harness = recordingSessionHarness({
      callerSessionId: "id-1",
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const parked = await harness.park({ mode: "force", target: { session: sessionFromCmux({ workspace: row }) } });

    expect(unwrap(parked).kind).toBe("parked");
    expect(calls.map((c) => c.op)).toEqual(["resolveWorkspace", "closeWorkspace"]);
    expect(collected.events).toEqual([]);
    expect(collected.warnings).toEqual([
      "session ledger: could not read it to record the park of workspace:1 (the ledger answered a object, not a session key) — the act itself went through; the ledger may be missing this row's close",
    ]);
  });

  // Counterexample: a read that writes to the session it is handed.
  it("parks and returns the session it was asked to, own or foreign, when the ledger read writes to it", async () => {
    const rows = [workspaceRow({ n: 1 }), workspaceRow({ n: 2 })];
    const { calls, client } = fakeCmux({ workspaces: rows });
    const collected = collectingLedger({});
    const ledger = {
      ...collected.ledger,
      openSessionKey: ({ session }: { session: HarnessSession }): undefined => {
        Object.assign(session, { handle: "workspace:evil", id: "other" });
        return undefined;
      },
    };
    const harness = recordingSessionHarness({
      callerSessionId: "id-1",
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const targets = rows.map((workspace) => sessionFromCmux({ workspace }));
    const parked = [];
    for (const session of targets) {
      parked.push(await harness.park({ mode: "force", target: { session } }));
    }

    expect(parked.map((p) => unwrap(p))).toEqual(
      rows.map((workspace) => ({ forced: true, kind: "parked", session: sessionFromCmux({ workspace }) })),
    );
    expect(targets).toEqual(rows.map((workspace) => sessionFromCmux({ workspace })));
    expect(calls.map((c) => c.op)).toEqual([
      "resolveWorkspace",
      "closeWorkspace",
      "resolveWorkspace",
      "closeWorkspace",
    ]);
    expect(collected.events).toEqual([]);
    // The frozen copy refuses the write, so each park's read fails, and says so once.
    expect(collected.warnings).toEqual(
      ["workspace:1", "workspace:2"].map(
        (handle) =>
          `session ledger: could not read it to record the park of ${handle} (Cannot assign to read only property 'handle' of object '#<Object>') — the act itself went through; the ledger may be missing this row's close`,
      ),
    );
  });

  // Counterexample: a read answering a promise that rejects.
  it("still parks, warns once and leaves no rejection unhandled when the ledger read answers a rejecting promise", async () => {
    const row = workspaceRow({ n: 1 });
    const { calls, client } = fakeCmux({ workspaces: [row] });
    const collected = collectingLedger({});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const rejecting = Promise.reject(new Error("read failed")) as unknown as string;
    const ledger = { ...collected.ledger, openSessionKey: () => rejecting };
    const harness = recordingSessionHarness({
      callerSessionId: "id-1",
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const parked = await harness.park({ mode: "force", target: { session: sessionFromCmux({ workspace: row }) } });
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", onUnhandled);

    expect(unwrap(parked).kind).toBe("parked");
    expect(calls.map((c) => c.op)).toEqual(["resolveWorkspace", "closeWorkspace"]);
    expect(unhandled).toEqual([]);
    expect(collected.warnings).toEqual([
      "session ledger: could not read it to record the park of workspace:1 (the ledger answered a object, not a session key) — the act itself went through; the ledger may be missing this row's close",
    ]);
  });

  it("returns the park unchanged when the ledger fails and the warning sink throws too", async () => {
    const row = workspaceRow({ n: 2 });
    const failingAppend = collectingLedger({ failWith: "ENOSPC", warnFails: "EPIPE" }).ledger;
    const failingRead = collectingLedger({ unreadable: "EACCES", warnFails: "EPIPE" }).ledger;
    const kinds: string[] = [];
    for (const ledger of [failingAppend, failingRead]) {
      const { client } = fakeCmux({ workspaces: [row] });
      const harness = recordingSessionHarness({
        callerSessionId: undefined,
        harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
        ledger,
      });
      const parked = await harness.park({ mode: "force", target: { session: sessionFromCmux({ workspace: row }) } });
      kinds.push(unwrap(parked).kind);
    }

    expect(kinds).toEqual(["parked", "parked"]);
  });

  it("warns, rather than reading it as untracked, when the ledger cannot be read", async () => {
    const row = workspaceRow({ n: 2 });
    const { client } = fakeCmux({ workspaces: [row] });
    const { events, ledger, warnings } = collectingLedger({ unreadable: "EACCES: permission denied" });
    const harness = recordingSessionHarness({
      callerSessionId: undefined,
      harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }),
      ledger,
    });
    const parked = await harness.park({ mode: "force", target: { session: sessionFromCmux({ workspace: row }) } });

    expect(unwrap(parked).kind).toBe("parked");
    expect(events).toEqual([]);
    expect(warnings).toEqual([
      "session ledger: could not read it to record the park of workspace:2 (EACCES: permission denied) — the act itself went through; the ledger may be missing this row's close",
    ]);
  });
});
