import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { CandidatesErrors } from "../../../workstreams/candidateErrors.js";
import { reactionRowSchema } from "../../../workstreams/candidates.js";
import { parseReactionBatch } from "../../../workstreams/reactionBatch.js";
import { latestReactions } from "../../../workstreams/reactionFold.js";
import { REACTIONS, STANDALONE_REACTIONS } from "../../../workstreams/reactionWords.js";
import { abandonedRow, file, row, UNPLACED } from "./candidatesHarness.js";

describe("parseReactionBatch", () => {
  it("reads numbers, ranges, ids and every spelling of the five words", () => {
    const picks = unwrap(
      parseReactionBatch({ candidates: file.candidates, text: "1 yes, 2 Sort of; c-003 let’s talk." }),
    );
    expect(picks).toEqual([
      { candidate: "c-001", reaction: "yes" },
      { candidate: "c-002", reaction: "sort-of" },
      { candidate: "c-003", reaction: "lets-talk" },
    ]);
  });

  it("lets several references share one word, and a range expand", () => {
    expect(unwrap(parseReactionBatch({ candidates: file.candidates, text: "#1 3 no 2 not sure" }))).toEqual([
      { candidate: "c-001", reaction: "no" },
      { candidate: "c-003", reaction: "no" },
      { candidate: "c-002", reaction: "not-sure" },
    ]);
    expect(unwrap(parseReactionBatch({ candidates: file.candidates, text: "1-3 n" }))).toHaveLength(3);
  });

  it("refuses the whole batch on an unknown number, an unknown word and a dangling reference", () => {
    const refused = unwrapErr(parseReactionBatch({ candidates: file.candidates, text: "1 yes 9 no 2 maybe 3" }));
    expect(refused).toEqual(
      CandidatesErrors.reactionRefused({
        problems: [
          "no candidate is numbered 9",
          '"maybe" is neither a candidate number nor one of yes, no, sort of, not sure, let\'s talk, abandoned',
          "c-002, c-003 have no word after them",
        ],
      }),
    );
  });

  it("refuses one candidate given two different words", () => {
    const refused = unwrapErr(parseReactionBatch({ candidates: file.candidates, text: "1 yes 1 no" }));
    expect(refused).toEqual(CandidatesErrors.reactionRefused({ problems: ["c-001 is given both yes and no"] }));
  });

  it("reads abandoned, and the owner's own word cancelled, as the abandoned word", () => {
    expect(
      unwrap(parseReactionBatch({ candidates: file.candidates, text: "1 abandoned, 2 cancelled 3 canceled" })),
    ).toEqual([
      { candidate: "c-001", reaction: "abandoned" },
      { candidate: "c-002", reaction: "abandoned" },
      { candidate: "c-003", reaction: "abandoned" },
    ]);
  });

  it("refuses an empty batch", () => {
    expect(unwrapErr(parseReactionBatch({ candidates: file.candidates, text: "  " }))).toEqual(
      CandidatesErrors.reactionRefused({ problems: ["no reaction was given"] }),
    );
  });
});

describe("latestReactions", () => {
  it("lets the latest word stand, with the owner's words on it, and remembers the promotion an earlier yes made", () => {
    const states = latestReactions({
      rows: [
        row({ candidate: "c-002", heard: "yes, that was mine", promotedAs: "postmortems", reaction: "yes" }),
        row({ candidate: "c-002", heard: "actually no, someone else drove it", reaction: "no" }),
      ],
    });
    expect(states.get("c-002")).toEqual({
      ...UNPLACED,
      heard: "actually no, someone else drove it",
      promotedAs: "postmortems",
      reactedIso: "2026-10-02T13:00:00.000Z",
      reaction: "no",
      reason: null,
      via: "word",
    });
  });
});

describe("reactionRowSchema", () => {
  it("refuses an abandoned row with no reason, and a reason on any other word", () => {
    const bare = reactionRowSchema.safeParse({ ...abandonedRow({ candidate: "c-001" }), reason: null });
    const stray = reactionRowSchema.safeParse({ ...row({ candidate: "c-001", reaction: "yes" }), reason: "why" });
    expect([bare.error!.issues[0]!.message, stray.error!.issues[0]!.message]).toEqual([
      "an abandoned row carries why, and the anchor where the owner said it",
      "only an abandoned, done, milestone-of, outcome-of, superseded or no row carries a reason",
    ]);
  });

  it("refuses a placing word without what it names, and a placing field on another word", () => {
    const bare = reactionRowSchema.safeParse(row({ candidate: "c-001", reaction: "outcome-of" }));
    const stray = reactionRowSchema.safeParse({ ...row({ candidate: "c-001", reaction: "yes" }), owner: "Sadie" });
    const superseded = reactionRowSchema.safeParse(row({ candidate: "c-001", reaction: "superseded" }));
    expect([
      bare.error!.issues[0]!.message,
      stray.error!.issues[0]!.message,
      superseded.error!.issues[0]!.message,
    ]).toEqual([
      "an outcome-of row names the workstream it is an outcome of (outcomeOf), and only that row does",
      "only a no names whose it is (owner) or what covers it (coveredBy)",
      "a superseded row names what replaced it (supersededBy), and only that row does",
    ]);
  });

  it("reads a row written before reasons existed as carrying none", () => {
    const { reason: _dropped, ...old } = row({ candidate: "c-001", reaction: "no" });
    expect(reactionRowSchema.parse(old).reason).toBe(null);
  });

  it("reads a row written before the owner's words were kept as carrying none", () => {
    const { heard: _dropped, ...old } = row({ candidate: "c-001", heard: "not a workstream", reaction: "no" });
    expect(reactionRowSchema.parse(old).heard).toBe(null);
  });
});

describe("STANDALONE_REACTIONS", () => {
  it("keeps every word but the four that name a target, in the page's order", () => {
    expect(REACTIONS.filter((word) => !STANDALONE_REACTIONS.includes(word))).toEqual([
      "same-as",
      "milestone-of",
      "outcome-of",
      "superseded",
    ]);
    expect(STANDALONE_REACTIONS).toEqual(["yes", "no", "sort-of", "not-sure", "lets-talk", "done", "abandoned"]);
  });
});
