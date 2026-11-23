/**
 * Which console a call was served from, and whether its write reaches the owner — the pure half of the fix for the
 * fleet finding where a seat's branch console on :3001 wrote synthesised speech into the owner's live talk store.
 */
import { describe, expect, it } from "vitest";

import {
  type CallOrigin,
  callOpenedByTestInstance,
  consoleWriteRefused,
  foreignLineUnopened,
  isOwnerCallOrigin,
  isOwnerConsoleOrigin,
  markedOrigin,
  originAfterOpen,
  originKey,
  originPhrase,
  segmentForeignOrigin,
  servedByOwnerConsole,
  stampCallOrigin,
} from "../../../talk/callOrigin.js";
import { type CallEntry, callEntryOf } from "../../../talk/callRecord.js";

const OWNER: CallOrigin = { checkoutRoot: "/w/main", defaultPort: 3000, mainWorktree: true, port: 3000 };
const SEAT: CallOrigin = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };
/** The desktop test instance, placing a call through the owner's own console (`slopweaver desktop e2e --call`). */
const TEST_INSTANCE: CallOrigin = { ...OWNER, instance: "e2e" };

describe("isOwnerConsoleOrigin", () => {
  it.each([
    ["the main checkout on the default port", OWNER, true],
    ["a linked worktree on the default port", { ...OWNER, mainWorktree: false }, false],
    ["the main checkout on another port", { ...OWNER, port: 3001 }, false],
    ["the main checkout on a configured default", { ...OWNER, defaultPort: 4000, port: 4000 }, true],
  ])("reads %s", (_label, origin, expected) => {
    expect(isOwnerConsoleOrigin({ origin })).toBe(expected);
  });

  it("trusts a call with no origin, since every call before the stamp has none", () => {
    expect([isOwnerCallOrigin({ origin: undefined }), isOwnerCallOrigin({ origin: SEAT })]).toEqual([true, false]);
  });
});

describe("consoleWriteRefused", () => {
  it.each([
    ["the owner's console into the owner's live home, typing into the owner's chat", OWNER, true, true, false],
    ["a seat's console into the owner's live home", SEAT, true, false, true],
    ["a seat's console into its own home", SEAT, false, false, false],
    ["a seat's console typing into the owner's chat from its own home", SEAT, false, true, true],
  ])("judges %s", (_label, origin, reachesLiveHome, typesIntoChair, expected) => {
    expect(consoleWriteRefused({ origin, reachesLiveHome, typesIntoChair })).toBe(expected);
  });
});

describe("foreignLineUnopened", () => {
  const open = { atIso: "2026-10-12T05:04:00.000Z", kind: "open", model: "m", sessionId: "x", voice: "v" } as const;
  const said = {
    atIso: "2026-10-12T05:04:01.000Z",
    final: true,
    id: "s",
    kind: "segment",
    text: "t",
    who: "owner",
  } as const;
  const seatOpen = { ...open, origin: SEAT } satisfies CallEntry;
  const ownerOpen = { ...open, origin: OWNER } satisfies CallEntry;
  const otherOpen = { ...open, origin: { ...SEAT, port: 3002 } } satisfies CallEntry;

  it.each([
    ["a segment-only batch for a fresh call", [], [said], true],
    ["a segment-only batch for a legacy call with an unstamped open", [open], [said], true],
    ["a segment-only batch for a call the owner's console opened", [ownerOpen], [said], true],
    ["a segment-only batch for a call tthe owner's console opened", [seatOpen], [said], false],
    ["a batch that opens the call itself", [], [seatOpen, said], false],
    ["a segment before the batch's own open, on a fresh call", [], [said, seatOpen], true],
    [
      "a retry whose own open the file already holds, under another console's later open",
      [{ ...seatOpen, writeId: "w1" }, otherOpen],
      [
        { ...seatOpen, writeId: "w1" },
        { ...said, writeId: "w3" },
      ],
      true,
    ],
    [
      "a revision of a segment the owner's console began, under its own later open",
      [ownerOpen, { ...said, final: false }],
      [seatOpen, { ...said, text: "not the owner's" }],
      true,
    ],
    ["a revision of a segment it began itself", [seatOpen, { ...said, final: false }], [said], false],
    [
      "a retry whose own open the file already holds, still its last",
      [{ ...seatOpen, writeId: "w1" }],
      [
        { ...seatOpen, writeId: "w1" },
        { ...said, writeId: "w3" },
      ],
      false,
    ],
  ])("judges %s", (_label, existing, batch, expected) => {
    expect(foreignLineUnopened({ batch, existing, origin: SEAT })).toBe(expected);
  });

  it("never holds the owner's own console to it", () => {
    expect(foreignLineUnopened({ batch: [said], existing: [], origin: OWNER })).toBe(false);
  });
});

