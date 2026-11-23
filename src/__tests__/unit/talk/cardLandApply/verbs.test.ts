/**
 * `talk transcript`, `talk cards`, `talk land` and `talk restore` through their argv: the worked example landing
 * once the voice judged it the card's answer, a hand step and a voice-opened ask left alone, a card put back,
 * a second card landed under the same anchor, and an unreadable ledger line — over a throwaway home and board.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { runTalkCards, runTalkLand, runTalkRestore } from "../../../../cli/commands/talk/cardsRun.js";
import { runTalkTranscript } from "../../../../cli/commands/talk/transcriptRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../cli/exitCodes.js";
import { cardDispatchSlug } from "../../../../talk/cardLanding.js";
import { readCardLandings } from "../../../../talk/cardLandingStore.js";
import {
  ANCHOR,
  active,
  argvFor,
  board,
  CALL,
  CARD,
  HAND,
  home,
  judged,
  MINE,
  stageAsk,
  useCardLandHome,
  waitOf,
} from "./harness.js";

useCardLandHome();

describe("talk transcript, talk cards, talk land and talk restore", () => {
  const batch = ({ answered = true }: { answered?: boolean } = {}): string => {
    const path = join(home, "batch.jsonl");
    const lines = [
      { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
      {
        atIso: "2026-09-25T15:40:00.000Z",
        final: true,
        id: "s-1",
        kind: "segment",
        open: CARD,
        text: "what is a voice mark",
        who: "owner",
      },
      ...(answered ? [judged({ atIso: "2026-09-25T15:40:01.000Z" })] : []),
      {
        atIso: "2026-09-25T15:40:03.000Z",
        final: true,
        id: "v-1",
        kind: "segment",
        open: CARD,
        text: "A voice mark is",
        who: "voice",
      },
    ];
    writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    return path;
  };
  const transcript = async ({ answered = true }: { answered?: boolean } = {}): Promise<number> =>
    runTalkTranscript(
      argvFor({
        rest: ["--call", CALL, "--entries-file", batch({ answered }), "--home", home, "--json"],
        verb: "transcript",
      }),
    );

  it("lands the worked example once the voice judged it the card's answer, and a re-posted batch lands nothing more", async () => {
    expect(await transcript()).toBe(EXIT_OK);
    expect(active()).toEqual([{ anchor: ANCHOR, cardKey: CARD, workSlug: cardDispatchSlug({ anchor: ANCHOR }) }]);
    expect(await transcript()).toBe(EXIT_OK);
    expect(unwrap(readCardLandings({ home })).rows).toHaveLength(1);
  });

  // Words said with a card open, never relayed as its answer, must not take it off.
  it("lands nothing the voice never judged an answer to the card, and leaves the card on the owner's Queue", async () => {
    expect(await transcript({ answered: false })).toBe(EXIT_OK);
    expect([active(), readdirSync(board)]).toEqual([[], []]);
  });

  it("lands nothing on a hand step, however the voice judged the words", async () => {
    const path = join(home, "hand.jsonl");
    const lines = [
      { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
      {
        atIso: "2026-09-25T15:40:00.000Z",
        final: true,
        id: "s-1",
        kind: "segment",
        open: HAND,
        text: "send it",
        who: "owner",
      },
      judged({ about: HAND, atIso: "2026-09-25T15:40:01.000Z", heard: "send it" }),
      { atIso: "2026-09-25T15:41:00.000Z", kind: "closed", why: null },
    ];
    writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    const rest = ["--call", CALL, "--entries-file", path, "--home", home, "--json"];
    expect(await runTalkTranscript(argvFor({ rest, verb: "transcript" }))).toBe(EXIT_OK);
    expect([active(), readdirSync(board)]).toEqual([[], []]);
  });

  // The voice called open_card on this ask unasked, so an aside over it must not land as its ruling nor remove the
  // card from the owner's Queue.
  it("leaves an ask the voice opened on the owner's Queue whatever they say over it, and rules one they opened", async () => {
    const slug =
      "the-proposal-that-a-bad-db-migration-can-never-break-ci-again-found-with-what-happened-to-it-and-todays-failed-migration-tied-to-it";
    await stageAsk({ slug });
    const aside = "Y- Um... Mm... uh- just coming back to the computer in a minute to have a better look at that";
    const transcriptOf = async ({ callId, openBy }: { callId: string; openBy?: "voice" }): Promise<number> => {
      const path = join(home, `${callId}.jsonl`);
      const lines = [
        { atIso: "2026-10-09T02:50:00.000Z", kind: "open", model: "m", sessionId: callId, voice: "cedar" },
        {
          atIso: "2026-10-09T02:50:51.000Z",
          final: true,
          id: "s-1",
          kind: "segment",
          open: `ask:${slug}`,
          ...(openBy === undefined ? {} : { openBy }),
          text: aside,
          who: "owner",
        },
        // Judged its answer either way, so only who opened the card decides.
        judged({ about: `ask:${slug}`, atIso: "2026-10-09T02:50:53.000Z", heard: aside }),
        { atIso: "2026-10-09T02:50:55.000Z", final: true, id: "v-1", kind: "segment", text: "Sure", who: "voice" },
      ];
      writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
      const rest = ["--call", callId, "--entries-file", path, "--home", home, "--json"];
      return runTalkTranscript(argvFor({ rest, verb: "transcript" }));
    };
    expect(await transcriptOf({ callId: "bbbbbbbb-0000-4000-8000-000000000002", openBy: "voice" })).toBe(EXIT_OK);
    expect([active(), waitOf({ slug }).kind]).toEqual([[], "owner"]);
    expect(await transcriptOf({ callId: CALL })).toBe(EXIT_OK);
    expect(waitOf({ slug })).toEqual({ kind: "already-ruled", words: aside });
  });

  it("puts a card back with restore, and the next batch does not pull it again", async () => {
    expect(await transcript()).toBe(EXIT_OK);
    const restore = ["--card", CARD, "--anchor", "run:r", "--why", "a general remark", "--home", home];
    expect(runTalkRestore(argvFor({ rest: restore, verb: "restore" }))).toBe(EXIT_OK);
    expect(active()).toEqual([]);
    expect(await transcript()).toBe(EXIT_OK);
    expect(active()).toEqual([]);
  });

  it("refuses to restore a card nothing pulled", () => {
    const restore = ["--card", CARD, "--anchor", "run:r", "--why", "nothing", "--home", home];
    expect(runTalkRestore(argvFor({ rest: restore, verb: "restore" }))).toBe(EXIT_ERROR);
  });

  it("lands a second card from a session under the same anchor", async () => {
    expect(await transcript()).toBe(EXIT_OK);
    const land = ["--card", MINE, "--words", "what is a voice mark", "--anchor", ANCHOR];
    const rest = [...land, "--decided", "2026-09-25T15:40:00.000Z", "--dir", board, "--home", home];
    expect(await runTalkLand(argvFor({ rest, verb: "land" }))).toBe(EXIT_OK);
    expect(active().map((row) => [row.cardKey, row.workSlug])).toEqual([
      [CARD, cardDispatchSlug({ anchor: ANCHOR })],
      [MINE, cardDispatchSlug({ anchor: ANCHOR })],
    ]);
  });

  it("reads a ledger line that does not parse as unreadable, never as nothing, and keeps the rows around it", async () => {
    expect(await transcript()).toBe(EXIT_OK);
    writeFileSync(join(home, "talk", "card-landings.jsonl"), "{not json\n", { flag: "a" });
    expect(runTalkCards(argvFor({ rest: ["--home", home, "--json"], verb: "cards" }))).toBe(EXIT_OK);
    const read = unwrap(readCardLandings({ home }));
    expect([read.rows.length, read.unreadable]).toEqual([1, [2]]);
  });
});
