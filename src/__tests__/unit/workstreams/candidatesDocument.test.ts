import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { candidatesDocument } from "../../../workstreams/candidatesDocument.js";
import type { DefinitionRow } from "../../../workstreams/definitions.js";
import { redefineDone } from "../../../workstreams/store/doneMilestone.js";
import { abandonedRow, catalog, ENDING, NOTHING_ELSE, promotedC002, row } from "./candidatesHarness.js";
import { registerWorkstreams } from "./registerWorkstreamsFixture.js";
import { mintedId, registerSnapshot } from "./storeRegisterFixture.js";

/** A dated note among a workstream's entries, its id, position and text set by the test. */
const DATED_NOTE = { date: "2026-10-02", done: false, href: null, kind: "note", milestoneId: null } as const;

describe("candidatesDocument", () => {
  it("counts every word, and lists what the seat owes: promotions, stories, retractions", async () => {
    const promoted = promotedC002();
    const document = candidatesDocument({
      ...NOTHING_ELSE,
      catalog,
      register: await registerSnapshot({ workstreams: [...registerWorkstreams(), promoted] }),
      rows: [
        row({ candidate: "c-001", reaction: "yes" }),
        row({ candidate: "c-002", promotedAs: promoted.id, reaction: "yes" }),
        row({ candidate: "c-002", reaction: "lets-talk" }),
        row({ candidate: "c-003", reaction: "yes" }),
      ],
    });
    expect(document.counts).toEqual({
      abandoned: 0,
      done: 0,
      "lets-talk": 1,
      "milestone-of": 0,
      no: 0,
      "not-sure": 0,
      "outcome-of": 0,
      "same-as": 0,
      "sort-of": 0,
      superseded: 0,
      unanswered: 0,
      yes: 2,
    });
    expect(document.promotionOwed).toEqual(["c-003"]);
    expect(document.storyOwed).toEqual(["postmortems-that-happen"]);
    expect(document.retractions).toEqual(["c-002"]);
    expect(document.candidates.map((one) => one.registerId)).toEqual(["merge-gate", "postmortems-that-happen", null]);
  });

  it("calls a candidate with no row unanswered", async () => {
    const document = candidatesDocument({ ...NOTHING_ELSE, catalog, register: await registerSnapshot(), rows: [] });
    expect(document.counts.unanswered).toBe(3);
    expect(document.candidates[0]!.reaction).toBe(null);
  });

  it("counts an abandoned word, never as a retraction, and owes the workstream and its ending until both are there", async () => {
    const promoted = promotedC002();
    const document = candidatesDocument({
      ...NOTHING_ELSE,
      catalog,
      register: await registerSnapshot({ workstreams: [...registerWorkstreams(), promoted] }),
      rows: [
        row({ candidate: "c-002", promotedAs: promoted.id, reaction: "yes" }),
        abandonedRow({ candidate: "c-002" }),
        abandonedRow({ candidate: "c-003" }),
      ],
    });
    expect(document.counts.abandoned).toBe(2);
    expect(document.retractions).toEqual([]);
    expect(document.promotionOwed).toEqual(["c-002", "c-003"]);
  });

  it("owes nothing for an abandoned word once its workstream carries the ending", async () => {
    const ended = promotedC002({ ending: ENDING });
    const document = candidatesDocument({
      ...NOTHING_ELSE,
      catalog,
      register: await registerSnapshot({ workstreams: [...registerWorkstreams(), ended] }),
      rows: [{ ...abandonedRow({ candidate: "c-002" }), promotedAs: ended.id }],
    });
    expect([document.promotionOwed, document.retractions]).toEqual([[], []]);
  });

  it("owes a definition only while an accepted workstream does not say it, and joins a fresh install with an empty store", async () => {
    const definition: DefinitionRow = {
      bySession: "test",
      candidate: "c-002",
      iso: "2026-10-02T12:00:00.000Z",
      name: "Postmortems that happen",
      selection: { kind: "words", stretch: null, text: "someone owns each one" },
      via: "console",
    };
    const bare = promotedC002();
    const said = unwrap(
      redefineDone({ aggregate: bare, anchor: "candidate:c-002", definition, entryId: mintedId({ n: 90 }) }),
    );
    const rows = [row({ candidate: "c-002", promotedAs: bare.id, reaction: "yes" })];
    const owed = candidatesDocument({
      ...NOTHING_ELSE,
      definitions: [definition],
      catalog,
      register: await registerSnapshot({ workstreams: [...registerWorkstreams(), bare] }),
      rows,
    });
    const settled = candidatesDocument({
      ...NOTHING_ELSE,
      definitions: [definition],
      catalog,
      register: await registerSnapshot({ workstreams: [...registerWorkstreams(), said] }),
      rows,
    });
    expect(owed.definitionOwed).toEqual(["c-002"]);
    expect(settled.definitionOwed).toEqual([]);
    expect(settled.candidates[1]!.definition).toEqual({ iso: definition.iso, selection: definition.selection });
    const fresh = candidatesDocument({ ...NOTHING_ELSE, catalog, register: { meta: null, workstreams: [] }, rows: [] });
    expect(fresh.registerExists).toBe(false);
    expect(fresh.storyOwed).toEqual([]);
    expect(fresh.candidates[0]!.registerId).toBe(null);
  });

  it("owes a placing note while the workstream it names lacks it or is gone, and never on a page-only one", async () => {
    const covered =
      'The owner declined mined candidate c-003 "Cloudflare WAF rollout" as covered by this workstream, as a side effect';
    const noted = registerWorkstreams().map((one) =>
      one.id === "merge-gate"
        ? { ...one, entries: [...one.entries, { ...DATED_NOTE, id: mintedId({ n: 90 }), position: 3, text: covered }] }
        : one,
    );
    const rows = [
      { ...row({ candidate: "c-001", reaction: "milestone-of" }), milestoneOf: "logs-scrub" },
      { ...row({ candidate: "c-002", reaction: "outcome-of" }), outcomeOf: "gone" },
      { ...row({ candidate: "c-003", reaction: "no" }), coveredBy: "merge-gate" },
    ];
    const owing = candidatesDocument({
      ...NOTHING_ELSE,
      catalog,
      register: await registerSnapshot({ workstreams: noted }),
      rows,
    });
    expect(owing.placementOwed).toEqual(["c-001", "c-002"]);
    const sameAs = [{ ...row({ candidate: "c-002", reaction: "same-as" }), sameAs: "the-tool" }];
    const local = candidatesDocument({ ...NOTHING_ELSE, catalog, register: await registerSnapshot(), rows: sameAs });
    expect(local.placementOwed).toEqual([]);
  });
});
