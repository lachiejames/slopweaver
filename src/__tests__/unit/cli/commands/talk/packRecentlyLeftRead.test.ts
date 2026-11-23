/*
 * The talk pack's recently-left half, read off a real landing ledger: a card the owner's words took off is listed REMOVED,
 * and a register that did not read is named rather than read as "nothing left".
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRecentlyLeft } from "../../../../../cli/commands/talk/packRecentlyLeftRead.js";
import { unwrap } from "../../../../../lib/result.js";
import type { CardLandedRow } from "../../../../../talk/cardLanding.js";
import { appendCardLanding } from "../../../../../talk/cardLandingStore.js";

const NOW = "2026-10-07T04:00:00.000Z";

const LANDED: CardLandedRow = {
  anchor: "call:FIXTURE-call#s-1",
  atIso: "2026-10-07T03:18:26.968Z",
  cardKey: "post:sd-be5c2110",
  decidedIso: "2026-10-07T03:18:20.000Z",
  kind: "landed",
  source: "transcript",
  words: "bump Jasper",
  workSlug: "bump-jasper",
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-pack-left-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("readRecentlyLeft", () => {
  it("lists a card the owner's words landed on as removed, with when and why, and names nothing unread", () => {
    unwrap(appendCardLanding({ home, row: LANDED }));
    const read = readRecentlyLeft({ home, nowIso: NOW, rows: [] });
    expect(read.left).toEqual([
      {
        about: undefined,
        key: "post:sd-be5c2110",
        removedIso: "2026-10-07T03:18:26.968Z",
        why: 'the owner\'s words, heard by the voice with this card open, landed on it ("bump Jasper"); handed to bump-jasper',
      },
    ]);
    expect(read.unread).toBeUndefined();
  });

  // Unread, the board cannot tell the owner's ask from a voice relay row, so no ask landing is listed.
  it("names the board unread when it could not be read, listing what the ledger holds bar an ask", () => {
    unwrap(appendCardLanding({ home, row: LANDED }));
    unwrap(appendCardLanding({ home, row: { ...LANDED, anchor: "talk:r1", cardKey: "ask:talk-7541725c4b3b" } }));
    const read = readRecentlyLeft({ home, nowIso: NOW, rows: undefined });
    expect(read.left.map((left) => left.key)).toEqual(["post:sd-be5c2110"]);
    expect(read.unread).toEqual({
      section: "recentlyLeft",
      why: "the board could not be read, so an ask that left may be missing",
    });
  });

  it("names a landing line that did not read, never counting it as nothing left", () => {
    const path = unwrap(appendCardLanding({ home, row: LANDED }));
    appendFileSync(path, '{"kind":"landed","atIso":"2026-10-07T03:2\n');
    const read = readRecentlyLeft({ home, nowIso: NOW, rows: [] });
    expect(read.left.map((left) => left.key)).toEqual(["post:sd-be5c2110"]);
    expect(read.unread).toEqual({ section: "recentlyLeft", why: "1 card-landing line(s) did not read" });
  });

  // The measured shape: a one-off sanitiser put a space in a card key and pushed a quote past its cap, days before the
  // window. Neither line can be a card that left today, so the section is whole; a refused line inside it still is not.
  it("names no gap for a refused line naming no card key, or a real card it recorded leaving before the window", () => {
    const landings = unwrap(appendCardLanding({ home, row: LANDED }));
    appendFileSync(landings, `${JSON.stringify({ ...LANDED, cardKey: "ask:acme-Fixture 1-seats" })}\n`);
    appendFileSync(landings, `${JSON.stringify({ ...LANDED, atIso: "2026-10-05T03:00:00.000Z", words: "" })}\n`);
    const moves = join(home, "talk", "card-moves.jsonl");
    appendFileSync(
      moves,
      `${JSON.stringify({ anchor: "call:FIXTURE#move:1", atIso: "2026-10-04T00:00:00.000Z", cardKey: "ask:abc-1", decidedIso: "2026-10-04T00:00:00.000Z", kind: "moved-on", toCardKey: "ask:abc-2", words: "x".repeat(2001) })}\n`,
    );
    const read = readRecentlyLeft({ home, nowIso: NOW, rows: [] });
    expect(read.left.map((left) => left.key)).toEqual(["post:sd-be5c2110"]);
    expect(read.unread).toBeUndefined();
  });

  it("still names a refused line naming a real card it recorded leaving inside the window", () => {
    const landings = unwrap(appendCardLanding({ home, row: LANDED }));
    appendFileSync(landings, `${JSON.stringify({ ...LANDED, words: "" })}\n`);
    const read = readRecentlyLeft({ home, nowIso: NOW, rows: [] });
    expect(read.unread).toEqual({ section: "recentlyLeft", why: "1 card-landing line(s) did not read" });
  });

  // An unread landing ledger must not hide the moved-on ledger's own failure.
  it("names both card ledgers unread when neither could be read, listing nothing", () => {
    mkdirSync(join(home, "talk", "card-landings.jsonl"), { recursive: true });
    mkdirSync(join(home, "talk", "card-moves.jsonl"));
    const read = readRecentlyLeft({ home, nowIso: NOW, rows: [] });
    expect(read.left).toEqual([]);
    expect(read.unread!.why).toContain("the card-landing ledger could not be read: ");
    expect(read.unread!.why).toContain("; the moved-on ledger could not be read: ");
  });
});
