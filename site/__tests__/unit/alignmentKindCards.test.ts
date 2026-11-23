import { describe, expect, it } from "vitest";

import { type AlignmentKindSource, alignmentKindCards, focusedAlignmentKey } from "../../lib/alignmentKindCards";

/**
 * One act as a kind card reads it.
 *
 * @returns the act
 */
function act({ id, kind, doneIso }: { id: string; kind: string; doneIso: string }): {
  actionId: string;
  kind: string;
  doneIso: string;
} {
  return { actionId: id, doneIso, kind };
}

/**
 * One source row, keyed by its newest act's id.
 *
 * @returns the source
 */
function source({
  id,
  kind,
  doneIso,
  earlier = [],
}: {
  id: string;
  kind: string;
  doneIso: string;
  earlier?: readonly { actionId: string; kind: string; doneIso: string }[];
}): AlignmentKindSource<string> {
  return { act: act({ doneIso, id, kind }), earlier, row: `act:${id}` };
}

describe("alignmentKindCards", () => {
  it("draws one card per kind, never one per act", () => {
    const cards = alignmentKindCards({
      rows: [
        source({ doneIso: "2026-11-10T00:00:00Z", id: "a1", kind: "merge-own-pr" }),
        source({ doneIso: "2026-11-11T00:00:00Z", id: "a2", kind: "merge-own-pr" }),
        source({ doneIso: "2026-11-09T00:00:00Z", id: "b1", kind: "resolve-review-thread" }),
      ],
    });
    expect(cards).toEqual([
      { acts: 2, kind: "merge-own-pr", newestDoneIso: "2026-11-11T00:00:00Z", rows: ["act:a2", "act:a1"] },
      { acts: 1, kind: "resolve-review-thread", newestDoneIso: "2026-11-09T00:00:00Z", rows: ["act:b1"] },
    ]);
  });

  it("counts a pattern's earlier acts, each ledger act once, and dates the card by the newest of them", () => {
    const shared = act({ doneIso: "2026-11-12T00:00:00Z", id: "e1", kind: "fix-ci" });
    const cards = alignmentKindCards({
      rows: [
        source({ doneIso: "2026-11-05T00:00:00Z", earlier: [shared], id: "r1", kind: "fix-ci" }),
        source({ doneIso: "2026-11-06T00:00:00Z", earlier: [shared], id: "r2", kind: "fix-ci" }),
      ],
    });
    expect(cards).toEqual([
      { acts: 3, kind: "fix-ci", newestDoneIso: "2026-11-12T00:00:00Z", rows: ["act:r2", "act:r1"] },
    ]);
  });

  it("lists a kind's rows newest first whatever the input order, the action id breaking a tie", () => {
    const cards = alignmentKindCards({
      rows: [
        source({ doneIso: "2026-11-01T00:00:00Z", id: "old", kind: "rebase" }),
        source({ doneIso: "2026-11-03T00:00:00Z", id: "z", kind: "rebase" }),
        source({ doneIso: "2026-11-03T00:00:00Z", id: "m", kind: "rebase" }),
      ],
    });
    expect(cards[0].rows).toEqual(["act:m", "act:z", "act:old"]);
  });

  it("orders cards by acts carried, then the newest act, then the kind", () => {
    const cards = alignmentKindCards({
      rows: [
        source({ doneIso: "2026-11-01T00:00:00Z", id: "c1", kind: "charlie" }),
        source({ doneIso: "2026-11-02T00:00:00Z", id: "b1", kind: "bravo" }),
        source({ doneIso: "2026-11-02T00:00:00Z", id: "a1", kind: "alpha" }),
        source({ doneIso: "2026-10-01T00:00:00Z", id: "d1", kind: "delta" }),
        source({ doneIso: "2026-10-02T00:00:00Z", id: "d2", kind: "delta" }),
      ],
    });
    expect(cards.map((card) => card.kind)).toEqual(["delta", "alpha", "bravo", "charlie"]);
  });

  it("draws no card when the page holds no act row", () => {
    expect(alignmentKindCards({ rows: [] })).toEqual([]);
  });
});

describe("focusedAlignmentKey", () => {
  it("gives a new link the focus back from a card touched under the old address, on the same mount", () => {
    const focused = focusedAlignmentKey({
      asked: "act:B",
      engaged: { asked: null, key: "act:A" },
      targetKey: "act:B",
    });
    expect(focused).toBe("act:B");
  });

  it("keeps the touched card while the address names what it named at the touch", () => {
    const focused = focusedAlignmentKey({
      asked: "act:B",
      engaged: { asked: "act:B", key: "act:A" },
      targetKey: "act:B",
    });
    expect(focused).toBe("act:A");
  });

  it("opens the linked card before anything is touched", () => {
    expect(focusedAlignmentKey({ asked: "act:B", engaged: undefined, targetKey: "act:B" })).toBe("act:B");
  });

  it("opens nothing when nothing is touched and no link names a held row", () => {
    expect(focusedAlignmentKey({ asked: null, engaged: undefined, targetKey: undefined })).toBeUndefined();
  });
});
