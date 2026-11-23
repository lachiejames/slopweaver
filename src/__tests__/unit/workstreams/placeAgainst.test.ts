import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { candidateCatalog } from "../../../workstreams/candidateCatalog.js";
import { parseCandidatesFile } from "../../../workstreams/candidates.js";
import { placeAgainst } from "../../../workstreams/placeAgainst.js";
import { NO_PLACEMENT, placementNote } from "../../../workstreams/placement.js";
import { emptyPlan } from "../../../workstreams/planSoFar.js";
import { SYNTHETIC_STATED } from "../../statedCandidatesFixture.js";
import { validCandidates } from "./candidatesFixture.js";
import { registerWorkstreams } from "./registerWorkstreamsFixture.js";

const catalog = unwrap(
  candidateCatalog({ mined: unwrap(parseCandidatesFile({ value: validCandidates() })), stated: SYNTHETIC_STATED }),
);
const candidate = catalog.candidates.find((one) => one.id === "c-002")!;
const workstreams = registerWorkstreams();
const NOW = "2026-10-02T13:00:00.000Z";

describe("placeAgainst", () => {
  it("leaves a milestone-of's note and its milestone on the workstream it names", () => {
    const so = emptyPlan({ workstreams });
    const placed = placeAgainst({
      candidate,
      fields: { ...NO_PLACEMENT, milestoneOf: "deps", reason: "one step of it" },
      nowIso: NOW,
      reaction: "milestone-of",
      so,
      workstreams,
    });
    expect(unwrap(placed)).toBe(null);
    expect(so.placed).toEqual([{ as: "deps", candidate: "c-002", word: "milestone-of" }]);
    expect(so.marks.get("deps")).toEqual({
      milestones: [{ after: [], anchor: "mined candidate c-002", id: "c-002", name: "Postmortems that happen" }],
      notes: [
        {
          date: "2026-10-02",
          done: false,
          href: null,
          kind: "note",
          milestoneId: null,
          text: placementNote({ candidate, reason: "one step of it", word: "milestone-of" }),
        },
      ],
    });
  });

  it("leaves a same-as's note alone, with no milestone", () => {
    const so = emptyPlan({ workstreams });
    unwrap(
      placeAgainst({
        candidate,
        fields: { ...NO_PLACEMENT, sameAs: "merge-gate" },
        nowIso: NOW,
        reaction: "same-as",
        so,
        workstreams,
      }),
    );
    expect(so.marks.get("merge-gate")!.milestones).toEqual([]);
    expect(so.marks.get("merge-gate")!.notes.map((one) => one.text)).toEqual([
      placementNote({ candidate, reason: null, word: "same-as" }),
    ]);
    expect(so.placed).toEqual([{ as: "merge-gate", candidate: "c-002", word: "same-as" }]);
  });

  it("refuses a word naming no workstream, one not on the register, a page-only one, or a closing one's milestones", () => {
    const refusal = ({
      fields,
      reaction,
    }: {
      fields: typeof NO_PLACEMENT;
      reaction: "same-as" | "milestone-of" | "outcome-of" | "no";
    }): string =>
      unwrapErr(placeAgainst({ candidate, fields, nowIso: NOW, reaction, so: emptyPlan({ workstreams }), workstreams }))
        .message;
    expect(refusal({ fields: NO_PLACEMENT, reaction: "same-as" })).toBe(
      "nothing recorded — c-002 is same-as, which names a workstream (--same-as)",
    );
    expect(refusal({ fields: { ...NO_PLACEMENT, coveredBy: "nowhere" }, reaction: "no" })).toBe(
      "nothing recorded — --covered-by nowhere is not a workstream on the register",
    );
    expect(refusal({ fields: { ...NO_PLACEMENT, outcomeOf: "the-tool" }, reaction: "outcome-of" })).toBe(
      "nothing recorded — the-tool is a local entry, which has no timeline to file c-002 on",
    );
    expect(refusal({ fields: { ...NO_PLACEMENT, milestoneOf: "old-thing" }, reaction: "milestone-of" })).toBe(
      "nothing recorded — old-thing is a closing entry, which has no milestones to file c-002 inside",
    );
  });
});
