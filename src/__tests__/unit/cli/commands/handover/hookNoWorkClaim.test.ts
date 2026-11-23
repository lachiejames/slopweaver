import { describe, expect, it } from "vitest";

import {
  lastAssistantMessageOf,
  type NoWorkClaimStopSeams,
  noWorkClaimStopLines,
} from "../../../../../cli/commands/handover/hookNoWorkClaim.js";

/** A board holding 2 open rows: 0 ready, 2 held only for naming no repo:. */
const OPEN_BOARD = {
  held: [
    { id: "land-acme-1", standing: "blocked" },
    { id: "land-acme-2", standing: "blocked" },
  ],
  rankedCount: 2,
  ready: [],
  repolessRows: ["land-acme-1", "land-acme-2"],
  trunkMovedRows: [],
};

/** Seams for the pinned chair over {@link OPEN_BOARD}, each overridable. */
const seamsOf = (over: Partial<NoWorkClaimStopSeams> = {}): NoWorkClaimStopSeams => ({
  hatchIsOpen: () => false,
  isPinnedChair: ({ sessionId }) => sessionId === "chair",
  lastReconciliation: () => OPEN_BOARD,
  ...over,
});

const CLAIM = "the queue was empty, so nothing to seat";

describe("noWorkClaimStopLines", () => {
  it("refuses the pinned chair's no-work reply over open rows, naming both claims", () => {
    const lines = noWorkClaimStopLines({ lastMessage: CLAIM, seams: seamsOf(), sessionId: "chair" });

    expect(lines).toContain('  your last reply: "nothing to seat"');
    expect(lines).toContain('  your last reply: "the queue was empty"');
    expect(lines[0]).toContain(
      "(your last reply says there is no work while the reconciliation it read holds 2 open: 0 ready, 2 held only " +
        "for naming no repo: (handover set-repo <slug> --repo <dir>)).",
    );
  });

  it.each([
    ["a session that is not the pinned chair", { sessionId: "seat" }],
    ["no session id", { sessionId: undefined }],
    ["no message", { lastMessage: undefined }],
    ["an empty message", { lastMessage: "" }],
    ["a message that is not a string", { lastMessage: 7 }],
    ["a reply that claims nothing", { lastMessage: "2 open: 0 ready, 2 held only for naming no repo:" }],
    ["no reading", { seams: seamsOf({ lastReconciliation: () => undefined }) }],
    ["a reading that will not decode", { seams: seamsOf({ lastReconciliation: () => ({ rankedCount: 2 }) }) }],
    ["the hatch open", { seams: seamsOf({ hatchIsOpen: () => true }) }],
    [
      "an empty board",
      {
        seams: seamsOf({
          lastReconciliation: () => ({ held: [], rankedCount: 0, ready: [], repolessRows: [], trunkMovedRows: [] }),
        }),
      },
    ],
  ])("is silent for %s", (_name, over) => {
    expect(noWorkClaimStopLines({ lastMessage: CLAIM, seams: seamsOf(), sessionId: "chair", ...over })).toEqual([]);
  });

  it("never reads the reconciliation for a session that is not the chair", () => {
    const reads: string[] = [];
    const seams = seamsOf({
      isPinnedChair: () => false,
      lastReconciliation: () => {
        reads.push("read");
        return OPEN_BOARD;
      },
    });

    noWorkClaimStopLines({ lastMessage: CLAIM, seams, sessionId: "seat" });

    expect(reads).toEqual([]);
  });
});

describe("lastAssistantMessageOf", () => {
  it("reads the payload field, and nothing from a payload without one", () => {
    expect([
      lastAssistantMessageOf({ payload: { last_assistant_message: "hi" } }),
      lastAssistantMessageOf({ payload: { hook_event_name: "Stop" } }),
      lastAssistantMessageOf({ payload: "not an object" }),
      lastAssistantMessageOf({ payload: null }),
    ]).toEqual(["hi", undefined, undefined, undefined]);
  });
});
