/**
 * The cmux session harness: each contract operation drives the cmux client in exactly the order the `cmux`
 * verbs did before the seam, and the one delivery cmux cannot honour, `later`, is refused before anything
 * touches the session.
 */
import { describe, expect, it } from "vitest";

import { describeComposer, readComposer } from "../../../cmux/composer.js";
import { CmuxErrors } from "../../../cmux/errors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { cmuxSessionHarnessOver } from "../../../sessionHarness/cmuxHarness.js";
import { sessionFromCmux } from "../../../sessionHarness/cmuxSession.js";
import type { HarnessTarget } from "../../../sessionHarness/sessionHarness.js";
import {
  CONFIRMATION_REQUIRED,
  fakeCmux,
  IDLE_SCREEN,
  INSTANT_WAITS,
  PLACEHOLDER_GRID,
  RUNNING_SCREEN,
  workspaceRow,
} from "./fakeCmux.js";

const TARGET: HarnessTarget = { session: sessionFromCmux({ workspace: workspaceRow({ n: 2 }) }) };

describe("cmux harness list and resolve", () => {
  it("lists every workspace in cmux's order, as sessions", async () => {
    const { client } = fakeCmux({ workspaces: [workspaceRow({ n: 3 }), workspaceRow({ n: 1 })] });
    const sessions = unwrap(await cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }).list());
    expect(sessions.map((session) => session.handle)).toEqual(["workspace:3", "workspace:1"]);
    expect(sessions[0]!.id).toBe("id-3");
    expect(sessions[0]!.directory).toBe("/work/tree-3");
    expect(sessions[0]!.groupId).toBe("window-a");
  });

  it("resolves a handle to its session and carries the chosen endpoint", async () => {
    const { client } = fakeCmux({ workspaces: [workspaceRow({ n: 2 })] });
    const harness = cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS });
    const target = unwrap(await harness.resolve({ endpointId: "surface-x", handle: "workspace:2" }));
    expect(target.session.id).toBe("id-2");
    expect(target.endpointId).toBe("surface-x");
  });

  it("answers a handle naming nothing with SESSION_NOT_FOUND, keeping cmux's words", async () => {
    const { client } = fakeCmux({ workspaces: [workspaceRow({ n: 2 })] });
    const failure = unwrapErr(
      await cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }).resolve({ handle: "workspace:9" }),
    );
    expect(failure.code).toBe("SESSION_NOT_FOUND");
    expect(failure.message).toBe(
      "cmux workspace.list failed (not_found): no live cmux workspace answers to workspace:9",
    );
  });

  it("answers an unreachable socket with HARNESS_UNAVAILABLE, keeping cmux's words", async () => {
    const listFailure = CmuxErrors.socketUnavailable({ detail: "connect ENOENT", socketPath: "/tmp/cmux.sock" });
    const { client } = fakeCmux({ listFailure });
    const failure = unwrapErr(await cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }).list());
    expect(failure.code).toBe("HARNESS_UNAVAILABLE");
    expect(failure.message).toBe(listFailure.message);
  });
});

describe("cmux harness message", () => {
  it("delivers `turn` without interrupting, then reads what the screen says", async () => {
    const { calls, client } = fakeCmux({ screens: [IDLE_SCREEN] });
    const harness = cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS });
    const outcome = unwrap(await harness.message({ delivery: "turn", target: TARGET, text: "hello" }));
    const reading = readComposer({ grid: PLACEHOLDER_GRID });
    expect(reading.kind).toBe("placeholder");
    expect(outcome).toEqual({
      disposition: "submitted",
      inputDetail: describeComposer({ reading }),
      interrupted: false,
    });
    expect(calls).toEqual([
      { op: "sendLine", text: "hello", workspaceId: "id-2" },
      { op: "readScreen" },
      { op: "readScreenGrid" },
    ]);
  });

  it("delivers `now` by interrupting a visibly running turn BEFORE the line goes in", async () => {
    const { calls, client } = fakeCmux({ screens: [RUNNING_SCREEN, IDLE_SCREEN] });
    const harness = cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS });
    const outcome = unwrap(await harness.message({ delivery: "now", target: TARGET, text: "stop that" }));
    expect(outcome.interrupted).toBe(true);
    expect(calls.findIndex((call) => call.op === "interruptTurn")).toBe(1);
    expect(calls.findIndex((call) => call.op === "sendLine")).toBeGreaterThan(1);
  });

  it("refuses `later` with DELIVERY_UNSUPPORTED and never touches the session", async () => {
    const { calls, client } = fakeCmux({ screens: [IDLE_SCREEN] });
    const harness = cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS });
    const failure = unwrapErr(await harness.message({ delivery: "later", target: TARGET, text: "after the turn" }));
    expect(failure.code).toBe("DELIVERY_UNSUPPORTED");
    expect(failure.message).toContain('cannot honour delivery "later"');
    expect(failure.message).toContain("nothing was sent");
    expect(calls).toEqual([]);
  });
});