describe("stampCallOrigin", () => {
  it("stamps every open line with the server's origin, replacing the page's, and leaves every other line alone", () => {
    const segment = {
      atIso: "2026-10-12T05:04:01.000Z",
      final: true,
      id: "s",
      kind: "segment",
      text: "t",
      who: "owner",
    } satisfies CallEntry;
    const open = {
      atIso: "2026-10-12T05:04:00.000Z",
      kind: "open",
      model: "m",
      sessionId: "x",
      voice: "v",
    } satisfies CallEntry;
    const entries: readonly CallEntry[] = [{ ...open, origin: OWNER } satisfies CallEntry, segment, open];

    expect(stampCallOrigin({ entries, origin: SEAT })).toEqual([
      { ...open, origin: SEAT },
      segment,
      { ...open, origin: SEAT },
    ]);
  });
});

describe("an open line's origin as the call file holds it", () => {
  const open = { atIso: "2026-10-12T05:04:00.000Z", kind: "open", model: "m", sessionId: "x", voice: "v" };

  it("parses a well-formed origin and reads an absent one as a legacy call", () => {
    expect([callEntryOf({ value: { ...open, origin: SEAT } }), callEntryOf({ value: open })]).toEqual([
      { ...open, origin: SEAT },
      open,
    ]);
  });

  it.each([
    ["a port out of range", { ...SEAT, port: 70_000 }],
    ["an empty checkout", { ...SEAT, checkoutRoot: "" }],
    ["a stray field", { ...SEAT, trusted: true }],
    ["a port as text", { ...SEAT, port: "3001" }],
  ])("refuses %s rather than reading the call as unstamped", (_label, origin) => {
    expect(callEntryOf({ value: { ...open, origin } })).toBe(undefined);
  });
});

describe("originPhrase", () => {
  it("names the checkout kind, its path and both ports", () => {
    expect([originPhrase({ origin: SEAT }), originPhrase({ origin: { ...OWNER, port: 3002 } })]).toEqual([
      "a checkout that is not the owner's main checkout at /w/seat on :3001 (the owner's console is :3000)",
      "the owner's main checkout at /w/main on :3002 (the owner's console is :3000)",
    ]);
  });

  it("leads with the desktop test instance when it placed the call", () => {
    expect(originPhrase({ origin: TEST_INSTANCE })).toBe(
      "the desktop e2e test instance, through the owner's main checkout at /w/main on :3000 (the owner's console is :3000)",
    );
  });
});

