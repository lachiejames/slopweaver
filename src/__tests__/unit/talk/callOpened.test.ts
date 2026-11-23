/*
 * What a call file's open lines say about the call, folded one line at a time — a late line for an older session never
 * takes the record back, and a tie in the same millisecond lands the same whichever order the lines arrive in.
 */

import { describe, expect, it } from "vitest";

import { openedAfter, openedBeforeAny } from "../../../talk/callOpened.js";
import type { CallOrigin } from "../../../talk/callOrigin.js";
import type { CallEntry } from "../../../talk/callRecord.js";

const open = ({
  atIso,
  origin,
  sessionId,
  surface,
}: {
  atIso: string;
  sessionId: string;
  surface?: "typed" | "voice";
  origin?: CallOrigin;
}): Extract<CallEntry, { kind: "open" }> => ({
  atIso,
  kind: "open",
  model: "gpt-realtime",
  ...(origin === undefined ? {} : { origin }),
  sessionId,
  ...(surface === undefined ? {} : { surface }),
  voice: "marin",
});

const FIRST = "2026-10-09T12:00:00.000Z";

describe("openedAfter", () => {
  it("takes the first open line whole, and reads one with no surface as a voice call", () => {
    const opened = openedAfter({
      entry: open({ atIso: FIRST, sessionId: "s-1" }),
      opened: openedBeforeAny({ openedIso: FIRST }),
    });
    expect(opened).toEqual({
      openedIso: FIRST,
      origin: undefined,
      sessionId: "s-1",
      sessionOpenedMs: Date.parse(FIRST),
      surface: "voice",
      voice: "marin",
    });
  });

  it("never lets a late line for an older session take the record back from the newer one", () => {
    const newer = openedAfter({
      entry: open({ atIso: "2026-10-09T12:05:00.000Z", sessionId: "s-2", surface: "typed" }),
      opened: openedBeforeAny({ openedIso: FIRST }),
    });
    const late = openedAfter({ entry: open({ atIso: FIRST, sessionId: "s-1" }), opened: newer });
    expect(late).toEqual(newer);
  });

  it("lands two sessions opened in the same millisecond on the one whose id sorts later, in either order", () => {
    const start = openedBeforeAny({ openedIso: FIRST });
    const a = open({ atIso: FIRST, sessionId: "s-a" });
    const b = open({ atIso: FIRST, sessionId: "s-b" });
    const aThenB = openedAfter({ entry: b, opened: openedAfter({ entry: a, opened: start }) });
    const bThenA = openedAfter({ entry: a, opened: openedAfter({ entry: b, opened: start }) });
    expect([aThenB.sessionId, bThenA.sessionId]).toEqual(["s-b", "s-b"]);
  });

  it("carries the winning open line's origin, and none when that line has none", () => {
    const origin: CallOrigin = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };
    const stamped = openedAfter({
      entry: open({ atIso: FIRST, origin, sessionId: "s-1" }),
      opened: openedBeforeAny({ openedIso: FIRST }),
    });
    const reopened = openedAfter({
      entry: open({ atIso: "2026-10-09T12:01:00.000Z", sessionId: "s-2" }),
      opened: stamped,
    });
    expect([stamped.origin, reopened.origin]).toEqual([origin, undefined]);
  });

  it("keeps the session's first open instant when the same session opens again", () => {
    const first = openedAfter({
      entry: open({ atIso: FIRST, sessionId: "s-1" }),
      opened: openedBeforeAny({ openedIso: FIRST }),
    });
    const again = openedAfter({ entry: open({ atIso: "2026-10-09T12:01:00.000Z", sessionId: "s-1" }), opened: first });
    expect([again.sessionOpenedMs, again.openedIso]).toEqual([Date.parse(FIRST), "2026-10-09T12:01:00.000Z"]);
  });
});
