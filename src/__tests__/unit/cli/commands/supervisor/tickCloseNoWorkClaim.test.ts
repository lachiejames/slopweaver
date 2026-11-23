import { describe, expect, it } from "vitest";

import {
  closeTextsOf,
  noWorkClaimRefusal,
  noWorkClaimRefusalLines,
} from "../../../../../cli/commands/supervisor/tickCloseNoWorkClaim.js";
import type { TickInput } from "../../../../../supervisor/tickInput.js";

/** A board holding 4 open rows: 1 ready, 2 held only for naming no repo:, 1 waiting on the owner. */
const OPEN_BOARD = {
  held: [
    { id: "land-acme-1", standing: "blocked" },
    { id: "land-acme-2", standing: "blocked" },
    { id: "ask-acme-3", standing: "waiting-on-owner" },
  ],
  rankedCount: 4,
  ready: [{ id: "fix-acme-4" }],
  repolessRows: ["land-acme-1", "land-acme-2"],
  trunkMovedRows: [],
};

/** A tick input with every claim-free text; a test overrides one field to plant a claim. */
const inputOf = (over: Partial<Record<string, unknown>>): TickInput => ({
  actions: [],
  alignmentDetails: [],
  alignmentSummary: "",
  dropCards: [],
  earlierSummary: "",
  foldSummary: "",
  folds: [],
  headline: ["1 ready row seated; 2 held only for naming no repo:, set-repo run on both."],
  judgements: [],
  lede: "Fleet at 3 seats.",
  openPagesReviewed: true,
  shift: null,
  sleeping: false,
  ...over,
});

describe("closeTextsOf", () => {
  it("reaches every string in the template, nested ones too, labelled by path", () => {
    const input = inputOf({
      folds: ["fold one"],
      judgements: [{ claim: "held: nothing to seat", id: "fix-acme-4" }],
      shift: "shift words",
    });

    expect(closeTextsOf({ input }).map(({ label }) => label)).toEqual([
      "folds[0]",
      "headline[0]",
      "judgements[0].claim",
      "judgements[0].id",
      "lede",
      "shift",
    ]);
  });
});

describe("noWorkClaimRefusal", () => {
  it("refuses a hold rationale claiming nothing to seat over open rows, naming the reading and the hatch", () => {
    const input = inputOf({ judgements: [{ claim: "held: there is nothing to seat", id: "fix-acme-4" }] });

    const blocks = noWorkClaimRefusal({ hatchIsOpen: () => false, read: { input, reconcile: OPEN_BOARD } });

    expect(blocks.length).toBe(1);
    expect(blocks[0]![0]).toContain("slopweaver supervisor tick close blocked because the chair's words say");
    expect(blocks[0]![0]).toContain(
      "(this tick says there is no work while the reconciliation it read holds 4 open: 1 ready, 2 held only for " +
        "naming no repo: (handover set-repo <slug> --repo <dir>), 1 waiting on the owner).",
    );
    expect(blocks[0]).toContain('  judgements[0].claim: "nothing to seat"');
    expect(blocks[0]!.join("\n")).toContain("SLOPWEAVER_ALLOW_NO_WORK_CLAIM=1");
  });

  it("refuses the earlier shift words carried to the next sweep", () => {
    const input = inputOf({ shift: "No fleet seat live because nothing is seatable" });

    const blocks = noWorkClaimRefusal({ hatchIsOpen: () => false, read: { input, reconcile: OPEN_BOARD } });

    expect(blocks[0]).toContain('  shift: "nothing is seatable"');
  });

  it("records when the hatch is open, and asks the hatch only when it would refuse", () => {
    const asked: string[] = [];
    const hatch = (): boolean => {
      asked.push("asked");
      return true;
    };
    const claimed = inputOf({ lede: "the queue is empty" });

    expect([
      noWorkClaimRefusal({ hatchIsOpen: hatch, read: { input: inputOf({}), reconcile: OPEN_BOARD } }),
      asked.length,
      noWorkClaimRefusal({ hatchIsOpen: hatch, read: { input: claimed, reconcile: OPEN_BOARD } }),
      asked.length,
    ]).toEqual([[], 0, [], 1]);
  });

  it("refuses a claim the reconciliation cannot back, telling the chair to re-open", () => {
    const blocks = noWorkClaimRefusal({
      hatchIsOpen: () => false,
      read: { input: inputOf({ lede: "no work left" }), reconcile: undefined },
    });

    expect(blocks[0]![0]).toContain(
      "(this tick says there is no work, and the reconciliation it read cannot back that — the reconciliation is " +
        "not a JSON object).",
    );
    expect(blocks[0]!.at(-1)).toBe(
      "Re-open the tick with this checkout so its reconcile reading completes, then say what that reading holds.",
    );
  });
});

describe("noWorkClaimRefusalLines", () => {
  it("opens on the subject it is given", () => {
    const lines = noWorkClaimRefusalLines({
      subject: "your last reply",
      verdict: { claims: [{ label: "your last reply", words: "no work" }], kind: "unreadable", why: "no reading" },
    });

    expect(lines[0]).toContain(
      "(your last reply says there is no work, and the reconciliation it read cannot back that — no reading).",
    );
  });
});
