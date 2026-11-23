/**
 * The triage card in front of the owner as the server heard it (`../../lib/triagePresented.ts`): only the visit a seated
 * call's successful `triage_next` last named holds, and no older call can replace or clear what a newer one named.
 */
import { describe, expect, it } from "vitest";

import { processTriagePresented, TriagePresented } from "../../lib/triagePresented";

/** Two visits, as the page's pass names them. */
const FIRST = "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c-1";
const SECOND = "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c-2";

/** A tool's arguments as the server received them: none, and a `triage_clock` pausing and restarting the clock. */
const NONE = "{}";
const PAUSED = JSON.stringify({ state: "paused" });
const RUNNING = JSON.stringify({ state: "running" });

/** How many tool calls the tests have claimed, so each gets its own token. */
let minted = 0;

/**
 * A fresh tool call token.
 *
 * @returns the token
 */
function token(): string {
  minted += 1;
  return `token-${String(minted)}`;
}

/**
 * A record with one seated call, as a voice call made on the server leaves it.
 *
 * @returns the record and the seated call's identity
 */
function seated(): { triage: TriagePresented; call: object } {
  const triage = new TriagePresented();
  const call = {};
  triage.seat({ call, mode: "fresh" });
  return { call, triage };
}

/**
 * One tool call claimed by the page and then answered, as the claim and answer routes report it.
 *
 * @param rawArguments the call's arguments as the server received them
 * @param success whether the tool succeeded
 * @param triageVisit the visit the answer says it put up
 * @param turnId the answer the tool call came in, none when left out
 * @returns whether the answer was taken
 */
function settle({
  call,
  rawArguments = NONE,
  success = true,
  tool,
  triage,
  triageVisit,
  turnId,
}: {
  call: object;
  rawArguments?: string;
  success?: boolean;
  tool: string;
  triage: TriagePresented;
  triageVisit: string | undefined;
  turnId?: string;
}): boolean {
  const claimedAs = token();
  triage.claimed({ call, rawArguments, token: claimedAs, tool, turnId });
  return triage.answered({ call, rawArguments, success, token: claimedAs, tool, triageVisit });
}

