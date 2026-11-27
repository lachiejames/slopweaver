/**
 * `cmux reseat`'s refusals say what happened to the seat and what to do next, since a reseat is run in a crisis.
 */
import { describe, expect, it } from "vitest";

import { ReseatErrors } from "../../../sessions/reseatErrors.js";

describe("ReseatErrors", () => {
  it("says a kill timeout typed nothing, and carries the pid", () => {
    const error = ReseatErrors.killTimeout({ pid: 393, seconds: 15 });

    expect(error.code).toBe("KILL_TIMEOUT");
    expect(error.pid).toBe(393);
    expect(error.message).toContain("nothing was typed into the surface");
  });

  it("names the override a typed Fable on a worker needs", () => {
    expect(ReseatErrors.modelRefused({ model: "fable" }).message).toContain("ALLOW_FABLE_OVERRIDE=1");
  });

  it("names every live session id in an ambiguous workspace", () => {
    const error = ReseatErrors.ambiguousSession({ sessionIds: ["a", "b"] });

    expect(error.sessionIds).toEqual(["a", "b"]);
    expect(error.message).toContain("2 live Claude sessions run in this workspace (a, b)");
  });

  it("quotes an unsafe session id rather than echoing it raw", () => {
    expect(ReseatErrors.unsafeSessionId({ sessionId: "x; rm" }).message).toContain('"x; rm"');
  });

  // A send cmux failed, and a sent line no session confirmed, each ended in
  // "read the screen" with no way back.
  it("names the tab to read and the verb to run again when the send failed, before and after a stop", () => {
    expect(
      ReseatErrors.relaunchFailed({
        afterStop: false,
        cause: "socket closed",
        step: "typing the relaunch line",
        workspaceRef: "workspace:3",
      }).message,
    ).toBe(
      "typing the relaunch line failed: socket closed — read workspace:3's screen: a bare prompt means nothing landed, so run `slopweaver cmux reseat workspace:3` again; a half-typed line is cleared by hand first",
    );
    expect(
      ReseatErrors.relaunchFailed({
        afterStop: true,
        cause: "socket closed",
        step: "typing the relaunch line",
        workspaceRef: "workspace:3",
      }).message,
    ).toBe(
      "typing the relaunch line failed: socket closed — the old claude is already stopped; read workspace:3's screen: a bare prompt means nothing landed, so run `slopweaver cmux reseat workspace:3` again; a half-typed line is cleared by hand first",
    );
  });

  it("names each way back from a sent line no live session confirmed", () => {
    expect(ReseatErrors.unconfirmed({ seconds: 60, sessionId: "abc", workspaceRef: "workspace:3" }).message).toBe(
      "the relaunch line was sent, and no live session carrying abc stood in workspace:3 at a Claude composer within 60s — read workspace:3's screen: a claude still booting confirms itself on the next `slopweaver fleet resume`; a bare prompt means the line was lost, so run `slopweaver cmux reseat workspace:3` again; anything else received the line, so stop it by hand first",
    );
  });

  // After a cmux restart the owner opened a second tab in the chair's workspace and was told to retry the read; a
  // rerun never clears a second tab, so the refusal names the count and the tab to close.
  it("names a split workspace's tab count and the tab to close, carrying the count apart from the prose", () => {
    const error = ReseatErrors.splitSurfaces({ surfaces: 3, workspaceRef: "workspace:3" });

    expect([error.code, error.surfaces, error.message]).toEqual([
      "SPLIT_SURFACES",
      3,
      "cmux reports 3 tabs (surfaces) in workspace:3, and a typed line would reach only the selected one, so nothing was typed — close the extra tabs in workspace:3 until one is left, then run `slopweaver fleet resume` from a different cmux workspace (another entry in the sidebar)",
    ]);
  });

  // Every tab of one workspace carries the same CMUX_WORKSPACE_ID, so "another tab" sent the owner nowhere new.
  it("sends a reseat of the caller's own workspace to a different workspace, never another tab of it", () => {
    expect(ReseatErrors.ownWorkspace({ workspaceRef: "workspace:3" }).message).toBe(
      "workspace:3 is the workspace this command runs in, and stopping its claude would stop this command — run it from a different cmux workspace (another entry in the sidebar), not another tab in workspace:3",
    );
  });
});
