/**
 * The card key every landing is named by, and the card-landing errors a verb prints — what a session reads when a
 * `talk land` or `talk restore` refuses.
 */
import { describe, expect, it } from "vitest";

import { QUEUE_KINDS } from "../../../hand/consoleLinkNames.js";
import { CARD_KEY, isRegisterCardKey } from "../../../talk/cardKey.js";
import { cardKeyParts } from "../../../talk/cardLanding.js";
import { CardLandingErrors } from "../../../talk/cardLandingErrors.js";

describe("CARD_KEY", () => {
  it("accepts every console card kind the queue deep-links", () => {
    const keys = QUEUE_KINDS.map((kind) => `${kind}:x_1.2-3`);
    expect(keys.filter((key) => !CARD_KEY.test(key))).toEqual([]);
  });

  it("refuses an unknown kind, an empty id, a space, and a longer string that merely carries a key", () => {
    const keys = ["page:now", "ask:", "ask:two words", "see ask:x", "ask:x\n", `ask:${"a".repeat(161)}`];
    expect(keys.filter((key) => CARD_KEY.test(key))).toEqual([]);
  });

  it("takes an id of exactly 160 characters", () => {
    expect(CARD_KEY.test(`ask:${"a".repeat(160)}`)).toBe(true);
  });

  it("takes an Automations card's recipe key, which no Queue register holds, so nothing lands on it", () => {
    expect([
      CARD_KEY.test("recipe:organisation-hunt-daily"),
      isRegisterCardKey({ key: "recipe:organisation-hunt-daily" }),
      cardKeyParts({ cardKey: "recipe:organisation-hunt-daily" }),
      cardKeyParts({ cardKey: "ask:x" }),
    ]).toEqual([true, false, undefined, { id: "x", kind: "ask" }]);
  });

  it("takes an Alignment question's align key, which no register holds, while an act on that page stays held", () => {
    expect([
      CARD_KEY.test("align:voice-length"),
      isRegisterCardKey({ key: "align:voice-length" }),
      cardKeyParts({ cardKey: "align:rule-1333-enqueue" }),
      isRegisterCardKey({ key: "act:1333-enqueue" }),
    ]).toEqual([true, false, undefined, true]);
  });

  it("takes a proposed workstream's candidate key, which no register holds, so nothing lands on it", () => {
    expect([
      CARD_KEY.test("candidate:c-001"),
      isRegisterCardKey({ key: "candidate:c-001" }),
      cardKeyParts({ cardKey: "candidate:c-001" }),
    ]).toEqual([true, false, undefined]);
  });
});

describe("CardLandingErrors", () => {
  it("names the shape a card key must have", () => {
    const error = CardLandingErrors.cardKeyInvalid({ cardKey: "page:now" });
    expect([error.code, error.cardKey, error.message]).toEqual([
      "CARD_KEY_INVALID",
      "page:now",
      '"page:now" is not a Queue card key — expected <ask|hand|draft|post|review|import|pr|act>:<id>, a pull request\'s being pr:<owner>.<repo>.<n>',
    ]);
  });

  it("says a restore of a card nothing pulled has nothing to put back", () => {
    const error = CardLandingErrors.cardNotLanded({ cardKey: "pr:16406" });
    expect([error.code, error.message]).toEqual([
      "CARD_NOT_LANDED",
      "no word of the owner's is holding pr:16406 off the queue, so there is nothing to restore",
    ]);
  });

  it("carries an I/O cause's own message, and a thrown non-Error as text", () => {
    const thrown = CardLandingErrors.ledgerIo({ cause: new Error("EACCES"), path: "/h/talk/card-landings.jsonl" });
    const odd = CardLandingErrors.ledgerIo({ cause: 42, path: "/h/talk/card-landings.jsonl" });
    expect([thrown.code, thrown.path, thrown.message, odd.message]).toEqual([
      "LEDGER_IO",
      "/h/talk/card-landings.jsonl",
      "the card-landing ledger at /h/talk/card-landings.jsonl could not be used — EACCES",
      "the card-landing ledger at /h/talk/card-landings.jsonl could not be used — 42",
    ]);
  });

  it("names the slug on every board-shaped failure", () => {
    const errors = [
      CardLandingErrors.askMissing({ slug: "gone" }),
      CardLandingErrors.boardWriteFailed({ slug: "talk-card-08327b595da4", why: "disk full" }),
      CardLandingErrors.restoreUnshaped({ slug: "asked", why: "its question has no text" }),
    ];
    expect(errors.map((error) => `${error.code} ${error.slug} ${error.message}`)).toEqual([
      'ASK_MISSING gone no row on the board, active or archived, claims the slug "gone"',
      "BOARD_WRITE_FAILED talk-card-08327b595da4 the board write for talk-card-08327b595da4 did not land — disk full",
      "RESTORE_UNSHAPED asked asked cannot be put back on the owner's queue: its question has no text",
    ]);
  });
});