describe("TriagePresented", () => {
  it("holds nothing until a call names a visit", () => {
    const { call, triage } = seated();
    expect([triage.holds({ call, visitId: FIRST }), triage.holds({ call, visitId: SECOND })]).toEqual([false, false]);
  });

  it("holds the visit a seated call's successful triage_next names, and only that one", () => {
    const { call, triage } = seated();
    expect(settle({ call, tool: "triage_next", triage, triageVisit: FIRST })).toBe(true);
    expect([triage.holds({ call, visitId: FIRST }), triage.holds({ call, visitId: SECOND })]).toEqual([true, false]);
  });

  it("ignores an unseated call's answer, and never lets an unseated call say a named visit's line", () => {
    const { call, triage } = seated();
    const unseated = {};
    expect(settle({ call: unseated, tool: "triage_next", triage, triageVisit: FIRST })).toBe(false);
    settle({ call, tool: "triage_next", triage, triageVisit: SECOND });
    expect([triage.holds({ call, visitId: FIRST }), triage.holds({ call: unseated, visitId: SECOND })]).toEqual([
      false,
      false,
    ]);
  });

  it("names nothing for an answer to a call the page never claimed", () => {
    const { call, triage } = seated();
    expect([
      triage.answered({
        call,
        rawArguments: NONE,
        success: true,
        token: token(),
        tool: "triage_next",
        triageVisit: FIRST,
      }),
      triage.holds({ call, visitId: FIRST }),
    ]).toEqual([false, false]);
  });

  it("names nothing for a triage_next or restarting triage_clock whose tool failed", () => {
    const { call, triage } = seated();
    expect([
      settle({ call, success: false, tool: "triage_next", triage, triageVisit: FIRST }),
      triage.holds({ call, visitId: FIRST }),
      settle({ call, rawArguments: RUNNING, success: false, tool: "triage_clock", triage, triageVisit: FIRST }),
      triage.holds({ call, visitId: FIRST }),
    ]).toEqual([false, false, true, false]);
  });

  // The page stops the clock before opening a card, so a refused open_card had stopped it all the same.
  // A failed restart carrying the card must be cleared or named, never left holding the card.
  it("is cleared by a failed open_card, triage_end, pausing or restarting triage_clock", () => {
    const after = [
      { rawArguments: NONE, tool: "open_card", triageVisit: undefined },
      { rawArguments: NONE, tool: "triage_end", triageVisit: undefined },
      { rawArguments: PAUSED, tool: "triage_clock", triageVisit: undefined },
      { rawArguments: RUNNING, tool: "triage_clock", triageVisit: FIRST },
    ].map(({ rawArguments, tool, triageVisit }) => {
      const { call, triage } = seated();
      settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
      return [
        settle({ call, rawArguments, success: false, tool, triage, triageVisit }),
        triage.holds({ call, visitId: FIRST }),
      ];
    });
    expect(after).toEqual([
      [true, false],
      [true, false],
      [true, false],
      [true, false],
    ]);
  });

  it("ignores a visit beside any tool but triage_next or triage_clock", () => {
    const { call, triage } = seated();
    expect(settle({ call, tool: "file_read", triage, triageVisit: FIRST })).toBe(false);
    expect(triage.holds({ call, visitId: FIRST })).toBe(false);
  });

  // A stray visit beside a clearing answer must not take the naming branch and leave the stopped card held.
  it("is cleared by an open_card or triage_end answer carrying a visit beside it, which it never names", () => {
    const after = ["open_card", "triage_end"].map((tool) => {
      const { call, triage } = seated();
      settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
      return [
        settle({ call, tool, triage, triageVisit: SECOND }),
        triage.holds({ call, visitId: FIRST }),
        triage.holds({ call, visitId: SECOND }),
      ];
    });
    expect(after).toEqual([
      [true, false, false],
      [true, false, false],
    ]);
  });

  it("is cleared by an open_card or a pausing triage_clock, so a due request delayed past either finds no card", () => {
    const cleared = [
      { rawArguments: NONE, tool: "open_card" },
      { rawArguments: PAUSED, tool: "triage_clock" },
    ].map(({ rawArguments, tool }) => {
      const { call, triage } = seated();
      settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
      return [
        settle({ call, rawArguments, tool, triage, triageVisit: undefined }),
        triage.holds({ call, visitId: FIRST }),
      ];
    });
    expect(cleared).toEqual([
      [true, false],
      [true, false],
    ]);
  });

  it("holds the visit again once a triage_clock answer restarted its clock", () => {
    const { call, triage } = seated();
    settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
    settle({ call, rawArguments: PAUSED, tool: "triage_clock", triage, triageVisit: undefined });
    expect(settle({ call, rawArguments: RUNNING, tool: "triage_clock", triage, triageVisit: FIRST })).toBe(true);
    expect(triage.holds({ call, visitId: FIRST })).toBe(true);
  });

  // Pause or resume is read from the model's own arguments, never from whether the page sent a visit.
  it("is cleared by a pausing triage_clock even with a visit beside it, and by one whose arguments do not read", () => {
    const after = [PAUSED, "not json"].map((rawArguments) => {
      const { call, triage } = seated();
      settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
      return [
        settle({ call, rawArguments, tool: "triage_clock", triage, triageVisit: FIRST }),
        triage.holds({ call, visitId: FIRST }),
      ];
    });
    expect(after).toEqual([
      [true, false],
      [true, false],
    ]);
  });

  // The owner's ruling stops the page's clock, and the relay carrying it must not leave the card held on the server.
  it("is cleared by a relay_steer carrying the owner's triage ruling, or whose arguments do not read, and kept by any other relay", () => {
    const after = [
      JSON.stringify({ say: "park it", triage: "park-working-session", triage_card: "act:ev-1" }),
      "not json",
      JSON.stringify({ say: "tell them thanks" }),
    ].map((rawArguments) => {
      const { call, triage } = seated();
      settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
      return [
        settle({ call, rawArguments, tool: "relay_steer", triage, triageVisit: undefined }),
        triage.holds({ call, visitId: FIRST }),
      ];
    });
    expect(after).toEqual([
      [true, false],
      [true, false],
      [false, true],
    ]);
  });

  // Codex final-tree r2: a ruling from an older answer, on the card before, cleared the card a newer answer put up,
  // so that card's time-up line was refused while the page's clock on it ran on.
  it("keeps the card up past a ruling from an answer begun on the card before, and clears it for one begun on it or never heard (Codex final-tree r2)", () => {
    const ruling = JSON.stringify({ say: "park it", triage: "park-working-session" });
    const after = ["began-on-first", "began-on-second", "never-heard"].map((turnId) => {
      const { call, triage } = seated();
      settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
      triage.turnStarted({ call, turnId: "began-on-first" });
      settle({ call, tool: "triage_next", triage, triageVisit: SECOND, turnId: "puts-up-second" });
      triage.turnStarted({ call, turnId: "began-on-first" });
      triage.turnStarted({ call, turnId: "began-on-second" });
      settle({ call, rawArguments: ruling, tool: "relay_steer", triage, triageVisit: undefined, turnId });
      return triage.holds({ call, visitId: SECOND });
    });
    expect(after).toEqual([true, false, false]);
  });

  // Codex fx-01: an unclaimed failed answer lost its turn, so an older answer's ruling cleared the card now up.
  it("keeps the card up past a ruling the page never claimed, which never ran", () => {
    const { call, triage } = seated();
    settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
    triage.turnStarted({ call, turnId: "began-on-first" });
    settle({ call, tool: "triage_next", triage, triageVisit: SECOND });
    const rawArguments = JSON.stringify({ say: "park it", triage: "park-working-session" });
    expect(
      triage.answered({
        call,
        rawArguments,
        success: false,
        token: token(),
        tool: "relay_steer",
        triageVisit: undefined,
      }),
    ).toBe(false);
    expect(triage.holds({ call, visitId: SECOND })).toBe(true);
  });

  // An open_card the server timed out never reaches answered(), so the card it stopped must still be cleared.
  it("is cleared as a call that may stop the clock is claimed, before its answer, and kept for any other claim", () => {
    const after = [
      { rawArguments: JSON.stringify({ key: "act:ev-2" }), tool: "open_card" },
      { rawArguments: NONE, tool: "triage_end" },
      { rawArguments: RUNNING, tool: "triage_clock" },
      { rawArguments: JSON.stringify({ say: "park it", triage: "park-working-session" }), tool: "relay_steer" },
      { rawArguments: JSON.stringify({ say: "tell them thanks" }), tool: "relay_steer" },
      { rawArguments: NONE, tool: "triage_next" },
      { rawArguments: JSON.stringify({ query: "q" }), tool: "search_corpus" },
    ].map(({ rawArguments, tool }) => {
      const { call, triage } = seated();
      settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
      return [
        triage.claimed({ call, rawArguments, token: token(), tool, turnId: undefined }),
        triage.holds({ call, visitId: FIRST }),
      ];
    });
    expect(after).toEqual([
      [true, false],
      [true, false],
      [true, false],
      [true, false],
      [false, true],
      [false, true],
      [false, true],
    ]);
  });

  // A triage_next answer delayed past a stop's claim must not name its card again over the stop.
  it("never names a card from a call claimed before the stop that cleared it, but does from one claimed after", () => {
    const { call, triage } = seated();
    const before = token();
    triage.claimed({ call, rawArguments: NONE, token: before, tool: "triage_next", turnId: undefined });
    triage.claimed({ call, rawArguments: NONE, token: token(), tool: "triage_end", turnId: undefined });
    const late = triage.answered({
      call,
      rawArguments: NONE,
      success: true,
      token: before,
      tool: "triage_next",
      triageVisit: FIRST,
    });
    const heldLate = triage.holds({ call, visitId: FIRST });
    const after = settle({ call, tool: "triage_next", triage, triageVisit: SECOND });
    expect([late, heldLate, after, triage.holds({ call, visitId: SECOND })]).toEqual([false, false, true, true]);
  });

  it("names the card again once a claimed restart answers, and never lets an older call's claim clear a newer call's card", () => {
    const { call, triage } = seated();
    settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
    settle({ call, rawArguments: RUNNING, tool: "triage_clock", triage, triageVisit: FIRST });
    const restarted = triage.holds({ call, visitId: FIRST });
    const fresh = {};
    triage.seat({ call: fresh, mode: "rollover" });
    settle({ call: fresh, tool: "triage_next", triage, triageVisit: SECOND });
    expect([
      restarted,
      triage.claimed({ call, rawArguments: NONE, token: token(), tool: "triage_end", turnId: undefined }),
      triage.holds({ call: fresh, visitId: SECOND }),
    ]).toEqual([true, false, true]);
  });

  it("changes nothing when a triage_next put no card up", () => {
    const { call, triage } = seated();
    settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
    expect(settle({ call, tool: "triage_next", triage, triageVisit: undefined })).toBe(false);
    expect(triage.holds({ call, visitId: FIRST })).toBe(true);
  });

  it("is cleared by a seated call's successful triage_end", () => {
    const { call, triage } = seated();
    settle({ call, tool: "triage_next", triage, triageVisit: FIRST });
    expect(settle({ call, tool: "triage_end", triage, triageVisit: undefined })).toBe(true);
    expect(triage.holds({ call, visitId: FIRST })).toBe(false);
  });

  it("keeps the card a newer call named when an older call answers triage_end late", () => {
    const triage = new TriagePresented();
    const old = {};
    const fresh = {};
    triage.seat({ call: old, mode: "fresh" });
    triage.seat({ call: fresh, mode: "rollover" });
    settle({ call: fresh, tool: "triage_next", triage, triageVisit: SECOND });
    expect(settle({ call: old, tool: "triage_end", triage, triageVisit: undefined })).toBe(false);
    expect(triage.holds({ call: fresh, visitId: SECOND })).toBe(true);
  });

  it("lets a newer call replace the visit an older call named, and never lets the older one say the newer card's line", () => {
    const triage = new TriagePresented();
    const old = {};
    const fresh = {};
    triage.seat({ call: old, mode: "fresh" });
    triage.seat({ call: fresh, mode: "rollover" });
    settle({ call: old, tool: "triage_next", triage, triageVisit: FIRST });
    expect(settle({ call: fresh, tool: "triage_next", triage, triageVisit: SECOND })).toBe(true);
    expect([
      triage.holds({ call: fresh, visitId: FIRST }),
      triage.holds({ call: fresh, visitId: SECOND }),
      triage.holds({ call: old, visitId: SECOND }),
    ]).toEqual([false, true, false]);
  });

  // A rollover onto a fresh call mid-card keeps the card's clock on the page, so the fresh call says its line.
  it("lets a rollover's newer call say the line on the card the call before it named", () => {
    const triage = new TriagePresented();
    const old = {};
    const fresh = {};
    triage.seat({ call: old, mode: "fresh" });
    settle({ call: old, tool: "triage_next", triage, triageVisit: FIRST });
    triage.seat({ call: fresh, mode: "rollover" });
    expect([triage.holds({ call: fresh, visitId: FIRST }), triage.holds({ call: old, visitId: FIRST })]).toEqual([
      true,
      true,
    ]);
  });

  it("carries the card the call before named across a reconnect too", () => {
    const triage = new TriagePresented();
    const dropped = {};
    const back = {};
    triage.seat({ call: dropped, mode: "fresh" });
    settle({ call: dropped, tool: "triage_next", triage, triageVisit: FIRST });
    triage.seat({ call: back, mode: "reconnect" });
    expect(triage.holds({ call: back, visitId: FIRST })).toBe(true);
  });

  // Triage is on only in the call the owner asked for it in, as the page stops its pass then.
  it("clears the card on the owner's fresh press, so neither call says its line and the older one cannot name it again", () => {
    const triage = new TriagePresented();
    const earlier = {};
    const pressed = {};
    triage.seat({ call: earlier, mode: "fresh" });
    settle({ call: earlier, tool: "triage_next", triage, triageVisit: FIRST });
    triage.seat({ call: pressed, mode: "fresh" });
    const heldAfterPress = [
      triage.holds({ call: pressed, visitId: FIRST }),
      triage.holds({ call: earlier, visitId: FIRST }),
    ];
    const lateNaming = settle({ call: earlier, tool: "triage_next", triage, triageVisit: SECOND });
    expect([...heldAfterPress, lateNaming, triage.holds({ call: pressed, visitId: SECOND })]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("is one record for the whole process", () => {
    expect(processTriagePresented()).toBe(processTriagePresented());
  });
});
