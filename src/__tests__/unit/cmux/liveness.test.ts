/**
 * Classifying a recorded workspace — the question a dispatch record cannot answer about itself.
 *
 * Every case here is a plain call on the PURE half, with process trees built inline: the module's own header
 * states the direction it must never get wrong (a false `phantom` resurfaces an ask a real session is
 * working on), and that direction is what these assert.
 */
import { describe, expect, it } from "vitest";

import type { CmuxProcess } from "../../../cmux/client.js";
import type { CmuxError } from "../../../cmux/errors.js";
import { classifyWorkspaceLiveness, isWorkspaceNotFound, workspaceGone } from "../../../cmux/liveness.js";

/** One process in a tree, children defaulted to none. */
function proc({
  name,
  pid,
  children = [],
}: {
  name: string;
  pid: number;
  children?: readonly CmuxProcess[];
}): CmuxProcess {
  return { children, name, pid };
}

describe("classifyWorkspaceLiveness", () => {
  // MEASURED across all 26 live workspaces: cmux reports a live Claude Code process's `name` as
  // its VERSION string, never `claude`, so the check asks the inverse — anything that is not a shell or the
  // keepalive `sleep`.
  it("calls a version-named host alive, which a binary-name check would have called a phantom", () => {
    expect(
      classifyWorkspaceLiveness({ processes: [proc({ name: "2.1.241", pid: 4242 })], workspaceId: "ws:1" }),
    ).toEqual({ kind: "alive", pid: 4242, process: "2.1.241", workspaceId: "ws:1" });
  });

  it("searches the whole tree, so a host hanging off the surface's own shell is alive", () => {
    const tree = [proc({ children: [proc({ name: "2.1.241", pid: 99 })], name: "-zsh", pid: 10 })];

    expect(classifyWorkspaceLiveness({ processes: tree, workspaceId: "ws:1" })).toEqual({
      kind: "alive",
      pid: 99,
      process: "2.1.241",
      workspaceId: "ws:1",
    });
  });

  it("calls a tree of nothing but an idle shell and cmux's keepalive sleep a host-exited phantom", () => {
    const tree = [proc({ name: "-zsh", pid: 10 }), proc({ name: "sleep", pid: 11 })];
    const verdict = classifyWorkspaceLiveness({ processes: tree, workspaceId: "ws:7" });

    expect(verdict.kind).toBe("phantom");
    expect(verdict).toEqual({
      kind: "phantom",
      reason: "cmux still lists workspace ws:7, but nothing is running in it beyond an idle shell — the host exited",
      why: "host-exited",
      workspaceId: "ws:7",
    });
  });

  it("calls an empty tree a host-exited phantom rather than unknown", () => {
    expect(classifyWorkspaceLiveness({ processes: [], workspaceId: "ws:7" }).kind).toBe("phantom");
  });
});

describe("workspaceGone", () => {
  it("names the recorded id in its reason, so a reader can check the claim", () => {
    expect(workspaceGone({ workspaceId: "ws:404" })).toEqual({
      kind: "phantom",
      reason: "cmux has no workspace ws:404 — the workspace this dispatch recorded is gone",
      why: "workspace-gone",
      workspaceId: "ws:404",
    });
  });
});

describe("isWorkspaceNotFound", () => {
  it("reads the cmux CODE, never the English of the message", () => {
    const error: CmuxError = {
      cmuxCode: "not_found",
      code: "CALL_FAILED",
      message: "anything at all",
      method: "resolveWorkspace",
    };

    expect(isWorkspaceNotFound({ error })).toBe(true);
  });

  it("calls any other cmux code a broken oracle rather than an absent workspace", () => {
    const error: CmuxError = {
      cmuxCode: "internal",
      code: "CALL_FAILED",
      message: "workspace not found",
      method: "resolveWorkspace",
    };

    expect(isWorkspaceNotFound({ error })).toBe(false);
  });
});
