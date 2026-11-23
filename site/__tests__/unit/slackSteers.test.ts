import { describe, expect, it } from "vitest";

import { readDraftReviews, readSlackSteers, type SteerKindTrail } from "../../components/live/readSlackSteers";
import {
  correctionsPerDay,
  dayKey,
  KIND_COLOURS,
  kindState,
  kindStateLine,
  linePoints,
  perDay,
  weekly,
  windowDays,
} from "../../lib/slackSteers";

const SYDNEY = "Australia/Sydney";

/** One kind's trail as `profile steers --json` publishes it. */
const DASHES = {
  kind: "em-dashes",
  lastCorrectedIso: "2026-09-02T23:30:00.000Z",
  points: [
    {
      anchor: "talk-call:c#1",
      atIso: "2026-09-01T00:00:00.000Z",
      quote: "get rid of the em dashes",
      says: "corrects",
      text: "That draft, get rid of the em dashes.",
    },
    { anchor: "talk-call:c#2", atIso: "2026-09-02T23:30:00.000Z", quote: "dashes again", says: "corrects" },
    { anchor: "talk-call:c#3", atIso: "2026-10-04T00:00:00.000Z", quote: "no em dashes in ages", says: "stopped" },
  ],
  stoppedIso: "2026-10-04T00:00:00.000Z",
  title: "Em dashes",
};

const PAYLOAD = {
  gaps: ["supervisor: the chain starts at 2026-08-10"],
  kinds: [DASHES, { kind: "proof", points: [], title: "Proof attached" }],
  observedAtIso: "2026-10-05T00:00:00.000Z",
  read: 12,
  residue: ["a turn naming a kind in other words is never read"],
  sinceIso: "2026-09-01T00:00:00.000Z",
  surface: "slack",
  unparsed: [],
  unread: 3,
};

