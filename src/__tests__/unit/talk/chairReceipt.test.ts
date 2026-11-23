/*
 * Whether the chair holds a relay off what it received, never off the delivery grade. A relay graded `stranded` can
 * follow the chair absorbing its line as a queued turn, and one graded `skipped` the chair reading the owner's words
 * through `talk unread`. A cursor holds a relay only once it has read past the relay's own call line — never off an
 * instant.
 */
import { describe, expect, it } from "vitest";

import type { OwnerTurn } from "../../../supervisor/intake.js";
import { chairBatchLine } from "../../../talk/chairBatchLine.js";
import { chairReceiptOf, cursorCoverageOf } from "../../../talk/chairReceipt.js";
import { relayLineHead, relayLineVerify } from "../../../talk/relayLine.js";
import type { CallTail } from "../../../talk/unreadWords.js";

const SLUG = "talk-a00000100000";
const TURN_ID = "a0000010-0000-4000-8000-000000000011";
const ABSORBED = "2026-10-19T10:45:02.345Z";
const MARKED = "2026-10-19T10:59:16.854Z";
const POINTER = "transcript:a0000033-0000-4000-8000-000000000036#99e1db60-a445-4b79-a5c6-b5c6dffa40bd";

/** The delivery line `relayTurnLine` types for a slug. */
const deliveryLine = ({ slug }: { slug: string }): string =>
  `${relayLineHead({ slug })}the owner said: "check the nightly export"${relayLineVerify({ slug })}`;

/** One chair turn, overridable field by field. */
const turn = (over: Partial<OwnerTurn> = {}): OwnerTurn => ({
  lineNumber: 21772,
  pointer: POINTER,
  sessionId: "a0000033-0000-4000-8000-000000000036",
  source: "queued",
  text: deliveryLine({ slug: SLUG }),
  timestamp: ABSORBED,
  turnUuid: "99e1db60-a445-4b79-a5c6-b5c6dffa40bd",
  ...over,
});

describe("chairReceiptOf — the relay's line in a chair turn", () => {
  it.each(["queued", "typed"] as const)("holds a relay whose line arrived as a %s turn", (source) => {
    expect(chairReceiptOf({ cursor: undefined, turnId: TURN_ID, turns: [turn({ source })] })).toEqual({
      atIso: ABSORBED,
      kind: "line",
      pointer: POINTER,
      turnId: TURN_ID,
    });
  });

  it("holds a relay whose line arrived inside a paste wrapper", () => {
    const text = `<pasted_content id="4163">${deliveryLine({ slug: SLUG })}`;
    expect(chairReceiptOf({ cursor: undefined, turnId: TURN_ID, turns: [turn({ text })] })).toEqual({
      atIso: ABSORBED,
      kind: "line",
      pointer: POINTER,
      turnId: TURN_ID,
    });
  });

  // A malformed pointer withholds a receipt, never supplies one.
  it.each([
    "transcript:a0000033-0000-4000-8000-000000000036#garbage",
    "transcript:session#99e1db60-a445-4b79-a5c6-b5c6dffa40bd",
    "",
  ])("holds no receipt off a line whose turn's pointer is %j", (pointer) => {
    expect(chairReceiptOf({ cursor: undefined, turnId: TURN_ID, turns: [turn({ pointer })] })).toBe(undefined);
  });

  // A malformed turn withholds a receipt, never supplies one.
  it.each(["", "not-an-instant", "2026-02-30T00:00:00.000Z", "2026-10-19 10:45:02"])(
    "holds no receipt off a line whose turn's instant is %j",
    (timestamp) => {
      expect(chairReceiptOf({ cursor: undefined, turnId: TURN_ID, turns: [turn({ timestamp })] })).toBe(undefined);
    },
  );

  it.each<[string, string]>([
    // The slug is derived from this turn's id, so another relay's line is never this one's.
    ["another relay's line", deliveryLine({ slug: "talk-a00000870000" })],
    ["the marker mentioned in the owner's own words", `why did ${relayLineHead({ slug: SLUG })}not go out?`],
    ["the marker with no verify phrase", `${relayLineHead({ slug: SLUG })}the owner said: "ship it"`],
    ["a slug not in the minted shape", deliveryLine({ slug: "talk-NOTHEX" })],
  ])("does not hold a relay off %s", (_name, text) => {
    expect(chairReceiptOf({ cursor: undefined, turnId: TURN_ID, turns: [turn({ text })] })).toBe(undefined);
  });

  it("holds a relay a quiet batch listed, and not one it only counted or another relay's", () => {
    const listed = chairBatchLine({
      anchors: [
        { kind: "stretch", pointer: "talk-call:a0000035-0000-4000-8000-000000000038#s1" },
        { kind: "relay", slug: SLUG },
      ],
    });
    const other = chairBatchLine({ anchors: [{ kind: "relay", slug: "talk-a00000870000" }] });
    expect([
      chairReceiptOf({ cursor: undefined, turnId: TURN_ID, turns: [turn({ text: listed })] }),
      chairReceiptOf({ cursor: undefined, turnId: TURN_ID, turns: [turn({ text: other })] }),
      chairReceiptOf({ cursor: undefined, turnId: TURN_ID, turns: [turn({ text: `${listed} ship it` })] }),
    ]).toEqual([{ atIso: ABSORBED, kind: "line", pointer: POINTER, turnId: TURN_ID }, undefined, undefined]);
  });

  it("prefers the line to a cursor that would also hold it", () => {
    expect(
      chairReceiptOf({
        cursor: { recordedAtIso: MARKED, relaysRead: new Set([TURN_ID]) },
        turnId: TURN_ID,
        turns: [turn()],
      }),
    ).toEqual({ atIso: ABSORBED, kind: "line", pointer: POINTER, turnId: TURN_ID });
  });
});

