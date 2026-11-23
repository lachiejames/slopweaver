/**
 * The recorded verdicts that a card is not the owner's round-trip, the first one per card wins, and a torn line is
 * counted rather than fatal.
 */
// The legacy-file cases went out with the second file the reader took.
// deleted-with-code: CARDS_NOT_OWNER_FILES, unreadableRenamed
import { appendFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  appendCardNotOwners,
  CARDS_NOT_OWNER_FILE,
  cardsNotOwnersUnreadableLines,
  readCardsNotOwners,
} from "../../../talk/cardNotOwnerStore.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cards-not-owner-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const AT = "2026-10-02T05:00:00.000Z";

describe("the cards-not-owner file", () => {
  it("reads as no verdicts in a home that never refused a card", () => {
    const read = unwrap(readCardsNotOwners({ home }));
    expect([...read.byCard.entries()]).toEqual([]);
    expect(read.unreadable).toEqual([]);
  });

  it("appends to its one file, keeps the first verdict per card, written 0600, and counts a torn line", () => {
    const path = unwrap(appendCardNotOwners({ home, row: { cardKey: "pr:18277", recordedAtIso: AT, why: "first" } }));
    unwrap(appendCardNotOwners({ home, row: { cardKey: "pr:18277", recordedAtIso: AT, why: "second" } }));
    appendFileSync(path, '{"cardKey":');
    unwrap(appendCardNotOwners({ home, row: { cardKey: "pr:1", recordedAtIso: AT, why: "other" } }));
    const read = unwrap(readCardsNotOwners({ home }));
    expect([...read.byCard.values()].map((kept) => [kept.cardKey, kept.why])).toEqual([
      ["pr:18277", "first"],
      ["pr:1", "other"],
    ]);
    expect(read.unreadable).toEqual([3]);
    expect(path).toBe(join(dirname(stateHomePaths({ home }).talkTurns), "cards-not-owner.jsonl"));
    expect(CARDS_NOT_OWNER_FILE).toBe("cards-not-owner.jsonl");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("prints one line naming every torn line", () => {
    const path = unwrap(appendCardNotOwners({ home, row: { cardKey: "pr:2", recordedAtIso: AT, why: "kept" } }));
    appendFileSync(path, "{torn\n");
    appendFileSync(path, "{torn\n");
    expect(cardsNotOwnersUnreadableLines({ read: unwrap(readCardsNotOwners({ home })) })).toEqual([
      "talk land: cards-not-owner lines 2, 3 do not parse; those cards are judged afresh",
    ]);
  });

  it("prints nothing when every line parses", () => {
    expect(cardsNotOwnersUnreadableLines({ read: { unreadable: [] } })).toEqual([]);
  });
});
