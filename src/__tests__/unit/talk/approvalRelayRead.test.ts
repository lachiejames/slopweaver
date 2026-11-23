import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../../lib/safeJson.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  type ApprovalRelayAnchor,
  cardOpenedBy,
  laterRelayLines,
  readApprovalLaterRelays,
} from "../../../talk/approvalRelayRead.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { appendCallEntries } from "../../../talk/callStore.js";
import { claimRelayTurn, openLine, relayLine, triageNextLine } from "../../takeBackCallFixture.js";

const CALL = "a0000044-0000-4000-8000-000000000001";
const OTHER_CALL = "a0000044-0000-4000-8000-000000000002";
const YES_TURN = "541f50a8-0000-4000-8000-000000000001";
const LATER_TURN = "541f50a8-0000-4000-8000-000000000002";
const THIRD_TURN = "541f50a8-0000-4000-8000-000000000003";
const CARD_N = "draft:sd-0000aaaa";
const CARD_N1 = "draft:sd-0000bbbb";
const CARD_N2 = "draft:sd-0000cccc";
const CARD_N3 = "draft:sd-0000dddd";
const STAGED = "2026-10-14T23:38:49.300Z";

const RELAY_ANCHOR: ApprovalRelayAnchor = {
  anchor: `talk:${YES_TURN}`,
  card: CARD_N,
  kind: "relay",
  stagedAtIso: STAGED,
  turnId: YES_TURN,
};

const LANDING_ANCHOR: ApprovalRelayAnchor = {
  anchor: `call:${CALL}#seg-7`,
  callId: CALL,
  card: CARD_N,
  kind: "card-landing",
  segmentId: "seg-7",
};

/** The yes's own relay line, then one opening card N+1: the 1.1s the voice took on a real call. */
const YES_THEN_NEXT: readonly CallEntry[] = [
  openLine({ atIso: "2026-10-14T23:30:00.000Z" }),
  relayLine({ about: CARD_N, atIso: "2026-10-14T23:38:49.276Z", heard: "yes, send it", turnId: YES_TURN }),
  triageNextLine({ atIso: "2026-10-14T23:38:50.391Z", card: CARD_N1, outcome: "opened" }),
];

/** What the owner said after the voice moved on. */
const TAKE_BACK = "oh wait, no, not that one";

/** A relay line on a card, after the yes's open of the next card unless placed — the instant orders, cards count. */
function later({
  about,
  atIso = "2026-10-14T23:38:52.000Z",
  heard = TAKE_BACK,
  turnId,
}: {
  about: string;
  atIso?: string;
  heard?: string;
  turnId: string | null;
}): CallEntry {
  return relayLine({ about, atIso, heard, turnId });
}

/** An opening of a card. */
function opens({
  atIso = "2026-10-14T23:38:51.000Z",
  card,
  outcome = "opened",
}: {
  atIso?: string;
  card: string;
  outcome?: string;
}): CallEntry {
  return triageNextLine({ atIso, card, outcome });
}

/** One stretch of the owner's speech as the page snapshots it. */
function segment({
  atIso = "2026-10-14T23:38:48.000Z",
  final,
  text,
}: {
  atIso?: string;
  final: boolean;
  text: string;
}): CallEntry {
  return { atIso, final, id: "seg-7", kind: "segment", text, who: "owner" };
}

describe("cardOpenedBy", () => {
  it.each([
    [
      "a triage_next that opened a card",
      "triage_next",
      `triage 4/101: ${CARD_N1}, card opened, page none, thread none`,
    ],
    [
      "a rewritten triage card",
      "triage_next",
      `triage 4/101, rewritten: ${CARD_N1}, card opened, page none, thread none`,
    ],
    ["an open_card", "open_card", `${CARD_N1}, card opened, page none, thread none`],
    ["an open_card with nothing after it", "open_card", `${CARD_N1}, card opened`],
  ])("reads the card off %s", (_label, name, detail) => {
    expect(cardOpenedBy({ entry: { atIso: STAGED, detail, kind: "tool", name, refused: false } })).toBe(CARD_N1);
  });

  it.each([
    ["a refused open", "triage_next", `triage 4/101: ${CARD_N1}, card refused, page none, thread none`],
    ["a skipped open", "triage_next", `triage 4/101: ${CARD_N1}, card skipped, page none, thread none`],
    ["an open that put up nothing", "open_card", `${CARD_N1}, card none, page none, thread none`],
    ["another tool", "read_thread", `${CARD_N1}, card opened, page none, thread none`],
    ["a key that is not a card key", "open_card", "draft:, card opened"],
  ])("reads no card off %s", (_label, name, detail) => {
    expect(cardOpenedBy({ entry: { atIso: STAGED, detail, kind: "tool", name, refused: false } })).toBe(undefined);
  });

  it("reads no card off a line the tool gate refused, whatever its detail says", () => {
    const detail = `${CARD_N1}, card opened, page none, thread none`;
    expect(cardOpenedBy({ entry: { atIso: STAGED, detail, kind: "tool", name: "open_card", refused: true } })).toBe(
      undefined,
    );
  });
});

