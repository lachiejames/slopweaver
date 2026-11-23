/**
 * `talk land` over the call file's segments: a second card on the row a later segment already landed on, a
 * deferred one whose segment is not on file yet, a split utterance landed once, and the refusals — a desktop
 * test instance's call, a work row named by hand, words the owner did not say there — over a throwaway home and board.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { landCard } from "../../../../cli/commands/talk/cardLandApply.js";
import { runTalkLand } from "../../../../cli/commands/talk/cardsRun.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import type { CallEntry } from "../../../../talk/callRecord.js";
import { appendCallEntries } from "../../../../talk/callStore.js";
import { cardDispatchSlug } from "../../../../talk/cardLanding.js";
import { readCardLandings } from "../../../../talk/cardLandingStore.js";
import { ANCHOR, active, argvFor, board, CALL, CARD, home, input, MINE, useCardLandHome } from "./harness.js";

useCardLandHome();

describe("talk transcript, talk cards, talk land and talk restore", () => {
  // The later segment landed first, the whole utterance's own landing has not run, and a session lands
  // a second card under the first segment's anchor.
  it("lands a second card on the row a later segment of the same utterance already landed on", async () => {
    const segment = ({ at, id, text }: { at: string; id: string; text: string }): CallEntry => ({
      atIso: `2026-09-25T15:${at}.000Z`,
      final: true,
      id,
      kind: "segment",
      open: CARD,
      text,
      who: "owner",
    });
    unwrap(
      appendCallEntries({
        callId: CALL,
        entries: [
          segment({ at: "40:00", id: "s-1", text: "hello" }),
          segment({ at: "40:02", id: "s-2", text: "world" }),
          { atIso: "2026-09-25T15:40:05.000Z", kind: "closed", why: null },
        ],
        home,
      }),
    );
    const later = `call:${CALL}#s-2`;
    unwrap(await landCard({ input: input({ anchor: later, words: "world" }) }));
    const land = ["--card", MINE, "--words", "hello world", "--anchor", ANCHOR];
    const rest = [...land, "--decided", "2026-09-25T15:40:00.000Z", "--dir", board, "--home", home];
    expect(await runTalkLand(argvFor({ rest, verb: "land" }))).toBe(EXIT_OK);
    expect(active().map((row) => [row.cardKey, row.workSlug])).toEqual([
      [CARD, cardDispatchSlug({ anchor: later })],
      [MINE, cardDispatchSlug({ anchor: later })],
    ]);
    expect(existsSync(join(board, `${cardDispatchSlug({ anchor: ANCHOR })}.md`))).toBe(false);
  });

  // `talk land` read a test-instance call through closedCardUtterances unfiltered.
  it("refuses to land a card from a call the desktop test instance opened, even once an unmarked open follows", async () => {
    const origin = { checkoutRoot: "/w/main", defaultPort: 3000, mainWorktree: true, port: 3000 };
    const open = ({ at, sessionId, marked }: { at: string; sessionId: string; marked: boolean }): CallEntry => ({
      atIso: `2026-09-25T15:${at}.000Z`,
      kind: "open",
      model: "m",
      origin: marked ? { ...origin, instance: "e2e" } : origin,
      sessionId,
      voice: "cedar",
    });
    const said: CallEntry = {
      atIso: "2026-09-25T15:40:01.000Z",
      final: true,
      id: "s-1",
      kind: "segment",
      open: CARD,
      text: "automated test",
      who: "owner",
    };
    const entries: CallEntry[] = [
      open({ at: "40:00", marked: true, sessionId: "test" }),
      said,
      open({ at: "41:00", marked: false, sessionId: "later" }),
      { atIso: "2026-09-25T15:41:05.000Z", kind: "closed", why: null },
    ];
    unwrap(appendCallEntries({ callId: CALL, entries, home }));
    const land = ["--card", MINE, "--words", "automated test", "--anchor", ANCHOR];
    const rest = [...land, "--decided", "2026-09-25T15:40:00.000Z", "--dir", board, "--home", home];
    expect(await runTalkLand(argvFor({ rest, verb: "land" }))).toBe(EXIT_ERROR);
    expect(active()).toEqual([]);
  });

  // s-1 and s-2 landed joined; the voice's line arrived late, between them, and split the utterance.
  it("lands neither half of an utterance a late line split, when the joined landing already carries both", async () => {
    const later = `call:${CALL}#s-2`;
    const joined = unwrap(await landCard({ input: input({ laterAnchors: [later], words: "alpha beta" }) }));
    const first = unwrap(await landCard({ input: input({ nowIso: "2026-09-25T15:42:00.000Z", words: "alpha" }) }));
    const second = unwrap(
      await landCard({ input: input({ anchor: later, nowIso: "2026-09-25T15:42:00.000Z", words: "beta" }) }),
    );
    expect([joined.outcome, first.outcome, second.outcome]).toEqual(["landed", "already", "already"]);
    expect(active().map((row) => row.workSlug)).toEqual([cardDispatchSlug({ anchor: ANCHOR })]);
    expect(existsSync(join(board, `${cardDispatchSlug({ anchor: later })}.md`))).toBe(false);
  });

  // The keepalive with s-2 and the close overtook the batch carrying s-1, and a session lands a second
  // card under s-1 before that batch arrives.
  it("defers a second card whose anchor's segment is not on file yet, then lands it on the later segment's row", async () => {
    const segment = ({ at, id, text }: { at: string; id: string; text: string }): CallEntry => ({
      atIso: `2026-09-25T15:${at}.000Z`,
      final: true,
      id,
      kind: "segment",
      open: CARD,
      text,
      who: "owner",
    });
    const closed: CallEntry = { atIso: "2026-09-25T15:40:05.000Z", kind: "closed", why: null };
    unwrap(
      appendCallEntries({ callId: CALL, entries: [segment({ at: "40:02", id: "s-2", text: "world" }), closed], home }),
    );
    const later = `call:${CALL}#s-2`;
    unwrap(await landCard({ input: input({ anchor: later, words: "world" }) }));
    const land = ["--card", MINE, "--words", "hello world", "--anchor", ANCHOR];
    const rest = [...land, "--decided", "2026-09-25T15:40:00.000Z", "--dir", board, "--home", home];
    expect(await runTalkLand(argvFor({ rest, verb: "land" }))).toBe(EXIT_DEFERRED);
    expect(active().map((row) => row.cardKey)).toEqual([CARD]);
    unwrap(appendCallEntries({ callId: CALL, entries: [segment({ at: "40:00", id: "s-1", text: "hello" })], home }));
    expect(await runTalkLand(argvFor({ rest, verb: "land" }))).toBe(EXIT_OK);
    expect(active().map((row) => [row.cardKey, row.workSlug])).toEqual([
      [CARD, cardDispatchSlug({ anchor: later })],
      [MINE, cardDispatchSlug({ anchor: later })],
    ]);
    expect(existsSync(join(board, `${cardDispatchSlug({ anchor: ANCHOR })}.md`))).toBe(false);
  });

  // A session-named row reached every later card of the utterance unchecked for the owner's words.
  it("refuses a work row named by hand, so a card only ever points at a row carrying the words", async () => {
    const said: CallEntry = {
      atIso: "2026-09-25T15:40:00.000Z",
      final: true,
      id: "s-1",
      kind: "segment",
      open: CARD,
      text: "ship A",
      who: "owner",
    };
    const closed: CallEntry = { atIso: "2026-09-25T15:40:05.000Z", kind: "closed", why: null };
    unwrap(appendCallEntries({ callId: CALL, entries: [said, closed], home }));
    const rest = [
      "--card",
      "draft:b",
      "--words",
      "ship A",
      "--anchor",
      ANCHOR,
      "--decided",
      "2026-09-25T15:40:00.000Z",
    ];
    const argv = argvFor({ rest: [...rest, "--work", "unrelated", "--dir", board, "--home", home], verb: "land" });
    expect(await runTalkLand(argv)).toBe(EXIT_USAGE);
    expect(unwrap(readCardLandings({ home })).rows).toEqual([]);
  });

  // The anchor was the owner's, the words and instant the session's, and a later transcript landing reused the row.
  it("lands what the call file holds under a call anchor, and refuses words the owner did not say there", async () => {
    const said: CallEntry = {
      atIso: "2026-09-25T15:40:00.000Z",
      final: true,
      id: "s-1",
      kind: "segment",
      open: CARD,
      text: "ship A now",
      who: "owner",
    };
    const closed: CallEntry = { atIso: "2026-09-25T15:40:05.000Z", kind: "closed", why: null };
    unwrap(appendCallEntries({ callId: CALL, entries: [said, closed], home }));
    const land = ({ words }: { words: string }): Promise<number> =>
      runTalkLand(
        argvFor({
          rest: ["--card", MINE, "--words", words, "--anchor", ANCHOR, "--decided", "2026-09-26T09:00:00.000Z"],
          verb: "land",
        }).concat(["--dir", board, "--home", home]),
      );
    expect(await land({ words: "approve B" })).toBe(EXIT_ERROR);
    expect(unwrap(readCardLandings({ home })).rows).toEqual([]);
    expect(await land({ words: "ship A" })).toBe(EXIT_OK);
    const rows = unwrap(readCardLandings({ home })).rows;
    expect(rows.map((row) => (row.kind === "landed" ? [row.words, row.decidedIso] : [row.kind]))).toEqual([
      ["ship A now", "2026-09-25T15:40:00.000Z"],
    ]);
  });
});
