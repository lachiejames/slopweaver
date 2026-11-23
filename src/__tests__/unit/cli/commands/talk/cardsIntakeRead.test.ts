/**
 * `talk cards`' intake edge over a real home: the chair's mark and the call it names, written with the stores' own
 * writers and read back — a card turned down by voice while the voice had it open.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { landingsWithIntake } from "../../../../../cli/commands/talk/cardsIntakeRead.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { appendIntakeMark } from "../../../../../supervisor/intakeStore.js";
import { appendCallEntries, callsDir } from "../../../../../talk/callStore.js";
import type { CardLandedRow } from "../../../../../talk/cardLanding.js";
import type { TurnRecord } from "../../../../../talk/relayStore.js";

const CALL = "a0000044-0000-4000-8000-000000000047";
const SEGMENT = "turn_000000000000000000021";
const CARD = "ask:owner-steer-console-call-5a50c50e-01-56z-01";
const RELAY = "talk-a00000280000";
const BEGAN = "2026-10-13T23:36:10.909Z";
const MARKED = "2026-10-13T23:38:42.192Z";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** `talk relay`'s receipt for the relay the voice made of the owner's words, said whole. */
const RECEIPT: TurnRecord = {
  about: "",
  anchor: "talk:a0000028-0000-4000-8000-000000000031",
  delivery: null,
  digest: "d",
  heard: "that is all from me. I turn this card down",
  heardTailCut: false,
  picture: { kind: "none", reason: "screen-not-shared" },
  readsAfter: [],
  registeredAtIso: MARKED,
  slug: RELAY,
  stagedAtIso: MARKED,
  state: "registered",
  turnId: "a0000028-0000-4000-8000-000000000031",
  typed: false,
  words: "that is all from me. I turn this card down",
  wordsAlone: false,
};

/**
 * A throwaway home with the chair's mark on that turn, the call when `withCall`, the receipt when `relayed`.
 *
 * @param relayed whether the relay ledger holds the receipt
 * @param withCall whether the call the mark names is written
 * @param receipt the receipt written, {@link RECEIPT} unless a test rules the card
 * @param torn an undecodable relay line written after the receipt
 * @returns the home
 */
function homeWith({
  relayed = true,
  withCall,
  receipt = RECEIPT,
  torn = false,
}: {
  relayed?: boolean;
  withCall: boolean;
  receipt?: TurnRecord;
  torn?: boolean;
}): string {
  const home = mkdtempSync(join(tmpdir(), "cards-intake-"));
  homes.push(home);
  if (relayed) {
    const ledger = stateHomePaths({ home }).talkRelaysJsonl;
    mkdirSync(dirname(ledger), { recursive: true });
    writeFileSync(ledger, `${JSON.stringify(receipt)}\n${torn ? '{"slug":7}\n' : ""}`);
  }
  const pointer = `talk-call:${CALL}#${SEGMENT}`;
  appendIntakeMark({
    home,
    mark: { byClaudeSessionId: "chair", kind: "answered", markedAtIso: MARKED, pointer, witness: RELAY },
  });
  if (withCall) {
    const entry = {
      atIso: "2026-10-13T23:37:40.000Z",
      beganIso: BEGAN,
      final: true,
      id: SEGMENT,
      kind: "segment",
      open: CARD,
      openBy: "voice",
      text: "that is all from me. I turn this card down",
      who: "owner",
    } as const;
    unwrap(appendCallEntries({ callId: CALL, entries: [entry], home }));
  }
  return home;
}

