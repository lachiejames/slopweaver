/**
 * Landing the owner's words on a card whose register has no place for them: one dispatch row carrying the words and
 * the anchor, reused, re-slugged and finished as the ledger and board say — the REAL `landCard` over a
 * throwaway home and board.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { landCard } from "../../../../cli/commands/talk/cardLandApply.js";
import { restoreCard } from "../../../../cli/commands/talk/cardRestoreApply.js";
import { parseHandoverDoc } from "../../../../handover/doc.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { cardDispatchSlug } from "../../../../talk/cardLanding.js";
import { readCardLandings } from "../../../../talk/cardLandingStore.js";
import {
  ANCHOR,
  active,
  board,
  CARD,
  callOnDisk,
  HAND,
  home,
  input,
  MINE,
  RELAY_TURN,
  stageAsk,
  useCardLandHome,
} from "./harness.js";

useCardLandHome();

describe("landing on a card that has no place for the owner's words", () => {
  it("registers one dispatch row carrying the owner's words and the anchor, and takes the card off the owner's queue", async () => {
    const outcome = unwrap(await landCard({ input: input() }));
    const slug = cardDispatchSlug({ anchor: ANCHOR });
    expect([outcome.outcome, outcome.landing.workSlug]).toEqual(["landed", slug]);
    const row = readFileSync(join(board, `${slug}.md`), "utf8");
    expect(row).toContain('"what is a voice mark"');
    expect(row).toContain(ANCHOR);
    expect(active()).toEqual([{ anchor: ANCHOR, cardKey: CARD, workSlug: slug }]);
  });

  // "Uh, good morning" landed on a Twilio hand step and hid it.
  it("refuses a hand step and a greeting on any card, writing no landing and no row", async () => {
    const hand = await landCard({ input: input({ cardKey: HAND, words: "send it" }) });
    const greeting = await landCard({ input: input({ words: "Uh, good morning" }) });
    expect([hand._unsafeUnwrapErr().code, greeting._unsafeUnwrapErr().code]).toEqual([
      "NOT_AN_ANSWER",
      "NOT_AN_ANSWER",
    ]);
    expect(greeting._unsafeUnwrapErr().message).toBe(
      `the owner's words do not land on ${CARD}: "Uh, good morning" is a greeting or filler, never an answer to ${CARD}`,
    );
    expect([unwrap(readCardLandings({ home })).rows, readdirSync(board)]).toEqual([[], []]);
  });

  it("states the workspace a relay's page placed the owner's words in on the dispatch row", async () => {
    const because = "the owner's words answer draft:voice-mark-draft, which is placed in team";
    unwrap(await landCard({ input: input({ workspace: { because, workspace: "team" } }) }));
    const path = join(board, `${cardDispatchSlug({ anchor: ANCHOR })}.md`);
    const text = readFileSync(path, "utf8");
    expect(parseHandoverDoc({ path, text }).workspace).toBe("team");
    expect(text).toContain(`workspaceBecause: ${JSON.stringify(because)}`);
  });

  it("states no workspace on the dispatch row when the caller held none", async () => {
    unwrap(await landCard({ input: input() }));
    const path = join(board, `${cardDispatchSlug({ anchor: ANCHOR })}.md`);
    const text = readFileSync(path, "utf8");
    expect(parseHandoverDoc({ path, text }).workspace).toBeUndefined();
    expect(text).toContain(ANCHOR);
  });

  // The row is registered before its landing is on the ledger, so it was born
  // saying the owner's words would not read — every new console-call card, milliseconds before they could.
  it("quotes the row it registered off the landing it just wrote, and refreshes it when the utterance grows", async () => {
    const slug = cardDispatchSlug({ anchor: ANCHOR });
    const path = join(board, `${slug}.md`);
    const quoted = (): unknown => parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWords;
    callOnDisk({ words: "what is" });
    unwrap(await landCard({ input: input({ words: "what is" }) }));
    const short = quoted();
    callOnDisk({ words: "what is a voice mark" });
    unwrap(await landCard({ input: input() }));
    const held = ({ words }: { words: string }): unknown => ({
      hisWords: { anchor: ANCHOR, atIso: "2026-09-25T15:40:00.000Z", cut: "none", where: "call-landing", words },
      kind: "held",
    });
    expect([short, quoted()]).toEqual([held({ words: "what is" }), held({ words: "what is a voice mark" })]);
  });

  it("leaves the quote of an ask a ruling landed on to the ask's own anchor", async () => {
    await stageAsk({ slug: "the-ask" });
    unwrap(await landCard({ input: input({ cardKey: "ask:the-ask" }) }));
    const path = join(board, "the-ask.md");
    expect(parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWords).toEqual({ kind: "absent" });
  });

  it("lands the same utterance once, however many times it is re-derived", async () => {
    unwrap(await landCard({ input: input() }));
    const again = unwrap(await landCard({ input: input({ nowIso: "2026-09-25T15:42:00.000Z" }) }));
    expect(again.outcome).toBe("already");
    expect(unwrap(readCardLandings({ home })).rows).toHaveLength(1);
  });

  it("points a second card the same words answer at the SAME work row — the owner's 'close BOTH'", async () => {
    unwrap(await landCard({ input: input() }));
    const second = unwrap(await landCard({ input: input({ cardKey: MINE, source: "session" }) }));
    expect(second.landing.workSlug).toBe(cardDispatchSlug({ anchor: ANCHOR }));
    expect(active().map((row) => row.cardKey)).toEqual([CARD, MINE]);
  });

  it("reuses a relay's row the board holds rather than registering a second", async () => {
    await stageAsk({ anchor: `talk:${RELAY_TURN}`, slug: "talk-a00000710000" });
    const landed = unwrap(await landCard({ input: input({ relayTurns: [RELAY_TURN] }) }));
    expect(landed.landing.workSlug).toBe("talk-a00000710000");
  });

  it("reuses a relay's row a session already archived rather than registering a second", async () => {
    await stageAsk({ anchor: `talk:${RELAY_TURN}`, slug: "talk-a00000710000" });
    mkdirSync(join(board, "archive"), { recursive: true });
    renameSync(join(board, "talk-a00000710000.md"), join(board, "archive", "talk-a00000710000.md"));
    const landed = unwrap(await landCard({ input: input({ relayTurns: [RELAY_TURN] }) }));
    expect(landed.landing.workSlug).toBe("talk-a00000710000");
    expect(existsSync(join(board, `${cardDispatchSlug({ anchor: ANCHOR })}.md`))).toBe(false);
  });

  // A refused relay registers no row, and an unrelated row on its slug was adopted as the owner's words' work.
  it("registers the utterance's own row when the relay's slug holds a row that is not the relay's", async () => {
    await stageAsk({ slug: "talk-a00000710000" });
    const landed = unwrap(await landCard({ input: input({ relayTurns: [RELAY_TURN] }) }));
    expect(landed.landing.workSlug).toBe(cardDispatchSlug({ anchor: ANCHOR }));
  });

  // A slug is a short hash, so another row can sit on it; the landing takes the next slug, every time.
  it("registers on the next slug when another row already holds this utterance's, and finds it again", async () => {
    const slug = cardDispatchSlug({ anchor: ANCHOR });
    writeFileSync(join(board, `${slug}.md`), "---\nslug: someone-else\n---\n\nanother row\n");
    const landed = unwrap(await landCard({ input: input() }));
    expect(landed.landing.workSlug).toBe(`${slug}-2`);
    rmSync(join(dirname(stateHomePaths({ home }).talkTurns), "card-landings.jsonl"));
    const again = unwrap(await landCard({ input: input({ nowIso: "2026-09-25T15:42:00.000Z" }) }));
    expect(again.landing.workSlug).toBe(`${slug}-2`);
    expect(existsSync(join(board, `${slug}-3.md`))).toBe(false);
  });

  // Five rows on the utterance's first five slugs refused its landing at every retry.
  it("registers past however many other rows hold this utterance's slugs", async () => {
    const slug = cardDispatchSlug({ anchor: ANCHOR });
    for (const taken of [slug, `${slug}-2`, `${slug}-3`, `${slug}-4`, `${slug}-5`]) {
      writeFileSync(join(board, `${taken}.md`), "---\nslug: someone-else\n---\n\nanother row\n");
    }
    expect(unwrap(await landCard({ input: input() })).landing.workSlug).toBe(`${slug}-6`);
  });

  // A row that only mentions the utterance's anchor is not its row, and must not swallow its words.
  it("never adopts a row on this utterance's slug that merely mentions its anchor", async () => {
    const slug = cardDispatchSlug({ anchor: ANCHOR });
    writeFileSync(join(board, `${slug}.md`), `---\nslug: someone-else\n---\n\nsee ${ANCHOR} for context\n`);
    const landed = unwrap(await landCard({ input: input() }));
    expect(landed.landing.workSlug).toBe(`${slug}-2`);
  });

  // The work goes in before the ledger row, so a landing whose ledger append failed is finished later —
  // by which time a session may have archived the dispatch row it wrote.
  it("finishes a landing whose ledger row never went in onto its own archived dispatch row", async () => {
    unwrap(await landCard({ input: input() }));
    const slug = cardDispatchSlug({ anchor: ANCHOR });
    rmSync(join(dirname(stateHomePaths({ home }).talkTurns), "card-landings.jsonl"));
    mkdirSync(join(board, "archive"), { recursive: true });
    renameSync(join(board, `${slug}.md`), join(board, "archive", `${slug}.md`));
    const finished = unwrap(await landCard({ input: input({ nowIso: "2026-09-25T15:42:00.000Z" }) }));
    expect([finished.outcome, finished.landing.workSlug]).toEqual(["landed", slug]);
    expect(existsSync(join(board, `${slug}.md`))).toBe(false);
  });

  it("lands every word of an utterance whose later segment landed first, on that landing's row", async () => {
    const early = unwrap(await landCard({ input: input({ anchor: `${ANCHOR}-late`, words: "voice mark" }) }));
    const whole = unwrap(await landCard({ input: input({ laterAnchors: [`${ANCHOR}-late`] }) }));
    expect([whole.outcome, whole.landing.workSlug]).toEqual(["landed", early.landing.workSlug]);
    expect(active().map((row) => row.workSlug)).toEqual([early.landing.workSlug, early.landing.workSlug]);
    const rows = unwrap(readCardLandings({ home })).rows;
    expect(rows.map((row) => (row.kind === "landed" ? row.words : row.kind))).toEqual([
      "voice mark",
      "what is a voice mark",
    ]);
    expect(unwrap(await landCard({ input: input({ laterAnchors: [`${ANCHOR}-late`] }) })).outcome).toBe("already");
  });

  it("lands the same utterance again when an overtaken batch had landed fewer of its words", async () => {
    const short = unwrap(await landCard({ input: input({ words: "what is" }) }));
    const grown = unwrap(await landCard({ input: input({}) }));
    expect([grown.outcome, grown.landing.workSlug]).toEqual(["landed", short.landing.workSlug]);
    expect(active().map((row) => row.workSlug)).toEqual([short.landing.workSlug]);
    const words = unwrap(readCardLandings({ home })).rows.map((row) => (row.kind === "landed" ? row.words : row.kind));
    expect(words).toEqual(["what is", "what is a voice mark"]);
    expect(unwrap(await landCard({ input: input({}) })).outcome).toBe("already");
    expect(unwrap(await landCard({ input: input({ words: "what is" }) })).outcome).toBe("already");
  });

  it("leaves a restored later-segment landing restored when its earlier segment arrives", async () => {
    unwrap(await landCard({ input: input({ anchor: `${ANCHOR}-late`, words: "voice mark" }) }));
    unwrap(
      restoreCard({
        input: { anchor: "run:r", cardKey: CARD, home, nowIso: "2026-09-25T16:00:00.000Z", why: "not about it" },
      }),
    );
    const whole = unwrap(await landCard({ input: input({ laterAnchors: [`${ANCHOR}-late`] }) }));
    expect([whole.outcome, whole.landing.anchor]).toEqual(["already", `${ANCHOR}-late`]);
    expect(active()).toEqual([]);
  });

  it("leaves a restored landing restored when more of its words arrive", async () => {
    unwrap(await landCard({ input: input({ words: "what is" }) }));
    unwrap(
      restoreCard({
        input: { anchor: "run:r", cardKey: CARD, home, nowIso: "2026-09-25T16:00:00.000Z", why: "not about it" },
      }),
    );
    expect(unwrap(await landCard({ input: input({}) })).outcome).toBe("already");
    expect(active()).toEqual([]);
  });

  it("refuses a key that names no card, and writes nothing", async () => {
    const error = unwrapErr(await landCard({ input: input({ cardKey: "slack:C1" }) }));
    expect(error.code).toBe("CARD_KEY_INVALID");
    expect(unwrap(readCardLandings({ home })).rows).toEqual([]);
  });
});
