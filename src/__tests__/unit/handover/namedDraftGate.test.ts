/**
 * The gate every card-writing verb puts in front of a named Slack draft: the draft must be one the register holds.
 *
 * A card asking the owner to react to a Slack draft that does not show it must never happen. The console draws every id a card names; this refuses to record a
 * card naming one it could not draw as a draft waiting on the owner.
 */
import { describe, expect, it } from "vitest";

import {
  draftIdsNamed,
  namedDraftVerdict,
  UNHELD_DRAFT_HATCH,
  unheldDraftProblems,
} from "../../../handover/namedDraftGate.js";

const ITEMS = [
  { id: "sd-a0615cb5", state: "held" },
  { id: "sd-f6b4af59", state: "released" },
  { id: "sd-0000dead", state: "dropped" },
];

describe("draftIdsNamed", () => {
  it("reads an id a link label completes, and one inside a bare link target", () => {
    expect(
      draftIdsNamed({ texts: ["Review sd-<https://example.test|deadbeef> first", "<https://x.test/sd-a0615cb5>"] }),
    ).toEqual(["sd-deadbeef", "sd-a0615cb5"]);
  });

  it("reads an id the mrkdwn renderer draws whole, and keeps one only the raw text carries", () => {
    expect(
      draftIdsNamed({
        texts: ["Review sd-*deadbeef* before posting", "*sd-a0615cb5*x", "then sd-*f6b4af59**x", "s_d-e8ecf199_"],
      }),
    ).toEqual(["sd-deadbeef", "sd-a0615cb5", "sd-f6b4af59", "sd-e8ecf199"]);
  });

  it("finds every whole id across the texts, first seen first, each once", () => {
    expect(
      draftIdsNamed({
        texts: ["OK to send the heads-up (draft sd-a0615cb5)?", undefined, "or sd-f6b4af59, then sd-a0615cb5"],
      }),
    ).toEqual(["sd-a0615cb5", "sd-f6b4af59"]);
  });

  it("refuses a short, long, upper-case or embedded id — the same grammar as the console's reader", () => {
    expect(
      draftIdsNamed({ texts: ["sd-a0615cb sd-a0615cb55 sd-A0615CB5 xsd-a0615cb5 sd-a0615cb5-2 sd-a0615cb5x"] }),
    ).toEqual([]);
  });
});

describe("unheldDraftProblems", () => {
  it("says nothing about a held draft", () => {
    expect(unheldDraftProblems({ ids: ["sd-a0615cb5"], items: ITEMS })).toEqual([]);
  });

  it("names a released, a dropped and an unknown id, in the order they came", () => {
    expect(unheldDraftProblems({ ids: ["sd-12345678", "sd-f6b4af59", "sd-0000dead"], items: ITEMS })).toEqual([
      "sd-12345678 is not in the drafts register — a typo, or a draft never recorded on this home",
      "sd-f6b4af59 is released, so the card would ask the owner to send a draft that is no longer waiting",
      "sd-0000dead is dropped, so the card would ask the owner to send a draft that is no longer waiting",
    ]);
  });

  it("names the live cut of a dropped draft whose note says it was re-cut", () => {
    const items = [
      ...ITEMS,
      { id: "sd-2a84c6d4", outcome: "re-cut as sd-1cdf3a4c in the 28 Sep finding shape", state: "dropped" },
      { id: "sd-1cdf3a4c", outcome: "superseded by sd-a0615cb5", state: "dropped" },
      { id: "sd-5774ae50", outcome: "superseded by sd-f6b4af59 with measured blast radius", state: "dropped" },
    ];
    expect(unheldDraftProblems({ ids: ["sd-2a84c6d4", "sd-5774ae50"], items })).toEqual([
      "sd-2a84c6d4 was dropped and re-cut — the live cut is sd-a0615cb5, still held: name sd-a0615cb5 so the card " +
        "draws the words the owner would be approving",
      "sd-5774ae50 was dropped and re-cut — the live cut is sd-f6b4af59, which is released, so there is no draft " +
        "left waiting on the owner",
    ]);
  });
});

describe("namedDraftVerdict", () => {
  it("admits a card naming only held drafts", () => {
    expect(
      namedDraftVerdict({ command: "slopweaver handover ask", env: {}, ids: ["sd-a0615cb5"], items: ITEMS }),
    ).toEqual({
      kind: "ok",
    });
  });

  it("refuses with the four-line hatch, one line per problem, and says nothing was recorded", () => {
    const verdict = namedDraftVerdict({
      command: "slopweaver handover ask",
      env: {},
      ids: ["sd-f6b4af59"],
      items: ITEMS,
    });
    expect(verdict.kind).toBe("refused");
    const lines = (verdict as Extract<typeof verdict, { kind: "refused" }>).lines;
    expect(lines[0]).toContain("slopweaver handover ask blocked because the card names a parked Slack draft");
    expect(lines[0]).toContain(`${UNHELD_DRAFT_HATCH}=1 slopweaver handover ask`);
    expect(lines[1]).toBe(
      "  - sd-f6b4af59 is released, so the card would ask the owner to send a draft that is no longer waiting",
    );
    expect(lines[2]).toContain("NOTHING was recorded");
  });

  it("admits the same card once the hatch is open", () => {
    expect(
      namedDraftVerdict({
        command: "slopweaver handover ask",
        env: { [UNHELD_DRAFT_HATCH]: "1" },
        ids: ["sd-f6b4af59"],
        items: ITEMS,
      }),
    ).toEqual({ kind: "ok" });
  });
});