describe("landingsWithIntake", () => {
  it("lands the chair's relayed mark on the card the voice had open, reading the call it names", () => {
    const result = landingsWithIntake({ home: homeWith({ withCall: true }), ledgerRows: [] });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      intakeGaps: [],
      landings: [
        {
          anchor: `call:${CALL}#${SEGMENT}`,
          atIso: MARKED,
          cardKey: CARD,
          decidedIso: BEGAN,
          kind: "landed",
          source: "intake",
          words: "that is all from me. I turn this card down",
          workSlug: RELAY,
        },
      ],
      triageUnreadable: 0,
    });
  });

  // Voice-triage follow-ups: the Queue reads a park off the landing, label beside it.
  it("carries the triage ruling of the relay a landing names, and counts a relay line that did not read", () => {
    const receipt: TurnRecord = {
      ...RECEIPT,
      triageRuling: { label: "waiting-on-them", verdict: "park-working-session" },
    };
    const value = unwrap(
      landingsWithIntake({ home: homeWith({ receipt, torn: true, withCall: true }), ledgerRows: [] }),
    );
    expect(value.landings.map((landing) => landing.triage)).toEqual([
      { label: "waiting-on-them", verdict: "park-working-session" },
    ]);
    expect(value.triageUnreadable).toBe(1);
  });

  it("carries no triage beside a landing whose relay carried no ruling, or a null one", () => {
    const value = unwrap(
      landingsWithIntake({
        home: homeWith({ receipt: { ...RECEIPT, triageRuling: null }, withCall: true }),
        ledgerRows: [],
      }),
    );
    expect(value.landings.map((landing) => Object.hasOwn(landing, "triage"))).toEqual([false]);
  });

  // `markRegistered` writes the turn before the receipt, so a crash between them left the park
  // unread, whether the landing named the relay by its anchor or by its work row.
  it("carries the park off a registered turn file whose receipt line a crash lost, and counts one that does not read", () => {
    const home = homeWith({ relayed: false, withCall: false });
    const parked: TurnRecord = {
      ...RECEIPT,
      about: "ask:q1",
      triageRuling: { label: "waiting-on-them", verdict: "park-working-session" },
    };
    mkdirSync(stateHomePaths({ home }).talkTurns, { recursive: true });
    writeFileSync(join(stateHomePaths({ home }).talkTurns, `${RECEIPT.turnId}.json`), `${JSON.stringify(parked)}\n`);
    const landed = ({
      anchor,
      cardKey,
      workSlug,
    }: {
      anchor: string;
      cardKey: string;
      workSlug: string;
    }): CardLandedRow => ({
      anchor,
      atIso: MARKED,
      cardKey,
      decidedIso: MARKED,
      kind: "landed",
      source: "relay",
      words: "park it",
      workSlug,
    });
    const value = unwrap(
      landingsWithIntake({
        home,
        ledgerRows: [
          landed({ anchor: RECEIPT.anchor, cardKey: "ask:q1", workSlug: "q1" }),
          landed({ anchor: "talk:a0000042-0000-4000-8000-000000000045", cardKey: "ask:q2", workSlug: "q2" }),
          landed({ anchor: `call:${CALL}#${SEGMENT}`, cardKey: "ask:q3", workSlug: RELAY }),
          landed({ anchor: `call:${CALL}#${SEGMENT}`, cardKey: "ask:q4", workSlug: "talk-0123456789ab" }),
        ],
      }),
    );
    expect(value.landings.map((landing) => [landing.cardKey, landing.triage])).toEqual([
      ["ask:q1", { label: "waiting-on-them", verdict: "park-working-session" }],
      ["ask:q2", undefined],
      ["ask:q3", { label: "waiting-on-them", verdict: "park-working-session" }],
      ["ask:q4", undefined],
    ]);
    expect(value.triageUnreadable).toBe(2);
  });

  it("names the mark it could not judge when the call it points at does not read", () => {
    const home = homeWith({ withCall: false });
    mkdirSync(join(callsDir({ home }), `${CALL}.jsonl`), { recursive: true });
    const value = unwrap(landingsWithIntake({ home, ledgerRows: [] }));
    expect(value.landings).toEqual([]);
    expect(value.intakeGaps.map((gap) => gap.pointer)).toEqual([`talk-call:${CALL}#${SEGMENT}`]);
  });

  it("lands nothing, and names no gap, for a mark whose call holds no segment of the owner's", () => {
    expect(unwrap(landingsWithIntake({ home: homeWith({ withCall: false }), ledgerRows: [] }))).toEqual({
      intakeGaps: [],
      landings: [],
      triageUnreadable: 0,
    });
  });

  it("lands nothing for a witness shaped like a relay that no receipt carries, and names it", () => {
    const value = unwrap(landingsWithIntake({ home: homeWith({ relayed: false, withCall: true }), ledgerRows: [] }));
    expect(value).toEqual({
      intakeGaps: [{ pointer: `talk-call:${CALL}#${SEGMENT}`, why: `${RELAY} is no relay the receipt ledger carries` }],
      landings: [],
      triageUnreadable: 0,
    });
  });

  it("refuses, naming the ledger, when the intake marks do not read", () => {
    const home = mkdtempSync(join(tmpdir(), "cards-intake-"));
    homes.push(home);
    mkdirSync(join(home, "sessions", "intake-marks.jsonl"), { recursive: true });
    writeFileSync(join(home, "sessions", "intake-marks.jsonl", "x"), "");
    const result = landingsWithIntake({ home, ledgerRows: [] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("INTAKE_MARKS_UNREADABLE");
  });
});
