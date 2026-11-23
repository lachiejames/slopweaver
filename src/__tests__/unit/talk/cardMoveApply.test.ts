/*
 * Applying a call's Queue-walk moves on disk: `talk transcript` writes a moved-on row for a move on and a deferral for
 * a "come back to it", a batch posted again writes nothing twice, and `talk restore` lifts a move for good. Every home
 * is a `mkdtempSync` directory removed after the test that minted it.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyCallMoves, movesOwed } from "../../../cli/commands/talk/cardMoveApply.js";
import { restoreCard } from "../../../cli/commands/talk/cardRestoreApply.js";
import { runTalkTranscript } from "../../../cli/commands/talk/transcriptRun.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { appendCardDeferral, readCardDeferrals } from "../../../queueDefer/cardDeferralStore.js";
import { type CallEntry, callEntryOf } from "../../../talk/callRecord.js";
import { readCardLandings } from "../../../talk/cardLandingStore.js";
import { activeCardMoves } from "../../../talk/cardMoveLedger.js";
import { appendCardMove, readCardMoves } from "../../../talk/cardMoveStore.js";

const CALL = "0f1e2d3c-4b5a-4968-8776-655443322110";
const NOW = "2026-11-02T12:40:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "card-move-"));
  mkdirSync(join(home, "handovers"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The call's lines: the owner spoke over the ask, then the walk moved on from it and came back off the next one. */
