/**
 * Identifying the pinned supervisor workspace, and the refusal `cmux send`'s verb-level check builds from it.
 */
import { describe, expect, it } from "vitest";

import {
  isPinnedSupervisorWorkspace,
  SUPERVISOR_WORKSPACE_TITLE,
  supervisorSendRefusal,
  supervisorSendRefusalMessage,
} from "../../../cmux/supervisorWorkspace.js";

describe("isPinnedSupervisorWorkspace", () => {
  it("is true when pinned and titled the fixed supervisor title", () => {
    expect(isPinnedSupervisorWorkspace({ pinned: true, title: SUPERVISOR_WORKSPACE_TITLE })).toBe(true);
  });

  it("is false when titled correctly but not pinned", () => {
    expect(isPinnedSupervisorWorkspace({ pinned: false, title: SUPERVISOR_WORKSPACE_TITLE })).toBe(false);
  });

  it("is false when pinned but titled something else", () => {
    expect(isPinnedSupervisorWorkspace({ pinned: true, title: "some other title" })).toBe(false);
  });

  it("is false when pinned with no title at all", () => {
    expect(isPinnedSupervisorWorkspace({ pinned: true, title: undefined })).toBe(false);
  });
});

const SUPERVISOR = {
  pinned: true,
  title: SUPERVISOR_WORKSPACE_TITLE,
  workspaceId: "ws-super-id",
  workspaceRef: "workspace:936",
};

describe("supervisorSendRefusal", () => {
  it("refuses a send at the pinned supervisor from a different workspace", () => {
    const refusal = supervisorSendRefusal({ callerWorkspaceId: "ws-other-id", target: SUPERVISOR });
    expect(refusal!.message).toBe(supervisorSendRefusalMessage({ workspaceRef: "workspace:936" }));
  });

  it("refuses when the caller's own workspace id is unknown", () => {
    const refusal = supervisorSendRefusal({ callerWorkspaceId: undefined, target: SUPERVISOR });
    expect(refusal!.message).toBe(supervisorSendRefusalMessage({ workspaceRef: "workspace:936" }));
  });

  it("allows the pinned supervisor to send to itself", () => {
    expect(supervisorSendRefusal({ callerWorkspaceId: "ws-super-id", target: SUPERVISOR })).toBeUndefined();
  });

  it("allows a send at an ordinary, unpinned workspace", () => {
    const target = { pinned: false, title: "some worker", workspaceId: "ws-worker", workspaceRef: "workspace:1" };
    expect(supervisorSendRefusal({ callerWorkspaceId: "ws-other-id", target })).toBeUndefined();
  });

  it("allows a send at a pinned workspace with a different title", () => {
    const target = { pinned: true, title: "not the supervisor", workspaceId: "ws-x", workspaceRef: "workspace:2" };
    expect(supervisorSendRefusal({ callerWorkspaceId: "ws-other-id", target })).toBeUndefined();
  });
});
