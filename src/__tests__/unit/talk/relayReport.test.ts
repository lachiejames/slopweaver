/*
 * What `talk relay` prints: the console's one-line document, and the lines an operator reads. The typed case is
 * the one that matters most — a steer the owner typed never claims a voice reading, and never claims the chair saw it.
 */
import { describe, expect, it } from "vitest";

import { relayReportLines } from "../../../cli/commands/talk/relayReport.js";
import type { TurnRecord } from "../../../talk/relayStore.js";

const TURN = "a0000017-0000-4000-8000-000000000019";
const AT = "2026-09-26T04:00:00.000Z";

/** One registered relay record, overridable field by field. */
const record = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  about: "",
  anchor: `talk:${TURN}`,
  delivery: { atIso: AT, detail: "typed into workspace:1", kind: "typed", via: "direct" },
  digest: "d",
  heard: "",
  picture: { kind: "none", reason: "screen-not-shared" },
  readsAfter: [],
  registeredAtIso: AT,
  slug: "talk-a00000170000",
  stagedAtIso: AT,
  state: "registered",
  turnId: TURN,
  typed: false,
  words: "check the queue",
  wordsAlone: false,
  ...over,
});

/** No ruling of either kind: what a plain steer carries. */
const NO_RULINGS = { candidateRuling: undefined, ruling: undefined } as const;