describe("the desktop test instance's marker", () => {
  const open = { atIso: "2026-10-26T05:04:00.000Z", kind: "open", model: "m", sessionId: "x", voice: "v" } as const;
  const said = {
    atIso: "2026-10-26T05:04:01.000Z",
    final: true,
    id: "s",
    kind: "segment",
    text: "an automated end to end test",
    who: "owner",
  } as const;

  it("is never the owner's console, though the owner's console served it", () => {
    expect([
      isOwnerConsoleOrigin({ origin: TEST_INSTANCE }),
      isOwnerCallOrigin({ origin: TEST_INSTANCE }),
      servedByOwnerConsole({ origin: TEST_INSTANCE }),
      servedByOwnerConsole({ origin: SEAT }),
    ]).toEqual([false, false, true, false]);
  });

  it("is a different origin from the owner's console, so the keys of the two never collide", () => {
    expect(originKey({ origin: TEST_INSTANCE })).toBe("/w/main\n3000\n3000\ntrue\ne2e");
    expect(originKey({ origin: OWNER })).toBe("/w/main\n3000\n3000\ntrue\n");
  });

  it("parses exactly e2e and refuses any other value rather than reading the call as unstamped", () => {
    expect(callEntryOf({ value: { ...open, origin: TEST_INSTANCE } })).toEqual({ ...open, origin: TEST_INSTANCE });
    expect(callEntryOf({ value: { ...open, origin: { ...OWNER, instance: "prod" } } })).toBe(undefined);
    expect(callEntryOf({ value: { ...open, origin: { ...OWNER, instance: true } } })).toBe(undefined);
  });

  it("lets the test instance write only under its own open: never under the owner's, nor the owner under its", () => {
    const ownerOpened = { ...open, origin: OWNER } satisfies CallEntry;
    const testOpen = { ...open, origin: TEST_INSTANCE } satisfies CallEntry;
    expect([
      foreignLineUnopened({ batch: [said], existing: [ownerOpened], origin: TEST_INSTANCE }),
      foreignLineUnopened({ batch: [testOpen, said], existing: [], origin: TEST_INSTANCE }),
      foreignLineUnopened({ batch: [said], existing: [testOpen], origin: TEST_INSTANCE }),
    ]).toEqual([true, false, false]);
  });

  it("sets its stretches aside as not the owner's", () => {
    const entries: readonly CallEntry[] = [{ ...open, origin: TEST_INSTANCE }, said];
    expect(segmentForeignOrigin({ entries, segmentId: "s" })).toEqual(TEST_INSTANCE);
  });

  // A later unmarked open of the owner's console must not hand the rest of the call back as the owner's.
  it("keeps a stretch after a later unmarked open set aside", () => {
    const entries: readonly CallEntry[] = [{ ...open, origin: TEST_INSTANCE }, { ...open, origin: OWNER }, said];
    expect(segmentForeignOrigin({ entries, segmentId: "s" })).toEqual(TEST_INSTANCE);
  });
});

describe("callOpenedByTestInstance", () => {
  const open = { atIso: "2026-10-26T05:04:00.000Z", kind: "open", model: "m", sessionId: "x", voice: "v" } as const;

  it.each([
    ["every open marked", [{ ...open, origin: TEST_INSTANCE }], true],
    ["no open at all", [], false],
    ["an open with no origin", [open], false],
    ["an open from the owner's console", [{ ...open, origin: OWNER }], false],
    [
      "a marked open, then an unmarked one",
      [
        { ...open, origin: TEST_INSTANCE },
        { ...open, origin: OWNER },
      ],
      false,
    ],
  ])("reads %s", (_label, entries: readonly CallEntry[], expected) => {
    expect(callOpenedByTestInstance({ entries })).toBe(expected);
  });
});

describe("originAfterOpen", () => {
  it.each([
    ["nothing before, an unmarked open", undefined, OWNER, OWNER],
    ["the owner's console, then the test instance", OWNER, TEST_INSTANCE, TEST_INSTANCE],
    ["the test instance, then the owner's console", TEST_INSTANCE, OWNER, TEST_INSTANCE],
    ["the test instance, then an unstamped open", TEST_INSTANCE, undefined, TEST_INSTANCE],
    ["a seat's console, then the owner's", SEAT, OWNER, OWNER],
  ])("reads %s", (_label, previous, opened, expected) => {
    expect(originAfterOpen({ opened, previous })).toEqual(expected);
  });
});

describe("markedOrigin", () => {
  const open = { atIso: "2026-10-26T05:04:00.000Z", kind: "open", model: "m", sessionId: "x", voice: "v" } as const;
  const WALK_SEAT: CallOrigin = { ...SEAT, instance: "e2e" };

  it.each([
    ["a mark the frontier left, before any line", TEST_INSTANCE, [], TEST_INSTANCE],
    [
      "a mark the frontier left, over a later marked open",
      TEST_INSTANCE,
      [{ ...open, origin: WALK_SEAT }],
      TEST_INSTANCE,
    ],
    [
      "the first marked open, after one of the owner's",
      OWNER,
      [
        { ...open, origin: OWNER },
        { ...open, origin: WALK_SEAT },
        { ...open, origin: TEST_INSTANCE },
      ],
      WALK_SEAT,
    ],
    ["no mark anywhere", OWNER, [{ ...open, origin: OWNER }, open], undefined],
    ["nothing at all", undefined, [], undefined],
  ])("reads %s", (_label, before, entries: readonly CallEntry[], expected) => {
    expect(markedOrigin({ before, entries })).toEqual(expected);
  });
});