const LINES: readonly Record<string, unknown>[] = [
  { atIso: "2026-11-02T12:35:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
  {
    atIso: "2026-11-02T12:36:00.000Z",
    final: true,
    id: "s-1",
    kind: "segment",
    open: "ask:acme-1",
    text: "hmm ok",
    who: "owner",
  },
  {
    atIso: "2026-11-02T12:37:16.000Z",
    disposition: "moved-on",
    fromCardKey: "ask:acme-1",
    fromSinceIso: "2026-11-02T12:35:30.000Z",
    kind: "card-move",
    requestId: "req-1",
    toCardKey: "post:sd-1",
  },
  {
    atIso: "2026-11-02T12:38:00.000Z",
    disposition: "come-back",
    fromCardKey: "post:sd-1",
    fromSinceIso: "2026-11-02T12:37:16.000Z",
    kind: "card-move",
    requestId: "req-2",
    toCardKey: "ask:acme-3",
  },
];

const ENTRIES: readonly CallEntry[] = LINES.map((value) => callEntryOf({ value })!);

describe("applyCallMoves", () => {
  it("takes the card the owner moved on from off their Queue, defers the one they will come back to, and writes nothing twice", () => {
    expect(applyCallMoves({ callId: CALL, entries: ENTRIES, home, nowIso: NOW })).toEqual({ failed: [], written: 2 });
    expect(applyCallMoves({ callId: CALL, entries: ENTRIES, home, nowIso: NOW })).toEqual({ failed: [], written: 0 });
    expect(unwrap(readCardMoves({ home })).rows).toEqual([
      {
        anchor: `call:${CALL}#move:req-1`,
        atIso: NOW,
        cardKey: "ask:acme-1",
        decidedIso: "2026-11-02T12:37:16.000Z",
        kind: "moved-on",
        toCardKey: "post:sd-1",
        words: "hmm ok",
      },
    ]);
    expect(unwrap(readCardDeferrals({ home })).rows.map((row) => [row.cardKey, row.action, row.bySession])).toEqual([
      ["post:sd-1", "defer", `call:${CALL}#move:req-2`],
    ]);
  });

  it("writes nothing for a call whose walk never moved", () => {
    expect(applyCallMoves({ callId: CALL, entries: ENTRIES.slice(0, 2), home, nowIso: NOW })).toEqual({
      failed: [],
      written: 0,
    });
  });
});

// The owed sweep has to see a move that never wrote, though every word of its call landed.
describe("movesOwed", () => {
  it("owes a call whose moves are not on file, and nothing once they are or when the walk never moved", () => {
    const before = movesOwed({ callId: CALL, entries: ENTRIES, home });
    applyCallMoves({ callId: CALL, entries: ENTRIES, home, nowIso: NOW });
    expect([
      before,
      movesOwed({ callId: CALL, entries: ENTRIES, home }),
      movesOwed({ callId: CALL, entries: ENTRIES.slice(0, 2), home }),
    ]).toEqual([true, false, false]);
  });
});

describe("the moved-on ledger", () => {
  it("writes the file 0600, and counts a line that does not parse rather than dropping it", () => {
    applyCallMoves({ callId: CALL, entries: ENTRIES, home, nowIso: NOW });
    const read = unwrap(readCardMoves({ home }));
    expect(statSync(read.path).mode & 0o777).toBe(0o600);
    appendFileSync(read.path, "not json\n");
    expect(unwrap(readCardMoves({ home })).unreadable).toEqual([2]);
  });

  it("refuses a row its own reader would not read back", () => {
    const row = unwrap(readCardMoves({ home })).rows;
    expect(row).toEqual([]);
    const bad = appendCardMove({
      home,
      row: { anchor: "a", atIso: NOW, cardKey: "nope", decidedIso: NOW, kind: "moved-on", toCardKey: "ask:acme-2" },
    });
    expect(unwrapErr(bad).message).toContain("does not read back");
  });
});

describe("talk restore over a move", () => {
  it("lifts the move, and the same batch posted again never takes the card off again", () => {
    applyCallMoves({ callId: CALL, entries: ENTRIES, home, nowIso: NOW });
    const restored = unwrap(
      restoreCard({
        input: { anchor: "run:r", cardKey: "ask:acme-1", home, nowIso: "2026-11-02T12:41:00.000Z", why: "not done" },
      }),
    );
    expect(restored.movesLifted).toBe(1);
    const landings = unwrap(readCardLandings({ home })).rows;
    const active = (): readonly string[] =>
      activeCardMoves({ landings, moves: unwrap(readCardMoves({ home })).rows }).map((row) => row.cardKey);
    expect(active()).toEqual([]);
    applyCallMoves({ callId: CALL, entries: ENTRIES, home, nowIso: "2026-11-02T12:42:00.000Z" });
    expect(active()).toEqual([]);
  });

  // A move whose first write failed, retried by the owed sweep after the owner's restore, must not hide
  // the card again for being dated after it.
  it("never writes a move the owner's restore came after, however late the retry", () => {
    const earlier = {
      anchor: "call:other#move:r-0",
      atIso: "2026-11-02T12:36:30.000Z",
      cardKey: "ask:acme-1",
      decidedIso: "2026-11-02T12:36:30.000Z",
      kind: "moved-on",
      toCardKey: "ask:acme-2",
    } as const;
    unwrap(appendCardMove({ home, row: earlier }));
    unwrap(
      restoreCard({
        input: { anchor: "run:r", cardKey: "ask:acme-1", home, nowIso: "2026-11-02T12:41:00.000Z", why: "not done" },
      }),
    );
    applyCallMoves({ callId: CALL, entries: ENTRIES, home, nowIso: "2026-11-02T12:42:00.000Z" });
    const landings = unwrap(readCardLandings({ home })).rows;
    const moves = unwrap(readCardMoves({ home })).rows;
    expect([moves.map((row) => row.anchor), activeCardMoves({ landings, moves })]).toEqual([
      ["call:other#move:r-0"],
      [],
    ]);
  });

  // A come-back whose deferral write failed, retried after the owner put the card back, must not
  // re-defer it.
  it("never re-defers a card the owner put back after they said to come back to it, however late the retry", () => {
    const restore = {
      action: "restore",
      bySession: "sess",
      cardKey: "post:sd-1",
      pressedIso: "2026-11-02T12:39:00.000Z",
    } as const;
    unwrap(appendCardDeferral({ home, row: restore }));
    applyCallMoves({ callId: CALL, entries: ENTRIES, home, nowIso: "2026-11-02T12:42:00.000Z" });
    expect(unwrap(readCardDeferrals({ home })).rows.map((row) => [row.cardKey, row.action])).toEqual([
      ["post:sd-1", "restore"],
    ]);
  });
});

describe("talk transcript", () => {
  it("applies a batch's card-move lines under the card-landing lock", async () => {
    const path = join(home, "batch.jsonl");
    writeFileSync(path, LINES.map((line) => `${JSON.stringify(line)}\n`).join(""));
    const argv = ["node", "slopweaver", "talk", "transcript", "--call", CALL, "--entries-file", path, "--home", home];
    expect(await runTalkTranscript(argv)).toBe(EXIT_OK);
    expect(unwrap(readCardMoves({ home })).rows.map((row) => [row.cardKey, row.toCardKey])).toEqual([
      ["ask:acme-1", "post:sd-1"],
    ]);
    expect(unwrap(readCardDeferrals({ home })).rows.map((row) => row.cardKey)).toEqual(["post:sd-1"]);
  });
});