describe("relayReportLines", () => {
  it("prints a typed steer's exact words, no voice reading, and never that the chair saw it", () => {
    const typed = record({
      heard: "open the thread\nnot the row",
      picture: { kind: "none", reason: "not-attached" },
      typed: true,
      words: "",
    });
    expect(relayReportLines({ ...NO_RULINGS, json: false, record: typed, replayed: false })).toEqual([
      "talk relay: relayed — talk-a00000170000 is on the board",
      '  their words, typed on the console: "open the thread\nnot the row"',
      "  the voice's reading: none — they typed it",
      "  No image attached.",
      "  supervisor chat: typed — typed into workspace:1",
      "  a row on the board, nothing more — this does not mean the supervisor has seen it",
    ]);
  });

  it("says a replay was already relayed, and names why a spoken reading was dropped", () => {
    const lines = relayReportLines({
      ...NO_RULINGS,
      json: false,
      record: record({ delivery: null, heard: "fix it", readsAfter: ["read_screen"], words: "" }),
      replayed: true,
    });
    expect(lines).toEqual([
      "talk relay: already relayed — talk-a00000170000 is on the board",
      '  their words: "fix it"',
      "  the voice's reading: dropped, only their words carried — it had text the owner did not say in front of it: read screen",
      "  No picture: screen not shared.",
      "  a row on the board, nothing more — this does not mean the supervisor has seen it",
    ]);
  });

  it("writes one JSON line whose reachedChat follows the delivery", () => {
    const [line] = relayReportLines({ ...NO_RULINGS, json: true, record: record({ typed: true }), replayed: false });
    const parsed = JSON.parse(line!) as {
      reachedChat: boolean;
      typed: boolean;
      replayed: boolean;
      ruling: null;
      candidateRuling: null;
    };
    expect([parsed.reachedChat, parsed.typed, parsed.replayed, parsed.ruling, parsed.candidateRuling]).toEqual([
      true,
      true,
      false,
      null,
      null,
    ]);
    const [failed] = relayReportLines({
      ...NO_RULINGS,
      json: true,
      record: record({
        delivery: { atIso: AT, detail: "cmux refused", kind: "failed", refusal: "cmux-access-denied", via: "direct" },
      }),
      replayed: false,
    });
    const parsedFailed = JSON.parse(failed!) as { reachedChat: boolean; delivery: { refusal: string } };
    expect([parsedFailed.reachedChat, parsedFailed.delivery.refusal]).toEqual([false, "cmux-access-denied"]);
  });

  it("names the refusal class and the courier on a relay no courier took", () => {
    const lines = relayReportLines({
      ...NO_RULINGS,
      json: false,
      record: record({
        delivery: {
          atIso: AT,
          detail: "not typed: no courier in the pinned chair took it within 3s",
          kind: "failed",
          refusal: "courier-unavailable",
          via: "courier",
        },
      }),
      replayed: false,
    });
    expect(lines).toContain(
      "  supervisor chat: failed (courier-unavailable), via the chair's courier — not typed: no courier in the pinned chair took it within 3s",
    );
  });

  it("says how many check-in cards a ruling now settles, and why none were when it was refused", () => {
    const ruling = {
      kind: "recorded",
      ruling: {
        actionId: "ev-2",
        covers: "rule",
        kind: "push-back-on-coderabbit",
        place: "acme/acme-admin",
        settled: ["ev-2", "ev-3", "ev-1"],
        written: 3,
      },
    } as const;
    const [line] = relayReportLines({
      candidateRuling: undefined,
      json: true,
      record: record({ about: "act:ev-2" }),
      replayed: false,
      ruling,
    });
    expect((JSON.parse(line!) as { ruling: unknown }).ruling).toEqual({
      cleared: 3,
      covers: "rule",
      kind: "push-back-on-coderabbit",
      place: "acme/acme-admin",
      recorded: true,
    });
    const refused = relayReportLines({
      candidateRuling: undefined,
      json: false,
      record: record({ about: "act:ev-2" }),
      replayed: false,
      ruling: { kind: "refused", why: "act ev-2 already carries the owner's word" },
    });
    expect(refused).toContain("  no ruling recorded — act ev-2 already carries the owner's word");
    const recorded = relayReportLines({
      candidateRuling: undefined,
      json: false,
      record: record({ about: "act:ev-2" }),
      replayed: false,
      ruling,
    });
    expect(recorded).toContain("  their word is now on 3 check-in card(s): push-back-on-coderabbit in acme/acme-admin");
  });

  // A spoken ruling on a candidate never reached the candidate.
  it("says whether the owner's ruling on a candidate is now on it, or that the candidate is still open and why", () => {
    const recorded = {
      kind: "recorded",
      ruling: { candidate: "c-105", promotionOwed: null, reaction: "no", written: true },
    } as const;
    const [line] = relayReportLines({
      candidateRuling: recorded,
      json: true,
      record: record(),
      replayed: false,
      ruling: undefined,
    });
    expect((JSON.parse(line!) as { candidateRuling: unknown }).candidateRuling).toEqual({
      candidate: "c-105",
      promotionOwed: null,
      reaction: "no",
      recorded: true,
      written: true,
    });
    const refused = {
      candidate: "c-999",
      kind: "refused",
      reaction: "no",
      why: "no candidate has the id c-999",
    } as const;
    const [refusedLine] = relayReportLines({
      candidateRuling: refused,
      json: true,
      record: record(),
      replayed: false,
      ruling: undefined,
    });
    expect((JSON.parse(refusedLine!) as { candidateRuling: unknown }).candidateRuling).toEqual({
      candidate: "c-999",
      reaction: "no",
      recorded: false,
      why: "no candidate has the id c-999",
    });
    const lines = relayReportLines({
      candidateRuling: recorded,
      json: false,
      record: record(),
      replayed: true,
      ruling: undefined,
    });
    expect(lines).toContain("  candidate c-105 now carries the owner's ruling: no");
    const open = relayReportLines({
      candidateRuling: refused,
      json: false,
      record: record(),
      replayed: false,
      ruling: undefined,
    });
    expect(open).toContain("  c-999 still open, no ruling recorded — no candidate has the id c-999");
    const owed = relayReportLines({
      candidateRuling: { kind: "recorded", ruling: { ...recorded.ruling, promotionOwed: "c-105 owe a promotion" } },
      json: false,
      record: record(),
      replayed: false,
      ruling: undefined,
    });
    expect(owed).toContain("  candidate c-105 now carries the owner's ruling: no — c-105 owe a promotion");
  });
});
