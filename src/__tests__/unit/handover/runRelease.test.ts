/**
 * `releaseWhyOf` — which events release the writer the ownership fold holds, and the reason each reads as.
 * The fold itself is `./runOwner/writerOf.test.ts`'s; this pins the one case it now asks.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { releaseWhyOf } from "../../../handover/runRelease.js";

const PARKED: RunEvent = {
  atIso: "2026-10-04T04:00:00.000Z",
  branch: "feat/x",
  kind: "parked",
  question: "Which slide order?",
  screenTail: "❯ ",
  sessionId: "session-a",
  workspaceRef: "workspace:9",
  worktree: "/wt",
};

describe("releaseWhyOf", () => {
  it("reads a self-release as its own reason", () => {
    const released: RunEvent = {
      atIso: "2026-10-04T04:00:00.000Z",
      kind: "released",
      sessionId: "session-a",
      why: "handing off",
    };

    expect(releaseWhyOf({ event: released, holder: "session-a" })).toBe("handing off");
  });

  it("reads a park as where the seat stood", () => {
    expect(releaseWhyOf({ event: PARKED, holder: "session-a" })).toBe(
      "parked at rest and closed workspace:9; a reseat reopens /wt, else rebuilds it from feat/x",
    );
  });

  it("releases nobody when the event names another session", () => {
    expect(releaseWhyOf({ event: PARKED, holder: "session-b" })).toBe(undefined);
  });

  it("releases nobody when the fold holds no writer", () => {
    expect(releaseWhyOf({ event: PARKED, holder: undefined })).toBe(undefined);
  });
});
