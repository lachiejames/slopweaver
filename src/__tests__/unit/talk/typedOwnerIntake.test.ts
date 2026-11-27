import { describe, expect, it } from "vitest";

import type { CallEntry } from "../../../talk/callRecord.js";
import {
  isTypedOwnerSegmentId,
  offShapeTypedSegmentCount,
  typedOwnerTurnCandidates,
} from "../../../talk/typedOwnerIntake.js";

const CALL = "a0000035-0000-4000-8000-0000000000a1";
const RELAY_ONE = "c0ffee00-0000-4000-8000-000000000001";
const RELAY_SPOKEN = "c0ffee00-0000-4000-8000-000000000002";
const FLOOR = "2026-11-27T00:00:00.000Z";
const ATTACHMENT_ONLY =
  '[Attached: "fixture-1.png", a picture of 12 KB, saved at "/synthetic/home/talk/attachments/fixture-1.png". Read it with file_read.]';
const WORDS_AND_ATTACHMENT = `fix the button this shows\n\n${ATTACHMENT_ONLY}`;

/**
 * A typed segment id as the page mints it: a prefix and a uuid whose last group is `n`, zero-padded.
 *
 * @param prefix which typed surface minted it
 * @param n the synthetic uuid's distinguishing tail
 * @returns the segment id
 */
