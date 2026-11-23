/** The pin collision rule — cmux itself enforces none, so this is the whole safety property. */
import { describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { listedPinTarget, PinRefusals, pinCollisionRefusal } from "../../../cmux/pin.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One workspace row with just the fields this decision reads. */
function workspace(
  over: Partial<CmuxWorkspaceSummary> & { workspaceId: string; workspaceRef: string },
): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/repo",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: undefined,
    windowId: "window:1",
    ...over,
  };
}

describe("pinCollisionRefusal", () => {
  it("proceeds when nothing is pinned", () => {
    const workspaces = [workspace({ workspaceId: "A", workspaceRef: "workspace:1" })];

    expect(pinCollisionRefusal({ targetWorkspaceId: "A", workspaces })).toBeUndefined();
  });

  it("proceeds when the target itself is the only one pinned", () => {
    const workspaces = [workspace({ pinned: true, workspaceId: "A", workspaceRef: "workspace:1" })];

    expect(pinCollisionRefusal({ targetWorkspaceId: "A", workspaces })).toBeUndefined();
  });

  it("refuses, naming the other workspace, when a DIFFERENT one is already pinned", () => {
    const workspaces = [
      workspace({ pinned: true, workspaceId: "A", workspaceRef: "workspace:1" }),
      workspace({ pinned: false, workspaceId: "B", workspaceRef: "workspace:2" }),
    ];

    const refusal = pinCollisionRefusal({ targetWorkspaceId: "B", workspaces });

    expect(refusal?.message).toBe(
      "workspace:1 is already pinned — a fleet with two pinned workspaces breaks the supervisor check, " +
        "so unpin it first: slopweaver cmux unpin --workspace workspace:1",
    );
  });

  it("is unaffected by a THIRD unpinned workspace in the inventory", () => {
    const workspaces = [
      workspace({ pinned: true, workspaceId: "A", workspaceRef: "workspace:1" }),
      workspace({ pinned: false, workspaceId: "B", workspaceRef: "workspace:2" }),
      workspace({ pinned: false, workspaceId: "C", workspaceRef: "workspace:3" }),
    ];

    expect(pinCollisionRefusal({ targetWorkspaceId: "B", workspaces })?.message).toContain("workspace:1");
  });
});

describe("listedPinTarget", () => {
  it("answers the target's own listing, so the pin is recorded under its ref", () => {
    const workspaces = [
      workspace({ workspaceId: "A", workspaceRef: "workspace:1" }),
      workspace({ workspaceId: "B", workspaceRef: "workspace:2" }),
    ];

    expect(unwrap(listedPinTarget({ targetWorkspaceId: "B", workspaces })).workspaceRef).toBe("workspace:2");
  });

  it("refuses a target cmux does not list, before anything is pinned", () => {
    const workspaces = [workspace({ workspaceId: "A", workspaceRef: "workspace:1" })];

    expect(unwrapErr(listedPinTarget({ targetWorkspaceId: "Z", workspaces }))).toEqual(
      PinRefusals.workspaceNotListed({ workspaceId: "Z" }),
    );
    expect(unwrapErr(listedPinTarget({ targetWorkspaceId: "Z", workspaces })).message).toBe(
      "Z is not among the workspaces cmux lists, so there is nothing live to pin — run slopweaver cmux list and name one it shows",
    );
  });
});
