import { describe, expect, it } from "vitest";

import type { AssembledList } from "../../../cli/commands/sessionStart/emit.js";
import { jsonDocument, standingTally } from "../../../cli/commands/sessionStart/emit.js";
import type { Item } from "../../../sessionStart/item.js";
import type { DroppedItem, RankedItem, Ranking } from "../../../sessionStart/rank.js";

const item = (over: Partial<Item> = {}): Item => ({
  background: "what this thing is, for a reader holding no context",
  doneWhen: "close it, the work shipped",
  nativeId: "AAA-1",
  source: "linear",
  state: "open, but the work is done",
  whenIso: "2026-08-20T00:00:00.000Z",
  where: "https://linear.app/w/issue/AAA-1",
  who: "your own cycle",
  ...over,
});

const ranked = (over: Partial<RankedItem> = {}): RankedItem => ({
  contributions: { age: 0, directness: 3, distanceToDone: 3, drift: 4, explicitPriority: 0, stoppedOnOwner: 0 },
  finishesInFlight: true,
  item: item(),
  score: 10,
  trace: { carried: [], reason: "traced, and still open where it came from", verdict: "rank" },
  unverified: false,
  why: "one reply finishes it",
  ...over,
});

const dropped = (over: Partial<DroppedItem> = {}): DroppedItem => ({
  item: item({ nativeId: "AAA-2" }),
  reason: "held",
  ...over,
});

const assembled = (over: Partial<AssembledList> = {}): AssembledList => ({
  couldNotSee: [],
  cutShort: [],
  docsRead: 0,
  mailAnsweredAfterOwner: 0,
  mailRead: 0,
  movements: [],
  nowIso: "2026-09-21T00:00:00.000Z",
  paused: [],
  proposalsRead: 0,
  pullRequestsRead: 0,
  pullRequestsWaiting: 0,
  ranking: { dropped: [], ranked: [] },
  settledByLockIn: 0,
  sinceIso: undefined,
  slackThreadsMoved: 0,
  slackThreadsRead: 0,
  slackThreadsTagged: 0,
  slackThreadsTagging: 0,
  standingTally: { inFlight: 0, ruled: 0, untouched: 0 },
  ...over,
});

describe("standingTally", () => {
  it("counts a row with no standing as untouched rather than as nothing", () => {
    expect(standingTally({ ranking: { dropped: [], ranked: [ranked()] } })).toEqual({
      inFlight: 0,
      ruled: 0,
      untouched: 1,
    });
  });

  it("counts a dropped row's standing too, so a held-back row is still countable", () => {
    const ranking: Ranking = {
      dropped: [dropped({ standing: { atIso: "2026-09-01T00:00:00.000Z", kind: "ruled", outcome: "deferred" } })],
      ranked: [ranked({ standing: { joinedBy: "branch", kind: "in-flight", slug: "a-run" } })],
    };
    expect(standingTally({ ranking })).toEqual({ inFlight: 1, ruled: 1, untouched: 0 });
  });

  it("answers zeros on an empty ranking, so nothing-was-ruled reads differently from standings-never-ran", () => {
    expect(standingTally({ ranking: { dropped: [], ranked: [] } })).toEqual({
      inFlight: 0,
      ruled: 0,
      untouched: 0,
    });
  });
});

describe("jsonDocument", () => {
  it("carries what a deadline cut, so a reader tells a partial list from a whole one", () => {
    expect(jsonDocument(assembled({ cutShort: ["your mail", "the live re-read"] }))["cutShort"]).toEqual([
      "your mail",
      "the live re-read",
    ]);
    expect(jsonDocument(assembled())["cutShort"]).toEqual([]);
  });

  it("writes `since: null` on a first run rather than omitting the key", () => {
    expect(jsonDocument(assembled())["since"]).toBe(null);
  });

  it("carries the previous run's instant when there was one", () => {
    expect(jsonDocument(assembled({ sinceIso: "2026-09-20T00:00:00.000Z" }))["since"]).toBe("2026-09-20T00:00:00.000Z");
  });

  it("carries both Slack counts, which are separate detectors rather than one number", () => {
    const document = jsonDocument(
      assembled({ slackThreadsMoved: 3, slackThreadsRead: 11, slackThreadsTagged: 5, slackThreadsTagging: 9 }),
    );
    expect(document["slackThreadsRead"]).toBe(11);
    expect(document["slackThreadsMoved"]).toBe(3);
    expect(document["slackThreadsTagging"]).toBe(9);
    expect(document["slackThreadsTagged"]).toBe(5);
  });

  it("tallies the movements it was handed, and carries them through unreduced", () => {
    const movements = [
      { detail: "it was not on the last list", identity: "linear:AAA-1", label: "new" as const },
      { detail: "it is gone from this one", identity: "linear:AAA-2", label: "gone" as const },
    ];
    const document = jsonDocument(assembled({ movements }));
    expect(document["movementTally"]).toEqual({ gone: 1, moved: 0, new: 1, unchanged: 0 });
    expect(document["movements"]).toEqual(movements);
  });

  it("spells the mail count and every ranked row's signals owner-neutral on the wire", () => {
    const row = ranked({ contributions: { ...ranked().contributions, stoppedOnOwner: 5 } });
    const wire = JSON.parse(
      JSON.stringify(jsonDocument(assembled({ mailAnsweredAfterOwner: 2, ranking: { dropped: [], ranked: [row] } }))),
    ) as { mailAnsweredAfterOwner: number; ranking: { ranked: { contributions: Record<string, number> }[] } };
    expect(wire.mailAnsweredAfterOwner).toBe(2);
    expect(Object.keys(wire.ranking.ranked[0]!.contributions).toSorted()).toEqual([
      "age",
      "directness",
      "distanceToDone",
      "drift",
      "explicitPriority",
      "stoppedOnOwner",
    ]);
  });
});
