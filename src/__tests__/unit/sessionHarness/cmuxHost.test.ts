/**
 * The cmux host surface: the inventory answers through the harness in cmux's row shape and with the harness's own
 * errors, every raw operation reaches the client it was built over unchanged, and the reach never interrupts.
 */
import { describe, expect, it } from "vitest";

import type { CmuxClient } from "../../../cmux/client.js";
import { type CmuxError, CmuxErrors } from "../../../cmux/errors.js";
import { err, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { cmuxSessionHarnessOver } from "../../../sessionHarness/cmuxHarness.js";
import { cmuxHostSurfaceOver, listCmuxWorkspacesThrough } from "../../../sessionHarness/cmuxHost.js";
import { fakeCmux, hostOverFake, INSTANT_WAITS, RUNNING_SCREEN, workspaceRow } from "./fakeCmux.js";

/**
 * The failure a raw operation's fake answers, naming the operation — so a forward that reached the wrong client
 * method reads as a different error.
 *
 * @param method the client method the fake stands in for
 * @returns the error
 */
function failureOf({ method }: { method: string }): CmuxError {
  return CmuxErrors.callFailed({ cmuxCode: "scripted", message: `scripted ${method}`, method });
}

/**
 * The message of the failure one raw operation answered.
 *
 * @param answer the operation's pending answer, which must be a failure
 * @returns that failure's message
 */
async function messageOf({ answer }: { answer: Promise<Result<unknown, CmuxError>> }): Promise<string> {
  return unwrapErr(await answer).message;
}

/**
 * A client whose every raw operation answers its own named failure, over the plain fake's inventory.
 *
 * @returns the client
 */
function rawFailingClient(): CmuxClient {
  const answer =
    ({ method }: { method: string }) =>
    () =>
      Promise.resolve(err(failureOf({ method })));
  return {
    ...fakeCmux({ workspaces: [workspaceRow({ n: 1 })] }).client,
    closeWorkspace: answer({ method: "closeWorkspace" }),
    listWorkspacesStrict: answer({ method: "listWorkspacesStrict" }),
    pinWorkspace: answer({ method: "pinWorkspace" }),
    processTree: answer({ method: "processTree" }),
    readResumeBinding: answer({ method: "readResumeBinding" }),
    readScreen: answer({ method: "readScreen" }),
    readScreenGrid: answer({ method: "readScreenGrid" }),
    renameWorkspace: answer({ method: "renameWorkspace" }),
    sendLine: answer({ method: "sendLine" }),
    submitComposer: answer({ method: "submitComposer" }),
    topologyStrict: answer({ method: "topologyStrict" }),
    unpinWorkspace: answer({ method: "unpinWorkspace" }),
    workspaceTop: answer({ method: "workspaceTop" }),
  };
}

describe("cmux host inventory", () => {
  it("lists every live session as cmux's own rows, in cmux's order", async () => {
    const rows = [workspaceRow({ n: 3 }), workspaceRow({ n: 1 })];
    const { client } = fakeCmux({ workspaces: rows });
    expect(unwrap(await hostOverFake({ client }).listWorkspaces())).toEqual(rows);
  });

  it("resolves a handle to the row it names", async () => {
    const { client } = fakeCmux({ workspaces: [workspaceRow({ n: 2 })] });
    expect(unwrap(await hostOverFake({ client }).resolveWorkspace({ ref: "workspace:2" }))).toEqual(
      workspaceRow({ n: 2 }),
    );
  });

  it("answers a handle naming nothing with the harness's SESSION_NOT_FOUND, not cmux's CALL_FAILED", async () => {
    const { client } = fakeCmux({ workspaces: [workspaceRow({ n: 2 })] });
    const failure = unwrapErr(await hostOverFake({ client }).resolveWorkspace({ ref: "workspace:9" }));
    expect(failure.code).toBe("SESSION_NOT_FOUND");
  });

  it("keeps cmux's access refusal distinct from an unreachable socket across the seam", async () => {
    const refused = fakeCmux({
      listFailure: CmuxErrors.accessDenied({ refusal: "cmuxOnly", socketPath: "/tmp/cmux.sock" }),
    });
    const down = fakeCmux({ listFailure: CmuxErrors.socketUnavailable({ detail: "ENOENT", socketPath: undefined }) });
    const refusedFailure = unwrapErr(await hostOverFake({ client: refused.client }).listWorkspaces());
    const downFailure = unwrapErr(await hostOverFake({ client: down.client }).listWorkspaces());
    expect([refusedFailure, downFailure].map((failure) => [failure.code, "accessDenied" in failure])).toEqual([
      ["HARNESS_UNAVAILABLE", true],
      ["HARNESS_UNAVAILABLE", false],
    ]);
  });

  it("lists through any harness's list, rebuilt as rows", async () => {
    const { client, calls } = fakeCmux({ workspaces: [workspaceRow({ n: 4 })] });
    const harness = cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS });
    expect(unwrap(await listCmuxWorkspacesThrough({ harness }))).toEqual([workspaceRow({ n: 4 })]);
    expect(calls).toEqual([{ op: "listWorkspaces" }]);
  });
});

describe("cmux host raw operations", () => {
  it("forwards every raw operation to the client it was built over, answer unchanged", async () => {
    const client = rawFailingClient();
    const host = cmuxHostSurfaceOver({ client, harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }) });
    const target = { workspaceId: "id-1" };
    const messages = await Promise.all([
      messageOf({ answer: host.closeWorkspace({ force: true, workspaceId: "id-1" }) }),
      messageOf({ answer: host.listWorkspacesStrict() }),
      messageOf({ answer: host.pinWorkspace({ workspaceId: "id-1" }) }),
      messageOf({ answer: host.processTree({ workspaceId: "id-1" }) }),
      messageOf({ answer: host.readResumeBinding({ workspaceId: "id-1" }) }),
      messageOf({ answer: host.readScreen({ target }) }),
      messageOf({ answer: host.readScreenGrid({ target }) }),
      messageOf({ answer: host.renameWorkspace({ title: "t", workspaceId: "id-1" }) }),
      messageOf({ answer: host.sendLine({ target, text: "x" }) }),
      messageOf({ answer: host.submitComposer({ target }) }),
      messageOf({ answer: host.topologyStrict() }),
      messageOf({ answer: host.unpinWorkspace({ workspaceId: "id-1" }) }),
      messageOf({ answer: host.workspaceTop({ workspaceId: "id-1" }) }),
    ]);
    expect(messages).toEqual(
      [
        "closeWorkspace",
        "listWorkspacesStrict",
        "pinWorkspace",
        "processTree",
        "readResumeBinding",
        "readScreen",
        "readScreenGrid",
        "renameWorkspace",
        "sendLine",
        "submitComposer",
        "topologyStrict",
        "unpinWorkspace",
        "workspaceTop",
      ].map((method) => failureOf({ method }).message),
    );
  });

  it("reaches a session mid-turn without interrupting it", async () => {
    const { client, calls } = fakeCmux({ screens: [RUNNING_SCREEN], workspaces: [workspaceRow({ n: 1 })] });
    const outcome = unwrap(
      await hostOverFake({ client }).reachSession({
        target: { workspaceId: "id-1" },
        text: "hello",
        waits: INSTANT_WAITS,
      }),
    );
    expect(outcome.interrupted).toBe(false);
    expect(calls.filter((call) => call.op === "interruptTurn" || call.op === "sendLine")).toEqual([
      { op: "sendLine", text: "hello", workspaceId: "id-1" },
    ]);
  });
});
