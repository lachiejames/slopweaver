/**
 * A card a settle KEPT: the restore lifts only that relay's landings, holds against a landing of that relay written
 * later, and carries the reason the queue shows. The fold is driven with rows; the writer and a real relay landing
 * run against a temp home this file mints (`testing.md`).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { askRowText } from "../../../cli/commands/handover/askRowText.js";
import { landCard } from "../../../cli/commands/talk/cardLandApply.js";
import { unwrap } from "../../../lib/result.js";
import { keepCardForRelay } from "../../../talk/cardKeep.js";
import {
  activeCardLandings,
  type CardLandedRow,
  type CardRestoredRow,
  cardLandingRowOf,
  keptReasons,
  repeatLanding,
} from "../../../talk/cardLanding.js";
import { readCardLandings } from "../../../talk/cardLandingStore.js";

// A draft card: a hand step never takes words at all (`cardAnswer.ts`), so a keep on one has nothing to hold against.
const CARD = "draft:voice-mark-draft";
const TURN_A = "a0000017-0000-4000-8000-000000000019";
const RELAY_A = `talk:${TURN_A}`;
const ROW_A = "talk-a00000170000";
const RELAY_B = "talk:a0000043-0000-4000-8000-000000000046";
const ROW_B = "talk-a00000430000";
const NOW = "2026-09-27T09:00:00.000Z";

const landed = ({
  anchor,
  workSlug,
  cardKey = CARD,
}: {
  anchor: string;
  workSlug: string;
  cardKey?: string;
}): CardLandedRow => ({
  anchor,
  atIso: "2026-09-27T08:05:00.000Z",
  cardKey,
  decidedIso: "2026-09-27T08:04:00.000Z",
  kind: "landed",
  source: anchor.startsWith("talk:") ? "relay" : "transcript",
  words: "explain this card to me",
  workSlug,
});

const kept = ({ why = "asked what it means, not to close it" }: { why?: string } = {}): CardRestoredRow => ({
  anchor: RELAY_A,
  atIso: NOW,
  cardKey: CARD,
  disposition: "kept",
  kind: "restored",
  why,
  workSlug: ROW_A,
});

describe("a kept restore in the fold", () => {
  it("lifts relay A's landing and leaves relay B's steer holding the card", () => {
    const a = landed({ anchor: RELAY_A, workSlug: ROW_A });
    const b = landed({ anchor: RELAY_B, workSlug: ROW_B });
    expect(activeCardLandings({ rows: [a, b, kept()] })).toEqual([b]);
  });

  it("lifts the transcript's landing of relay A's words, whose work is relay A's row", () => {
    const heard = landed({ anchor: "call:c1#s-4", workSlug: ROW_A });
    expect(activeCardLandings({ rows: [heard, kept()] })).toEqual([]);
  });

  it("leaves a second relay sharing relay A's row slug holding the card, since its anchor is not A's", () => {
    const sameSlug = landed({ anchor: "talk:a0000017-0000-4000-8000-000000000018", workSlug: ROW_A });
    expect(activeCardLandings({ rows: [sameSlug, kept()] })).toEqual([sameSlug]);
  });

  it("holds against relay A's landing written AFTER it, late", () => {
    const late = landed({ anchor: RELAY_A, workSlug: ROW_A });
    expect(activeCardLandings({ rows: [kept(), late] })).toEqual([]);
  });

  it("lets a genuinely new utterance, on its own work row, land after it", () => {
    const fresh = landed({ anchor: "call:c1#s-9", workSlug: "talk-card-0123456789ab" });
    expect(activeCardLandings({ rows: [kept(), fresh] })).toEqual([fresh]);
  });

  it("is still card-wide to a plain restore, which lifts every earlier landing", () => {
    const b = landed({ anchor: RELAY_B, workSlug: ROW_B });
    const plain: CardRestoredRow = { anchor: "run:x", atIso: NOW, cardKey: CARD, kind: "restored", why: "general" };
    expect(activeCardLandings({ rows: [b, plain] })).toEqual([]);
  });

  it("reads the transcript's later landing of relay A's words as a repeat once A was kept", () => {
    const a = landed({ anchor: RELAY_A, workSlug: ROW_A });
    const again = repeatLanding({
      anchor: "call:c1#s-4",
      cardKey: CARD,
      laterAnchors: [],
      relayTurns: [TURN_A],
      rows: [a, kept()],
      words: "explain this card to me",
      wordsCut: false,
    });
    expect(again).toEqual(a);
  });

  it("does not read relay B's words as a repeat because relay A was kept", () => {
    const b = landed({ anchor: RELAY_B, workSlug: ROW_B });
    const again = repeatLanding({
      anchor: "call:c1#s-7",
      cardKey: CARD,
      laterAnchors: [],
      relayTurns: ["a0000043-0000-4000-8000-000000000046"],
      rows: [b, kept()],
      words: "and the other thing",
      wordsCut: false,
    });
    expect(again).toBe(undefined);
  });

  it("carries the latest kept reason per card", () => {
    expect(keptReasons({ rows: [kept({ why: "first" }), kept({ why: "second" })] })).toEqual(
      new Map([[CARD, "second"]]),
    );
  });

  it("round-trips through the ledger's own parser, and a reader drops no field of it", () => {
    expect(cardLandingRowOf({ value: JSON.parse(JSON.stringify(kept())) })).toEqual(kept());
    expect(cardLandingRowOf({ value: { ...kept(), disposition: "gone" } })).toBe(undefined);
  });
});

describe("keepCardForRelay", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "card-keep-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const keep = ({ why }: { why: string }) =>
    keepCardForRelay({ cardKey: CARD, home, nowIso: NOW, relayAnchor: RELAY_A, why, workSlug: ROW_A });

  it("writes the kept row with no landing active, and nothing on the exact retry", () => {
    expect(unwrap(keep({ why: "explain" }))).toBe("kept");
    expect(unwrap(keep({ why: "explain" }))).toBe("already-kept");
    expect(unwrap(readCardLandings({ home })).rows).toEqual([{ ...kept({ why: "explain" }) }]);
  });

  it("writes a second row when the reason changed, and the newer one is the one shown", () => {
    unwrap(keep({ why: "first" }));
    expect(unwrap(keep({ why: "second" }))).toBe("kept");
    expect(keptReasons({ rows: unwrap(readCardLandings({ home })).rows }).get(CARD)).toBe("second");
  });

  it("writes the reason again when it changes back, so the latest keep is the one shown", () => {
    unwrap(keep({ why: "first" }));
    unwrap(keep({ why: "second" }));
    expect(unwrap(keep({ why: "first" }))).toBe("kept");
    expect(keptReasons({ rows: unwrap(readCardLandings({ home })).rows }).get(CARD)).toBe("first");
  });

  it("keeps the card up when the relay's own landing arrives after the keep", async () => {
    const dir = join(home, "board");
    mkdirSync(dir, { recursive: true });
    const row = askRowText({
      anchor: RELAY_A,
      ask: "explain this card to me",
      askedIso: "2026-09-27T08:04:00Z",
      branch: undefined,
      checkedIso: "2026-09-27T08:04:01Z",
      dispatch: false,
      finding: undefined,
      priority: undefined,
      repo: undefined,
      shape: undefined,
      slug: ROW_A,
    });
    writeFileSync(join(dir, `${ROW_A}.md`), row);
    unwrap(keep({ why: "explain" }));
    const late = unwrap(
      await landCard({
        input: {
          anchor: RELAY_A,
          cardKey: CARD,
          decidedIso: "2026-09-27T08:04:00.000Z",
          handoverDir: dir,
          home,
          laterAnchors: [],
          nowIso: "2026-09-27T09:05:00.000Z",
          relayTurns: [TURN_A],
          source: "relay",
          words: "explain this card to me",
          wordsCut: undefined,
          workspace: undefined,
        },
      }),
    );
    expect(late.landing.workSlug).toBe(ROW_A);
    expect(activeCardLandings({ rows: unwrap(readCardLandings({ home })).rows })).toEqual([]);
    expect(readFileSync(join(dir, `${ROW_A}.md`), "utf8")).toBe(row);
  });
});
