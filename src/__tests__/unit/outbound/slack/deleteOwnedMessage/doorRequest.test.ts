/*
 * The owned delete's door request and the gates it composes with.
 *
 * The door's `hold` arm is unreachable through this operation TODAY, and that is asserted rather than
 * skipped: `ownedDeleteGates()` is `DEFAULT_GATES` (empty) plus the voice gate under `NO_AUTHORED_PROSE`,
 * which returns no findings on a send with no authored prose. The test below admits the real request
 * through the real `admitDoor`, so the day a gate is added that can hold a delete, it reddens here.
 */
import { describe, expect, it } from "vitest";

import { admitDoor } from "../../../../../admit/door.js";
import { ownedDeleteDoorRequest, ownedDeleteGates } from "../../../../../outbound/slack/deleteOwnedMessage.js";
import { TARGET } from "./harness.js";

describe("the door request and its gates", () => {
  it("is always the `slack delete` verb, an external write needing no approval", () => {
    const request = ownedDeleteDoorRequest({ actor: "bot", home: "/tmp/h", targetTs: TARGET.ts });

    expect(request.action).toEqual({ kind: "verb", noun: "slack", verb: "delete" });
    expect(request.artifact).toEqual({ actor: "bot", targetTs: TARGET.ts });
    expect(request.meta.effect).toBe("external-write");
    expect(request.meta.requiresApproval).toBe(false);
  });

  it("carries the actor so an automatic delete is never audited as a hand-typed one", () => {
    expect(ownedDeleteDoorRequest({ actor: "me", home: "/tmp/h", targetTs: TARGET.ts }).artifact["actor"]).toBe("me");
  });

  it("admits a real delete today — the composition has no gate that can hold one", () => {
    const decision = admitDoor({
      env: {},
      gates: ownedDeleteGates(),
      request: ownedDeleteDoorRequest({ actor: "bot", home: "/tmp/h", targetTs: TARGET.ts }),
    });

    expect(decision.status).toBe("pass");
    expect(decision.findings).toEqual([]);
  });
});