describe("laterRelayLines", () => {
  it("counts the cards opened since the yes, and stops at the third", () => {
    const entries = [
      ...YES_THEN_NEXT,
      later({ about: CARD_N1, turnId: LATER_TURN }),
      opens({ atIso: "2026-10-14T23:38:53.000Z", card: CARD_N2 }),
      later({ about: CARD_N2, atIso: "2026-10-14T23:38:54.000Z", turnId: THIRD_TURN }),
      opens({ atIso: "2026-10-14T23:38:55.000Z", card: CARD_N3 }),
      later({ about: CARD_N3, atIso: "2026-10-14T23:38:56.000Z", turnId: "541f50a8-0000-4000-8000-000000000004" }),
    ];
    expect(unwrap(laterRelayLines({ anchor: RELAY_ANCHOR, entries }))).toEqual([
      { about: CARD_N1, cardDistance: 1, heard: TAKE_BACK, turnId: LATER_TURN },
      { about: CARD_N2, cardDistance: 2, heard: TAKE_BACK, turnId: THIRD_TURN },
    ]);
  });

  it("keeps a relay on the yes's own card at distance 0, and never the yes's own turn said again", () => {
    const entries = [
      YES_THEN_NEXT[0]!,
      YES_THEN_NEXT[1]!,
      relayLine({ about: CARD_N, atIso: STAGED, heard: "yes, send it", turnId: YES_TURN }),
      later({ about: CARD_N, turnId: LATER_TURN }),
      later({ about: CARD_N, turnId: LATER_TURN }),
    ];
    expect(unwrap(laterRelayLines({ anchor: RELAY_ANCHOR, entries }))).toEqual([
      { about: CARD_N, cardDistance: 0, heard: TAKE_BACK, turnId: LATER_TURN },
    ]);
  });

  it("moves the window on no refused or skipped open, nor on the same card opened again", () => {
    const entries = [
      YES_THEN_NEXT[0]!,
      YES_THEN_NEXT[1]!,
      opens({ card: CARD_N1, outcome: "refused" }),
      opens({ card: CARD_N2, outcome: "skipped" }),
      opens({ card: CARD_N }),
      later({ about: "", turnId: LATER_TURN }),
    ];
    expect(unwrap(laterRelayLines({ anchor: RELAY_ANCHOR, entries }))).toEqual([
      { about: "", cardDistance: 0, heard: TAKE_BACK, turnId: LATER_TURN },
    ]);
  });

  it("starts a landing after the stretch's last snapshot, so the yes's own words are not read as after it", () => {
    const entries = [
      openLine({ atIso: "2026-10-14T23:30:00.000Z" }),
      later({ about: CARD_N, atIso: "2026-10-14T23:38:47.000Z", turnId: THIRD_TURN }),
      segment({ final: false, text: "yes" }),
      later({ about: CARD_N, atIso: "2026-10-14T23:38:48.500Z", turnId: YES_TURN }),
      segment({ atIso: "2026-10-14T23:38:49.000Z", final: true, text: "yes, send it" }),
      opens({ card: CARD_N1 }),
      later({ about: CARD_N1, turnId: LATER_TURN }),
    ];
    expect(unwrap(laterRelayLines({ anchor: LANDING_ANCHOR, entries }))).toEqual([
      { about: CARD_N1, cardDistance: 1, heard: TAKE_BACK, turnId: LATER_TURN },
    ]);
  });

  // A keepalive batch can land ahead of an earlier one, so a take-back can sit above the yes in the file.
  it("reads a take-back the file holds above the yes, by the instants the owner spoke at", () => {
    const entries = [
      YES_THEN_NEXT[0]!,
      YES_THEN_NEXT[2]!,
      later({ about: CARD_N1, turnId: LATER_TURN }),
      YES_THEN_NEXT[1]!,
    ];
    expect(unwrap(laterRelayLines({ anchor: RELAY_ANCHOR, entries }))).toEqual([
      { about: CARD_N1, cardDistance: 1, heard: TAKE_BACK, turnId: LATER_TURN },
    ]);
  });

  // `Date.parse` keeps whole milliseconds, so two instants inside one would tie and fall back to file order.
  it("orders two instants inside one millisecond by the digits past it", () => {
    const entries = [
      ...YES_THEN_NEXT,
      opens({ atIso: "2026-10-14T23:38:51.000Z", card: CARD_N2 }),
      opens({ atIso: "2026-10-14T23:38:53.000200Z", card: CARD_N3 }),
      later({ about: "", atIso: "2026-10-14T23:38:53.000100Z", turnId: LATER_TURN }),
    ];
    expect(unwrap(laterRelayLines({ anchor: RELAY_ANCHOR, entries }))).toEqual([
      { about: "", cardDistance: 2, heard: TAKE_BACK, turnId: LATER_TURN },
    ]);
  });

  it("reads the fraction off the seconds, never a dotted date", () => {
    const entries = [
      later({ about: CARD_N, atIso: "2026.10.14 23:38:49.0012Z", heard: "scratch that", turnId: LATER_TURN }),
      relayLine({ about: CARD_N, atIso: "2026.10.14 23:38:49.0011Z", heard: "yes, send it", turnId: YES_TURN }),
    ];
    expect(unwrap(laterRelayLines({ anchor: RELAY_ANCHOR, entries }))).toEqual([
      { about: CARD_N, cardDistance: 0, heard: "scratch that", turnId: LATER_TURN },
    ]);
  });

  it("names the anchor when the call does not hold it", () => {
    const error = unwrapErr(laterRelayLines({ anchor: LANDING_ANCHOR, entries: YES_THEN_NEXT }));
    expect(error.code).toBe("ANCHOR_CALL_MISSING");
    expect(error.message).toBe(`no call file holds call:${CALL}#seg-7, so what the owner said after it cannot be read`);
  });

  it("refuses a relay inside the window the gate shut before it kept the owner's words", () => {
    const shut = { ...later({ about: CARD_N1, turnId: null }), outcome: "refused" };
    const error = unwrapErr(laterRelayLines({ anchor: RELAY_ANCHOR, entries: [...YES_THEN_NEXT, shut] }));
    expect(error.code).toBe("LATER_RELAY_UNREADABLE");
    expect(error.message).toBe(
      `a relay after it that carries no turn cannot be read (the relay at 2026-10-14T23:38:52.000Z was refused before it kept the owner's words), so whether the owner took talk:${YES_TURN} back is unknown`,
    );
  });

  it("refuses a call where one turn's lines put it on two cards, naming the turn and the line", () => {
    const entries = [
      ...YES_THEN_NEXT,
      later({ about: CARD_N1, turnId: LATER_TURN }),
      later({ about: CARD_N, atIso: "2026-10-14T23:38:53.000Z", turnId: LATER_TURN }),
    ];
    const error = unwrapErr(laterRelayLines({ anchor: RELAY_ANCHOR, entries }));
    expect(error.code).toBe("ANCHOR_CALL_UNREADABLE");
    expect(error.message).toBe(
      `the call talk:${YES_TURN} was said on cannot be read whole (talk:${LATER_TURN}'s lines disagree on what it was about or what the owner said (at 2026-10-14T23:38:53.000Z)), so what the owner said after it is unknown`,
    );
  });

  // Each was one more placement a per-window check missed; the whole call is read.
  it.each([
    ["the yes's own turn, again with a take-back", [later({ about: "", heard: "scratch that", turnId: YES_TURN })]],
    [
      "a later turn, again in other words",
      [
        later({ about: CARD_N1, heard: "send it", turnId: LATER_TURN }),
        later({ about: CARD_N1, atIso: "2026-10-14T23:38:53.000Z", turnId: LATER_TURN }),
      ],
    ],
    [
      "a turn before the yes, again inside its window",
      [
        later({ about: CARD_N3, atIso: "2026-10-14T23:31:00.000Z", heard: "park it", turnId: LATER_TURN }),
        later({ about: CARD_N1, heard: "park it", turnId: LATER_TURN }),
      ],
    ],
    [
      "a turn twice before the yes, then agreeing with its first",
      [
        later({ about: CARD_N1, atIso: "2026-10-14T23:31:00.000Z", turnId: LATER_TURN }),
        later({ about: CARD_N2, atIso: "2026-10-14T23:31:01.000Z", turnId: LATER_TURN }),
        later({ about: CARD_N1, turnId: LATER_TURN }),
      ],
    ],
    [
      "an in-window turn, again past the window",
      [
        later({ about: CARD_N1, heard: "who wrote this?", turnId: LATER_TURN }),
        opens({ atIso: "2026-10-14T23:38:53.000Z", card: CARD_N2 }),
        opens({ atIso: "2026-10-14T23:38:54.000Z", card: CARD_N3 }),
        later({ about: CARD_N3, atIso: "2026-10-14T23:38:55.000Z", heard: "scratch that", turnId: LATER_TURN }),
      ],
    ],
  ])("refuses %s on another card or in other words", (_label, extra) => {
    const entries = [...YES_THEN_NEXT, ...extra];
    expect(unwrapErr(laterRelayLines({ anchor: RELAY_ANCHOR, entries })).code).toBe("ANCHOR_CALL_UNREADABLE");
  });

  it("passes over a shut relay past the window, which could not have been about the yes", () => {
    const entries = [
      ...YES_THEN_NEXT,
      opens({ card: CARD_N2 }),
      opens({ card: CARD_N3 }),
      later({ about: CARD_N3, turnId: null }),
    ];
    expect(unwrap(laterRelayLines({ anchor: RELAY_ANCHOR, entries }))).toEqual([]);
  });
});

