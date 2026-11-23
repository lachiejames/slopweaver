/*
 * `read_card` resolves the card and hands every address back to read, moving nothing (split out of `openCard.test.ts`
 * to keep that file under the size ratchet).
 */
import { describe, expect, it } from "vitest";

import { toolOutputOf } from "../../components/live/talkSession";
import { runReadCard } from "../../components/voice/openCardRun";
import { briefingFilesOf } from "../../lib/openCard";
import { UNREAD_MAX_BYTES } from "../../lib/unreadFit";
import { LEFT, LIVE, ORB_BRIEFINGS, PAGE_ONE, PAGE_TWO, PR, REMOVAL, recording, THREAD } from "./openCardFixture";

// Read off the same addresses and words the briefings are found by: a held draft's link run (the last URL here) and
// a file the words alone spell both count, so a briefing the voice is handed is never one with no file to read.
describe("briefingFilesOf", () => {
  it("names each briefing's file off its first file:// address or word, and none for a console-route-only one", () => {
    const urls = [
      "http://localhost:3000/api/page/acme/index.html",
      "file:///Users/someone/.slopweaver/pages/acme/index.html",
      "file:///elsewhere/pages/acme/index.html",
      "http://localhost:3000/api/page/route-only/index.html",
      "file:///Users/someone/.slopweaver/pages/held-draft/index.html",
    ];
    const texts = ["Read file:///Users/someone/.slopweaver/pages/spelled/index.html first."];
    expect([...briefingFilesOf({ texts, urls })]).toEqual([
      ["acme", "/Users/someone/.slopweaver/pages/acme/index.html"],
      ["held-draft", "/Users/someone/.slopweaver/pages/held-draft/index.html"],
      ["spelled", "/Users/someone/.slopweaver/pages/spelled/index.html"],
    ]);
  });
});