describe("cmux harness interrupt", () => {
  it("presses one interrupt at the chosen endpoint and reads nothing", async () => {
    const { calls, client } = fakeCmux({});
    const harness = cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS });
    unwrap(await harness.interrupt({ target: { ...TARGET, endpointId: "surface-x" } }));
    expect(calls).toEqual([{ op: "interruptTurn", surfaceId: "surface-x", workspaceId: "id-2" }]);
  });
});

describe("cmux harness pressStop", () => {
  it("refuses, touching nothing, since a cmux workspace draws no Stop control", async () => {
    const { calls, client } = fakeCmux({});
    const failure = unwrapErr(
      await cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }).pressStop({ target: TARGET }),
    );
    expect(failure).toEqual({
      causeCode: "NO_STOP_CONTROL",
      code: "HARNESS_OPERATION_FAILED",
      message: "a cmux workspace has no Stop control to press; close it with cmux close",
      operation: "press-stop",
    });
    expect(calls).toEqual([]);
  });
});

describe("cmux harness close", () => {
  it("closes unforced in one call when cmux takes it", async () => {
    const { calls, client } = fakeCmux({});
    const outcome = unwrap(await cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }).close({ target: TARGET }));
    expect(outcome).toEqual({ forced: false, kind: "closed" });
    expect(calls).toEqual([{ force: false, op: "closeWorkspace" }]);
  });

  it("forces once, after one screen read, only on cmux's confirmation and an idle prompt", async () => {
    const { calls, client } = fakeCmux({
      close: { forced: undefined, plain: CONFIRMATION_REQUIRED },
      screens: [IDLE_SCREEN],
    });
    const outcome = unwrap(await cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }).close({ target: TARGET }));
    expect(outcome).toEqual({ forced: true, kind: "closed" });
    expect(calls).toEqual([
      { force: false, op: "closeWorkspace" },
      { op: "readScreen" },
      { force: true, op: "closeWorkspace" },
    ]);
  });

  it("holds a busy session open, naming why, and never forces", async () => {
    const { calls, client } = fakeCmux({
      close: { forced: undefined, plain: CONFIRMATION_REQUIRED },
      screens: [RUNNING_SCREEN],
    });
    const outcome = unwrap(await cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }).close({ target: TARGET }));
    expect(outcome).toEqual({ kind: "held", reason: "busy" });
    expect(calls.filter((call) => call.op === "closeWorkspace")).toEqual([{ force: false, op: "closeWorkspace" }]);
  });

  it("holds an unreadable screen open", async () => {
    const { client } = fakeCmux({ close: { forced: undefined, plain: CONFIRMATION_REQUIRED }, screens: [undefined] });
    const outcome = unwrap(await cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }).close({ target: TARGET }));
    expect(outcome).toEqual({ kind: "held", reason: "unreadable" });
  });

  it("maps any other close failure at the boundary, cmux's message kept", async () => {
    const plain = CmuxErrors.timedOut({ method: "workspace.close", timeoutMs: 5000 });
    const { client } = fakeCmux({ close: { forced: undefined, plain } });
    const failure = unwrapErr(await cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }).close({ target: TARGET }));
    expect(failure.code).toBe("HARNESS_OPERATION_FAILED");
    expect(failure.message).toBe("cmux workspace.close did not answer within 5000ms");
  });
});
