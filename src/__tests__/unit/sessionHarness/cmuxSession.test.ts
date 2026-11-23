/**
 * The cmux harness's pure translations: a workspace row survives the trip to a session and back with its
 * JSON byte-identical (`cmux list --json` readers key on it), a target addresses by id, the delivery flag maps
 * as `cmux send` always meant it, and a cmux failure keeps its message across the boundary.
 */
import { describe, expect, it } from "vitest";

import { CmuxErrors } from "../../../cmux/errors.js";
import {
  cmuxTargetOf,
  cmuxWorkspaceFromSession,
  harnessErrorFromCmux,
  sessionFromCmux,
} from "../../../sessionHarness/cmuxSession.js";
import { deliveryForInterrupt } from "../../../sessionHarness/delivery.js";
import { workspaceRow } from "./fakeCmux.js";

describe("cmux workspace and harness session", () => {
  it("round-trips a row to the exact same JSON, key order included", () => {
    const row = workspaceRow({ n: 4 });
    const back = cmuxWorkspaceFromSession({ session: sessionFromCmux({ workspace: row }) });
    expect(JSON.stringify(back)).toBe(JSON.stringify(row));
  });

  it("names the row's ref as the handle and its id as the id", () => {
    const session = sessionFromCmux({ workspace: workspaceRow({ n: 4 }) });
    expect(session.handle).toBe("workspace:4");
    expect(session.id).toBe("id-4");
  });
});

describe("cmuxTargetOf", () => {
  it("addresses by id, with the endpoint as the surface only when one was chosen", () => {
    const session = sessionFromCmux({ workspace: workspaceRow({ n: 1 }) });
    expect(cmuxTargetOf({ target: { session } })).toEqual({ workspaceId: "id-1" });
    expect(cmuxTargetOf({ target: { endpointId: "surface-z", session } })).toEqual({
      surfaceId: "surface-z",
      workspaceId: "id-1",
    });
  });
});

describe("deliveryForInterrupt", () => {
  it("maps --interrupt to now and its absence to turn", () => {
    expect(deliveryForInterrupt({ interrupt: true })).toBe("now");
    expect(deliveryForInterrupt({ interrupt: false })).toBe("turn");
  });
});

describe("harnessErrorFromCmux", () => {
  it("reads a not_found only as SESSION_NOT_FOUND when a resolve asked for a handle", () => {
    const error = CmuxErrors.callFailed({ cmuxCode: "not_found", message: "gone", method: "workspace.list" });
    expect(harnessErrorFromCmux({ error, handle: "workspace:7", operation: "resolve" }).code).toBe("SESSION_NOT_FOUND");
    expect(harnessErrorFromCmux({ error, operation: "message" }).code).toBe("HARNESS_OPERATION_FAILED");
  });

  it("keeps the message verbatim and records cmux's code as the cause", () => {
    const error = CmuxErrors.malformedReply({ detail: "no rows", method: "workspace.list" });
    const mapped = harnessErrorFromCmux({ error, operation: "list" });
    expect(mapped).toEqual({
      causeCode: "MALFORMED_REPLY",
      code: "HARNESS_OPERATION_FAILED",
      message: "cmux workspace.list replied with an unusable shape: no rows",
      operation: "list",
    });
  });
});
