import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { parseCandidatesFile } from "../../../workstreams/candidates.js";
import { entryFromCandidate } from "../../../workstreams/candidateTile.js";
import {
  type DefinitionRow,
  definitionNote,
  resolveSelection,
  sameSelection,
} from "../../../workstreams/definitions.js";
import { typedWorkstreamDetail } from "../../../workstreams/store/decode.js";
import { peopleFrom } from "../../../workstreams/whoFirst.js";

import { validCandidates } from "./candidatesFixture.js";
import { countingMintId, mintedId } from "./storeRegisterFixture.js";

const file = unwrap(parseCandidatesFile({ value: validCandidates() }));
const candidate = file.candidates[1]!;
const NONE = { all: false, first: undefined, optionId: undefined, stretch: undefined, words: undefined } as const;
const WEEK = "Every incident has a written postmortem within five working days";
const OWNED = "Each postmortem has a named owner and the on-call lead has read it";

/** A definitions row standing on the fixture's second candidate. */
function rowOf({ selection }: { selection: DefinitionRow["selection"] }): DefinitionRow {
  return {
    bySession: "test",
    candidate: candidate.id,
    iso: "2026-10-03T04:27:00.000Z",
    name: candidate.name,
    selection,
    via: "word",
  };
}

describe("resolveSelection", () => {
  it("takes all of the options with none first, and their outcome every option's words", () => {
    const all = unwrap(resolveSelection({ ...NONE, all: true, candidate }));
    expect([all.kind, all.text]).toEqual(["all", `${WEEK}; ${OWNED}`]);
    expect(definitionNote({ row: rowOf({ selection: all }) }).text).toBe(
      `Definition of done: all of the options offered, which comes first not yet said: "${WEEK}; ${OWNED}"`,
    );
  });

  it("leads with the option named first, the rest kept in the note", () => {
    const first = unwrap(resolveSelection({ ...NONE, all: true, candidate, first: "owned-and-read" }));
    expect(first.text).toBe(OWNED);
    expect(definitionNote({ row: rowOf({ selection: first }) }).text).toBe(
      `Definition of done: "${OWNED}" first, of all the options offered; the rest: "${WEEK}"`,
    );
    const unnamed = unwrap(resolveSelection({ ...NONE, all: true, candidate }));
    expect(sameSelection({ a: first, b: unnamed })).toBe(false);
  });

  it("keeps a stretch rung beyond their own words, and refuses one beside an offered option", () => {
    const words = unwrap(
      resolveSelection({
        ...NONE,
        candidate,
        stretch: "someone else says it saved them time",
        words: "a regression is caught",
      }),
    );
    expect(definitionNote({ row: rowOf({ selection: words }) }).text).toBe(
      'Definition of done: "a regression is caught", in their own words; the stretch beyond it: "someone else says it saved them time"',
    );
    const beside = unwrapErr(resolveSelection({ ...NONE, candidate, optionId: "owned-and-read", stretch: "x" }));
    expect(beside.message).toBe(
      "no definition recorded — --stretch goes with --text: an offered option carries its own stretch",
    );
  });

  it("refuses --first without --all, and a first that is not one of the options", () => {
    const stray = unwrapErr(
      resolveSelection({ ...NONE, candidate, first: "owned-and-read", optionId: "owned-and-read" }),
    );
    const unknown = unwrapErr(resolveSelection({ ...NONE, all: true, candidate, first: "nope" }));
    expect([stray.message, unknown.message]).toEqual([
      "no definition recorded — --first goes with --all: which of them leads",
      "no definition recorded — --first nope is not one of c-002's: written-within-a-week, owned-and-read",
    ]);
  });

  it("refuses all of the options on a candidate that offers none, and words that are only spaces", () => {
    const bare = file.candidates.find((one) => one.doneOptions.length === 0)!;
    const none = unwrapErr(resolveSelection({ ...NONE, all: true, candidate: bare }));
    const blank = unwrapErr(resolveSelection({ ...NONE, candidate, words: "   " }));
    expect([none.message, blank.message]).toEqual([
      `no definition recorded — ${bare.id} offers no definitions of done — give --text <their words>`,
      "no definition recorded — --text is empty: say what done means",
    ]);
  });

  it("calls the same options with the same first one pick, and a reworded option a different one", () => {
    const first = unwrap(resolveSelection({ ...NONE, all: true, candidate, first: "owned-and-read" }));
    const again = unwrap(resolveSelection({ ...NONE, all: true, candidate, first: "owned-and-read" }));
    expect(first.kind).toBe("all");
    const picked = first as Extract<typeof first, { kind: "all" }>;
    const reworded = { ...picked, options: picked.options.map((one) => ({ ...one, text: `${one.text}!` })) };
    expect([sameSelection({ a: first, b: again }), sameSelection({ a: first, b: reworded })]).toEqual([true, false]);
  });
});

describe("peopleFrom", () => {
  it("splits the owner's words on commas and 'and', dropping blanks", () => {
    expect([peopleFrom({ said: "Jasper and Quinn" }), peopleFrom({ said: "Jasper, Quinn, " })]).toEqual([
      ["Jasper", "Quinn"],
      ["Jasper", "Quinn"],
    ]);
  });
});

describe("entryFromCandidate, prior steers and the owning team", () => {
  it("dates each earlier steer on the workstream after the evidence, and files the owning team as its team", () => {
    const steered = {
      ...candidate,
      owningTeam: { name: "platform team", why: "they run the load tests" },
      priorSteers: [
        { anchor: "talk:FIXTURE-0001", date: "2026-10-02", text: "ratchet everything to three hundred lines" },
      ],
    };
    const workstream = unwrap(
      entryFromCandidate({
        candidate: steered,
        definition: null,
        ending: null,
        mintId: countingMintId(),
        reactedOn: "2026-10-03",
        reactionAnchor: null,
        taken: new Set(),
      }),
    );
    const typed = typedWorkstreamDetail({ aggregate: workstream });
    expect(typed.kind).toBe("standing");
    const own = typed as Extract<typeof typed, { kind: "outcome" | "standing" }>;
    expect([own.detail.team, workstream.entries.at(-1)]).toEqual([
      "platform team",
      {
        date: "2026-10-02",
        done: false,
        href: null,
        id: mintedId({ n: 3 }),
        kind: "note",
        milestoneId: null,
        position: 2,
        text: "The owner's earlier steer: ratchet everything to three hundred lines [talk:FIXTURE-0001]",
      },
    ]);
  });
});