function typedId({ prefix = "typed-owner", n }: { prefix?: "typed-owner" | "typed-in"; n: number }): string {
  return `${prefix}-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** One segment line. */
function segment({
  id,
  atIso,
  text = ATTACHMENT_ONLY,
  final = true,
  who = "owner",
}: {
  id: string;
  atIso: string;
  text?: string;
  final?: boolean;
  who?: "owner" | "voice";
}): CallEntry {
  return { atIso, final, id, kind: "segment", text, who };
}

/** One relay line. */
function relay({ turnId, atIso }: { turnId: string | null; atIso: string }): CallEntry {
  return { about: "", atIso, detail: "", heard: "synthetic", kind: "relay", outcome: "relayed", say: "", turnId };
}

/** One open line, under the desktop test instance when `e2e`. */
function open({ e2e }: { e2e: boolean }): CallEntry {
  const origin = { checkoutRoot: "/synthetic/checkout", defaultPort: 4321, mainWorktree: true, port: 4321 };
  return {
    atIso: "2026-11-27T00:30:00.000Z",
    kind: "open",
    model: "synthetic",
    origin: e2e ? { ...origin, instance: "e2e" } : origin,
    sessionId: "synthetic",
    surface: "typed",
    voice: "synthetic",
  };
}

describe("isTypedOwnerSegmentId", () => {
  it("admits both typed prefixes over a uuid, and nothing spoken or merely prefixed", () => {
    const ids = [
      typedId({ n: 1 }),
      typedId({ n: 2, prefix: "typed-in" }),
      "seg-1",
      "owner-typed-00000000-0000-4000-8000-000000000003",
      "typed-owner-SWORD_FISH_9",
      `${typedId({ n: 4 })}-extra`,
    ];
    expect(ids.map((id) => isTypedOwnerSegmentId({ id }))).toEqual([true, true, false, false, false, false]);
  });
});

describe("typedOwnerTurnCandidates", () => {
  it("returns an attachment-only turn and a words-plus-attachment turn identically, by pointer and instant", () => {
    const turns = typedOwnerTurnCandidates({
      calls: [
        {
          callId: CALL,
          entries: [
            segment({ atIso: "2026-11-27T01:00:00.000Z", id: typedId({ n: 1 }) }),
            segment({ atIso: "2026-11-27T01:05:00.000Z", id: typedId({ n: 2 }), text: WORDS_AND_ATTACHMENT }),
          ],
        },
      ],
      floorIso: FLOOR,
    });
    expect(turns).toEqual([
      { pointer: `talk-call:${CALL}#${typedId({ n: 1 })}`, relayAnchors: [], timestamp: "2026-11-27T01:00:00.000Z" },
      { pointer: `talk-call:${CALL}#${typedId({ n: 2 })}`, relayAnchors: [], timestamp: "2026-11-27T01:05:00.000Z" },
    ]);
    expect(JSON.stringify(turns)).not.toContain("fix the button");
    expect(JSON.stringify(turns)).not.toContain("fixture-1.png");
    expect(WORDS_AND_ATTACHMENT).toContain("fix the button");
  });

  it("never prints a typed-prefixed id that is not a uuid, since that id could carry the words", () => {
    const turns = typedOwnerTurnCandidates({
      calls: [
        {
          callId: CALL,
          entries: [
            segment({ atIso: "2026-11-27T01:00:00.000Z", id: "typed-owner-SWORD_FISH_9", text: "SWORD_FISH_9" }),
          ],
        },
      ],
      floorIso: FLOOR,
    });
    expect(turns).toEqual([]);
  });

  it("leaves out spoken, partial, voice and pre-floor segments", () => {
    const turns = typedOwnerTurnCandidates({
      calls: [
        {
          callId: CALL,
          entries: [
            segment({ atIso: "2026-11-27T01:00:00.000Z", id: "seg-spoken" }),
            segment({ atIso: "2026-11-27T01:01:00.000Z", final: false, id: typedId({ n: 1 }) }),
            segment({ atIso: "2026-11-27T01:02:00.000Z", id: typedId({ n: 2 }), who: "voice" }),
            segment({ atIso: "2026-11-26T23:59:59.000Z", id: typedId({ n: 3 }) }),
            segment({ atIso: "2026-11-27T01:03:00.000Z", id: typedId({ n: 4, prefix: "typed-in" }) }),
          ],
        },
      ],
      floorIso: FLOOR,
    });
    expect(turns.map((turn) => turn.pointer)).toEqual([`talk-call:${CALL}#${typedId({ n: 4, prefix: "typed-in" })}`]);
  });

  it("leaves out a turn any line of which sits under the desktop test instance", () => {
    const turns = typedOwnerTurnCandidates({
      calls: [
        {
          callId: CALL,
          entries: [
            open({ e2e: true }),
            segment({ atIso: "2026-11-27T01:00:00.000Z", id: typedId({ n: 1 }) }),
            open({ e2e: false }),
            segment({ atIso: "2026-11-27T01:05:00.000Z", id: typedId({ n: 2 }) }),
          ],
        },
      ],
      floorIso: FLOOR,
    });
    expect(turns).toEqual([]);
  });

  it("joins each relay line to the typed turn it follows, up to the next owner segment, each once", () => {
    const turns = typedOwnerTurnCandidates({
      calls: [
        {
          callId: CALL,
          entries: [
            segment({ atIso: "2026-11-27T01:00:00.000Z", id: typedId({ n: 1 }) }),
            relay({ atIso: "2026-11-27T01:00:05.000Z", turnId: RELAY_ONE }),
            relay({ atIso: "2026-11-27T01:00:06.000Z", turnId: RELAY_ONE.toUpperCase() }),
            relay({ atIso: "2026-11-27T01:00:07.000Z", turnId: null }),
            segment({ atIso: "2026-11-27T01:01:00.000Z", id: "seg-spoken" }),
            relay({ atIso: "2026-11-27T01:01:05.000Z", turnId: RELAY_SPOKEN }),
            segment({ atIso: "2026-11-27T01:02:00.000Z", id: typedId({ n: 2 }) }),
          ],
        },
      ],
      floorIso: FLOOR,
    });
    expect(turns.map((turn) => turn.relayAnchors)).toEqual([[`talk:${RELAY_ONE}`], []]);
  });

  it("keeps no relay whose turn id is not a uuid, since that id could carry the words", () => {
    const turns = typedOwnerTurnCandidates({
      calls: [
        {
          callId: CALL,
          entries: [
            segment({ atIso: "2026-11-27T01:00:00.000Z", id: typedId({ n: 1 }), text: "LEAKME" }),
            relay({ atIso: "2026-11-27T01:00:05.000Z", turnId: "LEAKME" }),
          ],
        },
      ],
      floorIso: FLOOR,
    });
    expect(turns.map((turn) => turn.relayAnchors)).toEqual([[]]);
  });

  it("names a turn written as two snapshots of one id once, keeping the first instant", () => {
    const turns = typedOwnerTurnCandidates({
      calls: [
        {
          callId: CALL,
          entries: [
            segment({ atIso: "2026-11-27T01:00:00.000Z", id: typedId({ n: 1 }) }),
            segment({ atIso: "2026-11-27T01:00:01.000Z", id: typedId({ n: 1 }) }),
          ],
        },
      ],
      floorIso: FLOOR,
    });
    expect(turns).toEqual([
      { pointer: `talk-call:${CALL}#${typedId({ n: 1 })}`, relayAnchors: [], timestamp: "2026-11-27T01:00:00.000Z" },
    ]);
  });

  it("returns nothing for no calls", () => {
    expect(typedOwnerTurnCandidates({ calls: [], floorIso: FLOOR })).toEqual([]);
  });
});

describe("offShapeTypedSegmentCount", () => {
  it("counts each final typed-prefixed segment off the page's shape once, and nothing else", () => {
    const calls = [
      {
        callId: CALL,
        entries: [
          segment({ atIso: "2026-11-27T01:00:00.000Z", id: "typed-owner-message_1" }),
          segment({ atIso: "2026-11-27T01:00:01.000Z", id: "typed-owner-message_1" }),
          segment({ atIso: "2026-11-27T01:01:00.000Z", id: "typed-in-SWORD_FISH_9" }),
          segment({ atIso: "2026-11-27T01:02:00.000Z", final: false, id: "typed-owner-partial" }),
          segment({ atIso: "2026-11-26T23:00:00.000Z", id: "typed-owner-early" }),
          segment({ atIso: "2026-11-27T01:03:00.000Z", id: typedId({ n: 1 }) }),
          segment({ atIso: "2026-11-27T01:04:00.000Z", id: "seg-spoken" }),
        ],
      },
    ];
    expect([
      offShapeTypedSegmentCount({ calls, floorIso: FLOOR }),
      offShapeTypedSegmentCount({ calls: [], floorIso: FLOOR }),
    ]).toEqual([2, 0]);
  });
});