// An unasked open_card would move the console off the owner's briefing; reading a card opens nothing.
describe("runReadCard", () => {
  it("answers with the card, every address it links and every briefing already read, and moves nothing", async () => {
    const { seams, moves, presents, reads } = recording({ moved: { kind: "opened" }, on: true });
    const ran = await runReadCard({ args: { key: "hand:react-to-the-orb-mockup" }, seams });
    expect(moves).toEqual([]);
    expect(presents).toEqual([]);
    expect(reads).toEqual(["orb-mockup", "orb-notes"]);
    expect([ran.refused, ran.readText, ran.detail, ran.partialFailures]).toEqual([
      false,
      true,
      "hand:react-to-the-orb-mockup, read, briefings 2/2 read whole",
      [],
    ]);
    const answer = ran.answer as { card: { key: string }; links: unknown; briefings: unknown };
    expect(Object.keys(answer)).toEqual(["card", "links", "briefings"]);
    expect(answer.briefings).toEqual(ORB_BRIEFINGS);
    expect(answer.card.key).toBe("hand:react-to-the-orb-mockup");
    expect(answer.links).toEqual({
      addresses: [PAGE_ONE, PAGE_TWO, PR, THREAD],
      files: [],
      pages: [
        { file: "/Users/someone/.slopweaver/pages/orb-mockup/index.html", slug: "orb-mockup" },
        { file: "/Users/someone/.slopweaver/pages/orb-notes/index.html", slug: "orb-notes" },
      ],
      threadUrl: THREAD,
    });
  });

  it("refuses exactly as open_card does: a blank key, an unloaded register, a key no card answers to", async () => {
    const { seams } = recording({
      moved: { kind: "opened" },
      on: true,
      unread: [{ source: "the board", why: "still loading" }],
    });
    const { seams: loaded, reads } = recording({ moved: { kind: "opened" }, on: true });
    expect((await runReadCard({ args: { key: "  " }, seams })).answer).toEqual({
      refused: "key must be the item's key from action_items or read_page, such as ask:<slug>",
    });
    expect((await runReadCard({ args: { key: "ask:not-loaded-yet" }, seams })).answer).toEqual({
      refused: "ask:not-loaded-yet is not among what has loaded; still unread: the board (still loading)",
    });
    expect((await runReadCard({ args: { key: "hand:gone" }, seams: loaded })).answer).toEqual({
      refused: "no card on the owner's Queue or Alignment page, nor recently off it, answers to hand:gone",
    });
    expect(reads).toEqual([]);
  });

  it("holds a missing card's refusal under the tool cap: a long key refused, a 30 KiB unread reason fitted", async () => {
    const { seams } = recording({
      moved: { kind: "opened" },
      on: true,
      unread: [{ source: "the board", why: "e".repeat(30 * 1024) }],
    });
    const long = await runReadCard({ args: { key: "x".repeat(24_000) }, seams });
    expect([long.refused, long.detail, long.answer]).toEqual([
      true,
      "key too long",
      { refused: "key is 24000 bytes, longer than any card's key; use the key from action_items" },
    ]);
    const missing = await runReadCard({ args: { key: `ask:${"m".repeat(160)}` }, seams });
    const { refused } = missing.answer as { readonly refused: string };
    expect(refused.startsWith(`ask:${"m".repeat(160)} is not among what has loaded; still unread: the board (`)).toBe(
      true,
    );
    expect(toolOutputOf({ answer: missing.answer, tool: "read_card" })).toBe(JSON.stringify(missing.answer));
    expect(Buffer.byteLength(refused)).toBeLessThanOrEqual(UNREAD_MAX_BYTES + 256);
    // The longest key read at all, 4096 bytes, is looked for and its refusal still fits beside the unread clause.
    const edge = `ask:${"k".repeat(4092)}`;
    const atEdge = await runReadCard({ args: { key: edge }, seams });
    expect(atEdge.detail).toBe(`${edge} not found`);
    expect(toolOutputOf({ answer: atEdge.answer, tool: "read_card" })).toBe(JSON.stringify(atEdge.answer));
  });

  // A briefing the read could not open is handed to file_read at the card's own file, never said unread while
  // file_read could still read it; its sentence is said only if that read fails too. Never silently skipped.
  it("hands a briefing it could not open to file_read at the card's file, and tells the console window", async () => {
    const { seams, reads } = recording({ moved: { kind: "opened" }, on: true, unreadable: ["orb-notes"] });
    const ran = await runReadCard({ args: { key: "hand:react-to-the-orb-mockup" }, seams });
    expect(reads).toEqual(["orb-mockup", "orb-notes"]);
    const file = "/Users/someone/.slopweaver/pages/orb-notes/index.html";
    expect((ran.answer as { briefings: unknown }).briefings).toEqual([
      ORB_BRIEFINGS[0],
      {
        read: "partial",
        rest: { from: 0, path: file },
        say: "I couldn't open the orb-notes briefing, so I can't read that to you.",
        slug: "orb-notes",
        text: "",
      },
    ]);
    expect(ran.detail).toBe("hand:react-to-the-orb-mockup, read, briefings 1/2 read whole");
    expect(ran.partialFailures).toEqual([
      {
        cardKey: "hand:react-to-the-orb-mockup",
        part: "briefing",
        why: "orb-notes: not read here, handed to file_read",
      },
    ]);
  });

  it("reads a card that left the owner's Queue, marked removed with when and why, and moves nothing", async () => {
    const { seams, moves, presents } = recording({
      moved: { kind: "opened" },
      on: true,
      recentlyLeft: LEFT,
      rows: LIVE,
    });
    const ran = await runReadCard({ args: { key: "hand:a-bare-step" }, seams });
    expect([moves, presents]).toEqual([[], []]);
    expect([ran.refused, ran.readText, ran.detail]).toEqual([
      false,
      true,
      "hand:a-bare-step, read (off the owner's Queue)",
    ]);
    const answer = ran.answer as { card: { key: string }; removed: unknown };
    expect(Object.keys(answer)).toEqual(["card", "links", "removed", "briefings"]);
    expect(answer.card.key).toBe("hand:a-bare-step");
    expect(answer.removed).toEqual({ ...REMOVAL, onQueue: false });
  });
});