describe("readApprovalLaterRelays", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "approval-relay-read-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** The yes and the take-back, each claimed as `talk relay` claims it. */
  function claimBoth(): void {
    claimRelayTurn({
      about: CARD_N,
      heard: "yes, send it",
      home,
      nowIso: STAGED,
      triageRuling: { label: undefined, verdict: "send-it" },
      turnId: YES_TURN,
    });
    claimRelayTurn({
      about: CARD_N1,
      heard: "oh wait, no, not that one",
      home,
      nowIso: "2026-10-14T23:38:52.100Z",
      triageRuling: undefined,
      turnId: LATER_TURN,
    });
  }

  it("reads the take-back's words and its missing ruling off its own turn file", () => {
    claimBoth();
    unwrap(
      appendCallEntries({
        callId: CALL,
        entries: [...YES_THEN_NEXT, later({ about: CARD_N1, turnId: LATER_TURN })],
        home,
      }),
    );
    expect(unwrap(readApprovalLaterRelays({ anchor: RELAY_ANCHOR, home }))).toEqual([
      {
        about: CARD_N1,
        callHeard: TAKE_BACK,
        cardDistance: 1,
        heard: TAKE_BACK,
        triageRuling: null,
        turnId: LATER_TURN,
        wordsWhole: true,
      },
    ]);
  });

  it("marks a later relay made while the owner was still speaking as not whole", () => {
    claimRelayTurn({
      about: CARD_N,
      heard: "yes, send it",
      home,
      nowIso: STAGED,
      triageRuling: { label: undefined, verdict: "send-it" },
      turnId: YES_TURN,
    });
    claimRelayTurn({
      about: CARD_N1,
      heard: "oh wait, no, not that one",
      heardTailCut: true,
      home,
      nowIso: "2026-10-14T23:38:52.100Z",
      triageRuling: undefined,
      turnId: LATER_TURN,
    });
    const entries = [...YES_THEN_NEXT, later({ about: CARD_N1, turnId: LATER_TURN })];
    unwrap(appendCallEntries({ callId: CALL, entries, home }));
    expect(unwrap(readApprovalLaterRelays({ anchor: RELAY_ANCHOR, home })).map((relay) => relay.wordsWhole)).toEqual([
      false,
    ]);
  });

  // The call line and the turn file are two records of the owner's words; neither is dropped for the other.
  it("keeps the call line's words beside the turn file's when the two disagree", () => {
    claimBoth();
    const entries = [...YES_THEN_NEXT, later({ about: CARD_N1, heard: "yes", turnId: LATER_TURN })];
    unwrap(appendCallEntries({ callId: CALL, entries, home }));
    const [relay] = unwrap(readApprovalLaterRelays({ anchor: RELAY_ANCHOR, home }));
    expect([relay!.callHeard, relay!.heard]).toEqual(["yes", TAKE_BACK]);
  });

  it("reads a landing's call by the id its anchor names", () => {
    claimBoth();
    const entries = [segment({ final: true, text: "yes, send it" }), opens({ card: CARD_N1 })];
    unwrap(
      appendCallEntries({ callId: CALL, entries: [...entries, later({ about: CARD_N1, turnId: LATER_TURN })], home }),
    );
    expect(unwrap(readApprovalLaterRelays({ anchor: LANDING_ANCHOR, home })).map((relay) => relay.turnId)).toEqual([
      LATER_TURN,
    ]);
  });

  it("refuses a relay no call holds", () => {
    const error = unwrapErr(readApprovalLaterRelays({ anchor: RELAY_ANCHOR, home }));
    expect(error.code).toBe("ANCHOR_CALL_MISSING");
  });

  it("refuses a relay two calls hold, naming both", () => {
    claimBoth();
    unwrap(appendCallEntries({ callId: CALL, entries: YES_THEN_NEXT, home }));
    unwrap(appendCallEntries({ callId: OTHER_CALL, entries: YES_THEN_NEXT, home }));
    const error = unwrapErr(readApprovalLaterRelays({ anchor: RELAY_ANCHOR, home }));
    expect(error.code).toBe("ANCHOR_CALL_AMBIGUOUS");
    expect(error.message).toContain(CALL);
    expect(error.message).toContain(OTHER_CALL);
  });

  it("refuses a call with a line that does not parse, which may be the take-back", () => {
    claimBoth();
    const { path } = unwrap(appendCallEntries({ callId: CALL, entries: YES_THEN_NEXT, home }));
    appendFileSync(path, "{not json\n");
    const error = unwrapErr(readApprovalLaterRelays({ anchor: RELAY_ANCHOR, home }));
    expect(error.code).toBe("ANCHOR_CALL_UNREADABLE");
    expect(error.message).toContain(`1 line(s) of call ${CALL} do not parse`);
  });

  it("refuses a later relay whose turn file is not there", () => {
    claimBoth();
    const entries = [...YES_THEN_NEXT, later({ about: CARD_N1, turnId: THIRD_TURN })];
    unwrap(appendCallEntries({ callId: CALL, entries, home }));
    const error = unwrapErr(readApprovalLaterRelays({ anchor: RELAY_ANCHOR, home }));
    expect(error.code).toBe("LATER_RELAY_UNREADABLE");
    expect(error.message).toContain(`talk:${THIRD_TURN}, a relay after it, cannot be read`);
  });

  // A turn file whose words are there but not text is damaged, never an older one that kept none.
  it("refuses a later relay whose turn file holds the owner's words as something other than text", () => {
    claimBoth();
    const path = join(stateHomePaths({ home }).talkTurns, `${LATER_TURN}.json`);
    const turn = safeJsonParse({ label: "talk turn", text: readFileSync(path, "utf8") }) as Record<string, unknown>;
    writeFileSync(path, safeJsonStringify({ label: "talk turn", value: { ...turn, heard: 7 } }));
    const entries = [...YES_THEN_NEXT, later({ about: CARD_N1, turnId: LATER_TURN })];
    unwrap(appendCallEntries({ callId: CALL, entries, home }));
    const error = unwrapErr(readApprovalLaterRelays({ anchor: RELAY_ANCHOR, home }));
    expect(error.code).toBe("LATER_RELAY_UNREADABLE");
    expect(error.message).toContain("turn file is not a turn record");
  });

  it("refuses a later relay the call and its turn file put on different cards", () => {
    claimBoth();
    unwrap(
      appendCallEntries({
        callId: CALL,
        entries: [...YES_THEN_NEXT, later({ about: CARD_N2, turnId: LATER_TURN })],
        home,
      }),
    );
    const error = unwrapErr(readApprovalLaterRelays({ anchor: RELAY_ANCHOR, home }));
    expect(error.code).toBe("LATER_RELAY_UNREADABLE");
    expect(error.message).toContain(`the call says it was about "${CARD_N2}", its turn file "${CARD_N1}"`);
  });
});
