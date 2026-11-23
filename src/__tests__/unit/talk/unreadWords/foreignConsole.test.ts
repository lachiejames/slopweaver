/*
 * Which words are not the owner's because a console other than their own opened the call: a branch console's call or a
 * test instance's set aside, each stretch judged by the open it followed, before the frontier and past a mark.
 */
import { describe, expect, it } from "vitest";

import type { CallOrigin } from "../../../../talk/callOrigin.js";
import type { CallEntry } from "../../../../talk/callRecord.js";
import { selectUnreadWords } from "../../../../talk/unreadWords.js";
import { CALL, OTHER, readOf, said, tail } from "./harness.js";

describe("selectUnreadWords — a console that is not the owner's", () => {
  const BRANCH: CallOrigin = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };
  const OWNER: CallOrigin = { checkoutRoot: "/w/main", defaultPort: 3000, mainWorktree: true, port: 3000 };
  const open = ({ atIso, origin }: { atIso: string; origin?: CallOrigin }) =>
    ({
      atIso,
      kind: "open",
      model: "m",
      sessionId: "s",
      voice: "v",
      ...(origin === undefined ? {} : { origin }),
    }) satisfies CallEntry;

  it("keeps an unstamped call and the owner's own console's call as their words, and sets a branch console's call aside", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              open({ atIso: "2026-10-12T04:59:00.000Z", origin: BRANCH }),
              said({ atIso: "2026-10-12T04:59:01.000Z", id: "w1", text: "synthetic one" }),
              said({ atIso: "2026-10-12T04:59:02.000Z", id: "w2", text: "synthetic two" }),
            ],
          }),
          tail({
            callId: OTHER,
            entries: [
              open({ atIso: "2026-10-12T05:00:00.000Z", origin: OWNER }),
              said({ atIso: "2026-10-12T05:00:01.000Z", id: "o", text: "owner" }),
            ],
          }),
          tail({
            callId: "a0000006-0000-4000-8000-000000000007",
            entries: [
              open({ atIso: "2026-10-12T05:01:00.000Z" }),
              said({ atIso: "2026-10-12T05:01:01.000Z", id: "l", text: "legacy" }),
            ],
          }),
        ],
      }),
    });

    expect(selection.words.map((word) => word.text)).toEqual(["owner", "legacy"]);
    expect(selection.foreign).toEqual([{ callId: CALL, origin: BRANCH, stretches: 2 }]);
  });

  it("reads the origin off the open line a mark already passed", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [said({ atIso: "2026-10-12T05:04:01.000Z", id: "w", text: "synthetic" })],
            originBefore: BRANCH,
          }),
        ],
      }),
    });

    expect(selection.words).toEqual([]);
    expect(selection.foreign).toEqual([{ callId: CALL, origin: BRANCH, stretches: 1 }]);
  });

  it("gives each stretch the origin of the open it followed, so a call id the owner's console reopens is theirs again", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              open({ atIso: "2026-10-12T05:04:00.000Z", origin: BRANCH }),
              said({ atIso: "2026-10-12T05:04:01.000Z", id: "a", text: "synthetic" }),
              open({ atIso: "2026-10-12T05:05:00.000Z", origin: OWNER }),
              said({ atIso: "2026-10-12T05:05:01.000Z", id: "b", text: "owner" }),
            ],
          }),
        ],
      }),
    });

    expect(selection.words.map((word) => word.segmentId)).toEqual(["b"]);
    expect(selection.foreign).toEqual([{ callId: CALL, origin: BRANCH, stretches: 1 }]);
  });

  it("keeps the owner's stretch begun before the frontier as theirs when a foreign open lands before its final", () => {
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              open({ atIso: "2026-10-12T05:05:00.000Z", origin: BRANCH }),
              said({ atIso: "2026-10-12T05:05:01.000Z", id: "s", text: "owner finished words" }),
              said({ atIso: "2026-10-12T05:05:02.000Z", id: "w", text: "synthetic" }),
            ],
            originBefore: OWNER,
            seenBefore: ["s"],
            seenOriginBefore: new Map([["s", OWNER]]),
          }),
        ],
      }),
    });

    expect(selection.words.map((word) => word.text)).toEqual(["owner finished words"]);
    expect(selection.foreign).toEqual([{ callId: CALL, origin: BRANCH, stretches: 1 }]);
  });

  // A later unmarked open of the owner's console handed the test instance's call back as theirs.
  it("keeps a call the test instance opened set aside after a later unmarked open, in the tail and past a mark", () => {
    const WALK: CallOrigin = { ...OWNER, instance: "e2e" };
    const later = [
      open({ atIso: "2026-10-12T05:06:00.000Z", origin: OWNER }),
      said({ atIso: "2026-10-12T05:06:01.000Z", id: "b", text: "automated test, later" }),
    ];
    const inTail = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              open({ atIso: "2026-10-12T05:05:00.000Z", origin: WALK }),
              said({ atIso: "2026-10-12T05:05:01.000Z", id: "a", text: "automated test" }),
              ...later,
            ],
          }),
        ],
      }),
    });
    const pastMark = selectUnreadWords({ read: readOf({ tails: [tail({ entries: later, originBefore: WALK })] }) });

    expect(inTail.words).toEqual([]);
    expect(inTail.foreign).toEqual([{ callId: CALL, origin: WALK, stretches: 2 }]);
    expect(pastMark.words).toEqual([]);
    expect(pastMark.foreign).toEqual([{ callId: CALL, origin: WALK, stretches: 1 }]);
  });

  // Speech BEFORE a marked open in the same tail was read under the owner's console's open.
  it("sets aside the owner's words written before a marked open in the same tail", () => {
    const WALK: CallOrigin = { ...OWNER, instance: "e2e" };
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [
              open({ atIso: "2026-10-12T05:05:00.000Z", origin: OWNER }),
              said({ atIso: "2026-10-12T05:05:01.000Z", id: "a", text: "automated test" }),
              open({ atIso: "2026-10-12T05:06:00.000Z", origin: WALK }),
            ],
          }),
        ],
      }),
    });

    expect(selection.words).toEqual([]);
    expect(selection.foreign).toEqual([{ callId: CALL, origin: WALK, stretches: 1 }]);
  });

  // A later snapshot of a stretch begun under the owner's open, read once the marked open was behind
  // the frontier, kept the stretch's first origin.
  it("sets aside a later snapshot of a stretch begun before a marked open the frontier already passed", () => {
    const WALK: CallOrigin = { ...OWNER, instance: "e2e" };
    const selection = selectUnreadWords({
      read: readOf({
        tails: [
          tail({
            entries: [said({ atIso: "2026-10-12T05:07:00.000Z", id: "a", text: "automated test" })],
            originBefore: WALK,
            seenOriginBefore: new Map([["a", OWNER]]),
          }),
        ],
      }),
    });

    expect(selection.words).toEqual([]);
    expect(selection.foreign).toEqual([{ callId: CALL, origin: WALK, stretches: 1 }]);
  });

  it("sets a foreign stretch aside whatever its age, never counting it under the bootstrap floor", () => {
    const selection = selectUnreadWords({
      read: readOf({
        bootstrapFloorIso: "2026-10-12T06:00:00.000Z",
        tails: [
          tail({
            entries: [
              open({ atIso: "2026-10-12T04:59:00.000Z", origin: BRANCH }),
              said({ atIso: "2026-10-12T04:59:01.000Z", id: "w", text: "synthetic" }),
            ],
          }),
        ],
      }),
    });

    expect(selection.beforeFloor).toBe(0);
    expect(selection.foreign).toEqual([{ callId: CALL, origin: BRANCH, stretches: 1 }]);
  });
});