describe("readSlackSteers", () => {
  it("reads every trail and point, a missing turn text and a never-corrected kind included", () => {
    const steers = readSlackSteers(PAYLOAD)!;
    expect(steers.kinds.map((trail) => [trail.kind, trail.points.length, trail.lastCorrectedIso])).toEqual([
      ["em-dashes", 3, "2026-09-02T23:30:00.000Z"],
      ["proof", 0, undefined],
    ]);
    expect(steers.kinds[0].points[1].text).toBeUndefined();
    expect([steers.read, steers.unread]).toEqual([12, 3]);
  });

  it("carries the verdict journal's lines that would not read, and refuses a list that is not line numbers", () => {
    expect(readSlackSteers({ ...PAYLOAD, unparsed: [2, 7] })!.unparsed).toEqual([2, 7]);
    expect([
      readSlackSteers({ ...PAYLOAD, unparsed: undefined }),
      readSlackSteers({ ...PAYLOAD, unparsed: [0] }),
      readSlackSteers({ ...PAYLOAD, unparsed: ["2"] }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("refuses the whole reading over one point that will not read, so no chart draws a fall that did not happen", () => {
    const broken = { ...PAYLOAD, kinds: [{ ...DASHES, points: [{ ...DASHES.points[0], says: "maybe" }] }] };
    expect(readSlackSteers(broken)).toBeUndefined();
    expect(readSlackSteers({ ...PAYLOAD, kinds: [{ ...DASHES, stoppedIso: "yesterday" }] })).toBeUndefined();
    expect(readSlackSteers({ ...PAYLOAD, unread: undefined })).toBeUndefined();
  });
});

describe("readDraftReviews", () => {
  it("reads the instants the owner said yes to a draft and refuses one that is not an instant", () => {
    expect(readDraftReviews({ reviewed: ["2026-10-01T00:00:00.000Z"] })).toEqual(["2026-10-01T00:00:00.000Z"]);
    expect(readDraftReviews({ reviewed: ["soon"] })).toBeUndefined();
  });
});

describe("dayKey and windowDays", () => {
  it("counts days on the owner's calendar, not UTC's", () => {
    expect(dayKey({ iso: "2026-09-02T23:30:00.000Z", timeZone: SYDNEY })).toBe("2026-09-03");
    expect(dayKey({ iso: "2026-09-02T23:30:00.000Z", timeZone: "UTC" })).toBe("2026-09-02");
  });

  it("names every day of the window once, oldest first, ending on today", () => {
    expect(
      windowDays({ nowIso: "2026-10-03T12:00:00.000Z", sinceIso: "2026-09-30T20:00:00.000Z", timeZone: SYDNEY }),
    ).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("keeps the 23-hour day the owner's clocks go forward on, from a floor late in the evening before it", () => {
    // The floor is late in the evening in Sydney, and the clocks go forward in the small hours of the next day.
    expect(
      windowDays({ nowIso: "2026-10-06T00:00:00.000Z", sinceIso: "2026-10-03T13:30:00.000Z", timeZone: SYDNEY }),
    ).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
  });

  it("names no day when the floor is after the ceiling", () => {
    expect(
      windowDays({ nowIso: "2026-10-01T00:00:00.000Z", sinceIso: "2026-10-03T00:00:00.000Z", timeZone: SYDNEY }),
    ).toEqual([]);
  });
});

describe("perDay and correctionsPerDay", () => {
  const days = ["2026-09-01", "2026-09-02", "2026-09-03"];

  it("puts one turn on the day it fell, and leaves an instant off the axis uncounted", () => {
    expect(
      perDay({
        days,
        isos: ["2026-09-01T03:00:00.000Z", "2026-09-01T04:00:00.000Z", "2026-12-01T00:00:00.000Z"],
        timeZone: "UTC",
      }),
    ).toEqual([2, 0, 0]);
  });

  it("counts only corrections on a kind's line, never the owner's word that it stopped", () => {
    const trail = readSlackSteers(PAYLOAD)!.kinds[0];
    expect(correctionsPerDay({ days, timeZone: SYDNEY, trail })).toEqual([1, 0, 1]);
  });
});

describe("weekly", () => {
  it("sums days into weeks ending on the last day, leaving the oldest week short", () => {
    const days = [1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 3, 0];
    expect(weekly({ counts: days })).toEqual([1, 2, 3]);
  });

  it("draws nothing for an empty axis", () => {
    expect(weekly({ counts: [] })).toEqual([]);
  });
});

describe("kindState and kindStateLine", () => {
  const day = ({ iso }: { iso: string }): string => iso.slice(0, 10);
  const trail: SteerKindTrail = readSlackSteers(PAYLOAD)!.kinds[0];

  it("says when it was last named, how long nothing has been observed, and the owner's word apart", () => {
    const state = kindState({ nowIso: "2026-10-05T00:00:00.000Z", trail });
    expect(state).toEqual({
      days: 32,
      kind: "quiet",
      lastIso: "2026-09-02T23:30:00.000Z",
      stoppedIso: "2026-10-04T00:00:00.000Z",
    });
    expect(kindStateLine({ day, state })).toBe(
      "Last named 2026-09-02; nothing observed for 32 days. You said it stopped on 2026-10-04.",
    );
  });

  it("asserts nothing about a kind no turn names", () => {
    const quiet = readSlackSteers(PAYLOAD)!.kinds[1];
    expect(kindStateLine({ day, state: kindState({ nowIso: "2026-10-05T00:00:00.000Z", trail: quiet }) })).toBe(
      "No turn of yours in this window names it.",
    );
  });
});

describe("linePoints", () => {
  it("spreads the days across the width and scales each count up from the floor", () => {
    expect(linePoints({ counts: [0, 2, 1], height: 10, top: 2, width: 100 })).toBe("0.0,10.0 50.0,0.0 100.0,5.0");
  });

  it("draws a flat floor when nothing was counted", () => {
    expect(linePoints({ counts: [0, 0], height: 10, top: 0, width: 10 })).toBe("0.0,10.0 10.0,10.0");
  });
});

describe("KIND_COLOURS", () => {
  it("gives every kind the verb publishes a colour of its own", () => {
    const kinds = ["em-dashes", "voice", "length", "stakeholders", "proof", "place", "withheld"];
    expect(kinds.filter((kind) => KIND_COLOURS[kind] === undefined)).toEqual([]);
    expect(new Set(Object.values(KIND_COLOURS)).size).toBe(kinds.length);
  });
});
