/**
 * `automationSteering` — every request the owner sent about an automation, the supervisor's recorded answer to each, and
 * the dated timeline that puts the next firing and any edit of the row beside each one.
 *
 * Pure: steers, firings and posting lookups are literals.
 */
import { describe, expect, it } from "vitest";

import type { FiringView } from "../../../automations/card.js";
import type { PostingLookup } from "../../../automations/outputs.js";
import { automationSteering, recipeSteerKey, type SteerView } from "../../../automations/steering.js";

const firing = (over: Partial<FiringView> = {}): FiringView => ({
  attempt: 1,
  detail: null,
  exitCode: 0,
  outcome: "succeeded",
  reason: null,
  runStartedAtIso: null,
  settledAtIso: null,
  slotIso: "2026-10-01T00:00:00.000Z",
  startedAtIso: "2026-10-01T00:00:01.000Z",
  ...over,
});

const steer = (over: Partial<SteerView> = {}): SteerView => ({
  answer: null,
  answerUnreadable: null,
  boardRowMissing: false,
  delivery: null,
  sentAtIso: "2026-10-02T09:00:00.000Z",
  slug: "talk-a",
  turnId: "a",
  words: "these suck, post the top three only",
  ...over,
});

const noPosting = (): PostingLookup => ({ kind: "none" });

describe("automationSteering", () => {
  it("dates the row's stated wording, then each steer, with the first firing after each, why its posting would not read, and the row's edit after it", () => {
    const answered = steer({
      answer: { settlement: "answered", witness: "amended the row" },
      sentAtIso: "2026-10-02T09:00:00.000Z",
      slug: "talk-a",
      turnId: "a",
    });
    const pending = steer({ sentAtIso: "2026-10-03T09:00:00.000Z", slug: "talk-b", turnId: "b", words: "disable it" });
    const view = automationSteering({
      editedIso: "2026-10-02T10:00:00.000Z",
      firings: [firing({ slotIso: "2026-10-03T00:00:00.000Z", startedAtIso: "2026-10-03T00:00:01.000Z" }), firing()],
      earliest: { atIso: "2026-09-30T00:00:00.000Z", from: "file-born" },
      nextFiringIso: "2026-10-04T00:00:00.000Z",
      postingFor: ({ slotIso }): PostingLookup =>
        slotIso === "2026-10-03T00:00:00.000Z"
          ? {
              kind: "found",
              posting: {
                channel: "C1",
                postedAtIso: "2026-10-03T00:05:00.000Z",
                recipeId: "organisation-hunt-daily",
                slotIso,
                ts: "1.2",
              },
            }
          : { kind: "unreadable", why: "the posting record at p.json will not parse" },
      recipeId: "organisation-hunt-daily",
      steers: [pending, answered],
      storeGap: null,
      what: "find one new organisation a day",
    });

    expect(
      view.timeline.map((entry) => [entry.kind, entry.earliestFrom, entry.atIso, entry.text, entry.rowEditedAfterIso]),
    ).toEqual([
      [
        "stated",
        "file-born",
        "2026-09-30T00:00:00.000Z",
        "find one new organisation a day",
        "2026-10-02T10:00:00.000Z",
      ],
      ["steer", null, "2026-10-02T09:00:00.000Z", "these suck, post the top three only", "2026-10-02T10:00:00.000Z"],
      ["steer", null, "2026-10-03T09:00:00.000Z", "disable it", null],
    ]);
    expect(view.timeline.map((entry) => entry.firingAfter)).toEqual([
      {
        outcome: "succeeded",
        posting: null,
        postingUnreadable: "the posting record at p.json will not parse",
        slotIso: "2026-10-01T00:00:00.000Z",
        startedAtIso: "2026-10-01T00:00:01.000Z",
      },
      {
        outcome: "succeeded",
        posting: { channel: "C1", postedAtIso: "2026-10-03T00:05:00.000Z", ts: "1.2" },
        postingUnreadable: null,
        slotIso: "2026-10-03T00:00:00.000Z",
        startedAtIso: "2026-10-03T00:00:01.000Z",
      },
      null,
    ]);
    expect([view.key, view.keyRefusal, view.unanswered, view.nextFiringIso]).toEqual([
      "recipe:organisation-hunt-daily",
      null,
      1,
      "2026-10-04T00:00:00.000Z",
    ]);
    expect(view.steers.map((one) => one.turnId)).toEqual(["b", "a"]);
  });

  it("opens on the first steer when no record dates the row, and says why the relay ledger would not read", () => {
    const view = automationSteering({
      editedIso: null,
      firings: [],
      earliest: null,
      nextFiringIso: null,
      postingFor: noPosting,
      recipeId: "r",
      steers: [steer()],
      storeGap: "the relay ledger will not read — no card shows the steers sent about it",
      what: "w",
    });

    expect(view.timeline.map((entry) => [entry.kind, entry.firingAfter, entry.rowEditedAfterIso])).toEqual([
      ["steer", null, null],
    ]);
    expect(view.storeGap).toBe("the relay ledger will not read — no card shows the steers sent about it");
  });

  it("never counts a steer whose board row will not read, or that no row claims, as awaiting an answer", () => {
    const view = automationSteering({
      editedIso: null,
      firings: [],
      earliest: null,
      nextFiringIso: null,
      postingFor: noPosting,
      recipeId: "r",
      steers: [
        steer({ answerUnreadable: "the board row at b.md will not parse", turnId: "u" }),
        steer({ boardRowMissing: true, turnId: "m" }),
        steer(),
      ],
      storeGap: null,
      what: "w",
    });

    expect(view.unanswered).toBe(1);
  });
});

describe("recipeSteerKey", () => {
  it("keys a row whose id is a card id, and refuses one that is not, naming where to steer instead", () => {
    expect([recipeSteerKey({ recipeId: "resync-corpus-slack" }), recipeSteerKey({ recipeId: "two words" })]).toEqual([
      { key: "recipe:resync-corpus-slack" },
      {
        refusal:
          "the row id \"two words\" is not a card key (letters, digits, '.', '_', '-'), so a steer cannot name it — tell the supervisor in the Queue's steer box instead",
      },
    ]);
  });
});