describe("chairReceiptOf — the owner's words read through talk unread", () => {
  const SKIPPED_TURN = "a0000087-0000-4000-8000-000000000094";

  it("holds a relay whose own call line is behind the cursor", () => {
    expect(
      chairReceiptOf({
        cursor: { recordedAtIso: MARKED, relaysRead: new Set([TURN_ID, SKIPPED_TURN]) },
        turnId: SKIPPED_TURN,
        turns: [],
      }),
    ).toEqual({ atIso: MARKED, kind: "read-unread", turnId: SKIPPED_TURN });
  });

  it.each<[string, ReadonlySet<string>]>([
    // A mark records one batch, and the page posts its own lines in batches, so a cursor marked after the owner
    // spoke can stop short of their words or be marked before they landed. Only the relay's own line settles it.
    ["has read only other relays' lines", new Set([TURN_ID])],
    ["has read no relay line at all", new Set()],
    ["has read a relay sharing only its slug's 12 hex", new Set(["a0000087-85cf-4fff-8fff-ffffffffffff"])],
  ])("does not hold a relay off a cursor that %s", (_name, relaysRead) => {
    expect(
      chairReceiptOf({
        cursor: { recordedAtIso: MARKED, relaysRead },
        turnId: SKIPPED_TURN,
        turns: [],
      }),
    ).toBe(undefined);
  });

  it("does not hold a relay off a cursor never marked, or unreadable", () => {
    expect(chairReceiptOf({ cursor: undefined, turnId: SKIPPED_TURN, turns: [] })).toBe(undefined);
  });
});

describe("cursorCoverageOf — the relays one read says the cursor has read past", () => {
  const CURSOR = { calls: {}, recordedAtIso: MARKED };

  /** A call tail whose prefix held exactly these relay lines. */
  const tail = ({ relaysBefore }: { relaysBefore: readonly string[] }): CallTail => ({
    callId: "a0000048-0000-4000-8000-000000000051",
    endedBefore: false,
    finalBefore: [],
    lines: [],
    originBefore: undefined,
    relaysBefore,
    seenBefore: [],
    seenOriginBefore: new Map(),
    start: undefined,
  });

  it("gathers every call's relay lines behind its frontier", () => {
    const read = {
      bootstrapFloorIso: undefined,
      cursor: CURSOR,
      quarantined: [],
      tails: [tail({ relaysBefore: [TURN_ID] }), tail({ relaysBefore: ["a0000087-0000-4000-8000-000000000094"] })],
    };
    expect(cursorCoverageOf({ read })).toEqual({
      recordedAtIso: MARKED,
      relaysRead: new Set([TURN_ID, "a0000087-0000-4000-8000-000000000094"]),
    });
  });

  it("supplies no coverage for a cursor never marked", () => {
    expect(
      cursorCoverageOf({ read: { bootstrapFloorIso: MARKED, cursor: undefined, quarantined: [], tails: [] } }),
    ).toBe(undefined);
  });
});
