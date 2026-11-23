import { describe, expect, it } from "vitest";

import type { Item } from "../../../sessionStart/item.js";
import { foldLockInLedger, type LockInRow } from "../../../sessionStart/lockIn.js";
import type { DroppedItem, RankedItem, Ranking } from "../../../sessionStart/rank.js";
import {
  anchorsIn,
  applyStandings,
  type InFlightRun,
  inFlightUnder,
  ruledBy,
  standingHoldsBack,
  standingLabel,
  standingOf,
  standingsOf,
} from "../../../sessionStart/standing.js";

const NOW = "2026-09-03T00:00:00.000Z";

/** The four rows that led the owner's list, by number, so the fixture is the incident. */
const PR = ({ number, over = {} }: { number: number; over?: Partial<Item> }): Item => ({
  background: "A pull request you opened in acme/acme-admin. Its title is the line above.",
  branch: `feature/pr-${String(number)}`,
  doneWhen: `Get the codeowner approvals acme/acme-admin#${String(number)} still owes before merging`,
  nativeId: `acme/acme-admin#${String(number)}`,
  repo: "acme/acme-admin",
  source: "github",
  whenIso: "2026-09-02T06:54:51.000Z",
  where: `https://github.com/acme/acme-admin/pull/${String(number)}`,
  who: "your own pull request",
  ...over,
});

const row = ({ identity, over = {} }: { identity: string; over?: Partial<LockInRow> }): LockInRow => ({
  againstWhenIso: "2026-09-02T06:54:51.000Z",
  identity,
  outcome: "approved-as-proposed",
  proposed: "Get the codeowner approvals",
  tsIso: "2026-09-02T12:10:00.000Z",
  verb: "do",
  ...over,
});

const ranked = ({ item, score }: { item: Item; score: number }): RankedItem => ({
  contributions: { age: 0, directness: 3, distanceToDone: 3, drift: 0, explicitPriority: 0, stoppedOnOwner: 0 },
  finishesInFlight: true,
  item,
  score,
  trace: { carried: [], reason: "traced, and still open where it came from", verdict: "rank" },
  unverified: false,
  why: "one reply finishes it",
});

const dropped = ({ item }: { item: Item }): DroppedItem => ({ item, reason: "sitting with a colleague" });

const NO_RUNS: readonly InFlightRun[] = [];
const NO_RULINGS = foldLockInLedger({ rows: [] });

describe("anchorsIn", () => {
  it("finds every URL and every owner/repo#number a doc names, once each, in order", () => {
    const text =
      "Land https://github.com/acme/acme-admin/pull/16358. Then acme/acme-admin#16366 and again " +
      "https://github.com/acme/acme-admin/pull/16358, plus the thread https://x.slack.com/archives/C1/p1?thread_ts=2.";
    expect(anchorsIn({ text })).toEqual([
      "https://github.com/acme/acme-admin/pull/16358",
      "acme/acme-admin#16366",
      "https://x.slack.com/archives/C1/p1?thread_ts=2",
    ]);
  });

  it("names nothing for prose with no anchor in it", () => {
    expect(anchorsIn({ text: "the #16415 stack gets no review asks until PR 1 lands" })).toEqual([]);
  });
});

describe("inFlightUnder", () => {
  it("joins on the run's branch first, and says so", () => {
    const runs: readonly InFlightRun[] = [
      { anchors: [], branch: "feature/pr-16358", slug: "acme-review-and-conflicts-16358" },
    ];
    expect(inFlightUnder({ item: PR({ number: 16358 }), runs })).toEqual({
      joinedBy: "branch",
      kind: "in-flight",
      slug: "acme-review-and-conflicts-16358",
    });
  });

  it("joins on an anchor the run's doc names, exactly, never on a substring", () => {
    const runs: readonly InFlightRun[] = [
      { anchors: ["https://github.com/acme/acme-admin/pull/1635"], branch: undefined, slug: "other" },
      {
        anchors: ["https://github.com/acme/acme-admin/pull/16358"],
        branch: undefined,
        sessionKey: "ws-57",
        slug: "pr-16358",
      },
    ];
    expect(inFlightUnder({ item: PR({ number: 16358 }), runs })).toEqual({
      joinedBy: "anchor",
      kind: "in-flight",
      sessionKey: "ws-57",
      slug: "pr-16358",
    });
  });

  it("joins on the item's own reference when the doc spells that instead of the URL", () => {
    const runs: readonly InFlightRun[] = [{ anchors: ["acme/acme-admin#16366"], branch: undefined, slug: "r" }];
    expect(inFlightUnder({ item: PR({ number: 16366 }), runs })!.slug).toBe("r");
  });

  it("never joins a row to a run working in another repository, however many pull requests its doc names", () => {
    const runs: readonly InFlightRun[] = [
      {
        anchors: ["https://github.com/acme/acme-admin/pull/16358", "acme/acme-admin#16358"],
        branch: "feature/pr-16358",
        repo: "slopweaver",
        slug: "ranked-list-resurfaces-items-already-ruled-on",
      },
    ];
    expect(inFlightUnder({ item: PR({ number: 16358 }), runs })).toBe(undefined);
  });

  it("joins a row to a run that names its own repository", () => {
    const runs: readonly InFlightRun[] = [
      { anchors: ["acme/acme-admin#16358"], branch: undefined, repo: "acme-admin", slug: "r" },
    ];
    expect(inFlightUnder({ item: PR({ number: 16358 }), runs })!.slug).toBe("r");
  });

  it("does not join an item with no branch to a run with no branch", () => {
    const runs: readonly InFlightRun[] = [{ anchors: [], branch: undefined, slug: "r" }];
    const { branch: _unbranched, ...item } = PR({ number: 16358 });
    expect(inFlightUnder({ item, runs })).toBe(undefined);
  });
});

describe("ruledBy", () => {
  it("reads a ruling recorded by identity", () => {
    const states = foldLockInLedger({ rows: [row({ identity: "github:acme/acme-admin#16358" })] });
    expect(ruledBy({ item: PR({ number: 16358 }), nowIso: NOW, states })).toEqual({
      atIso: "2026-09-02T12:10:00.000Z",
      kind: "ruled",
      outcome: "approved-as-proposed",
    });
  });

  it("reads a ruling recorded by the row's anchor URL, which is what a supervisor holds", () => {
    const states = foldLockInLedger({
      rows: [
        row({
          identity: "https://github.com/acme/acme-admin/pull/16358",
          over: { outcome: "rejected", reason: "wrong-action", verb: "skip" },
        }),
      ],
    });
    expect(ruledBy({ item: PR({ number: 16358 }), nowIso: NOW, states })).toEqual({
      atIso: "2026-09-02T12:10:00.000Z",
      kind: "ruled",
      outcome: "rejected",
      reason: "wrong-action",
    });
  });

  it("lapses the moment the pull request moves past what the owner ruled against", () => {
    const states = foldLockInLedger({ rows: [row({ identity: "github:acme/acme-admin#16358" })] });
    const moved = PR({ number: 16358, over: { whenIso: "2026-09-02T18:00:00.000Z" } });
    expect(ruledBy({ item: moved, nowIso: NOW, states })).toBe(undefined);
  });
});

describe("standingOf", () => {
  const pr = PR({ number: 16367 });

  it("calls an item nobody has touched untouched", () => {
    expect(standingOf({ item: pr, nowIso: NOW, runs: NO_RUNS, states: NO_RULINGS })).toEqual({ kind: "untouched" });
  });

  it("puts the owner's own ruling above a session being inside the work", () => {
    const states = foldLockInLedger({ rows: [row({ identity: "github:acme/acme-admin#16367" })] });
    const runs: readonly InFlightRun[] = [{ anchors: [], branch: "feature/pr-16367", slug: "r" }];
    expect(standingOf({ item: pr, nowIso: NOW, runs, states }).kind).toBe("ruled");
  });

  it("names the session when only a run touches the item", () => {
    const runs: readonly InFlightRun[] = [{ anchors: [], branch: "feature/pr-16367", slug: "r" }];
    expect(standingOf({ item: pr, nowIso: NOW, runs, states: NO_RULINGS })).toEqual({
      joinedBy: "branch",
      kind: "in-flight",
      slug: "r",
    });
  });
});

describe("standingLabel", () => {
  it("says nothing for an untouched row", () => {
    expect(standingLabel({ standing: { kind: "untouched" } })).toBe(undefined);
  });

  it("dates a ruling and names its outcome and reason", () => {
    expect(
      standingLabel({
        standing: { atIso: "2026-09-02T12:10:00.000Z", kind: "ruled", outcome: "rejected", reason: "wrong-action" },
      }),
    ).toBe("ruled 2026-09-02 (rejected, wrong-action)");
  });

  it("names the session and how it was joined", () => {
    expect(standingLabel({ standing: { joinedBy: "branch", kind: "in-flight", slug: "pr-16358" } })).toBe(
      "in flight, session pr-16358 — it opened on this branch",
    );
    expect(
      standingLabel({ standing: { joinedBy: "anchor", kind: "in-flight", sessionKey: "ws-57", slug: "pr-16358" } }),
    ).toBe("in flight, session ws-57 — its doc names this");
  });
});

describe("standingHoldsBack", () => {
  it("holds back in-flight and nothing else", () => {
    expect(standingHoldsBack({ standing: { kind: "untouched" } })).toBe(false);
    expect(standingHoldsBack({ standing: { atIso: NOW, kind: "ruled", outcome: "approved-as-proposed" } })).toBe(false);
    expect(standingHoldsBack({ standing: { atIso: NOW, kind: "ruled", outcome: "deferred" } })).toBe(false);
    expect(standingHoldsBack({ standing: { joinedBy: "branch", kind: "in-flight", slug: "r" } })).toBe(true);
  });
});

describe("applyStandings", () => {
  const untouched = PR({ number: 16384 });
  const approved = PR({ number: 16358 });
  const inFlight = PR({ number: 16366 });
  const aside = PR({ number: 16369 });
  const ranking: Ranking = {
    dropped: [dropped({ item: aside })],
    ranked: [
      ranked({ item: approved, score: 9 }),
      ranked({ item: inFlight, score: 8 }),
      ranked({ item: untouched, score: 3 }),
    ],
  };
  const standings = standingsOf({
    items: [approved, inFlight, untouched, aside],
    nowIso: NOW,
    runs: [{ anchors: [], branch: "feature/pr-16366", slug: "pr-16366" }],
    states: foldLockInLedger({ rows: [row({ identity: "github:acme/acme-admin#16358" })] }),
  });
  const applied = applyStandings({ ranking, standings });

  it("demotes a row the owner already ruled on below every untouched row, keeping its score", () => {
    expect(applied.ranked.map((one) => one.item.nativeId)).toEqual(["acme/acme-admin#16384", "acme/acme-admin#16358"]);
    expect(applied.ranked[1]!.score).toBe(9);
    expect(applied.ranked[1]!.standing).toEqual({
      atIso: "2026-09-02T12:10:00.000Z",
      kind: "ruled",
      outcome: "approved-as-proposed",
    });
  });

  it("holds back what a session is inside, with the label as the reason", () => {
    expect(applied.dropped.map((one) => [one.item.nativeId, one.reason])).toEqual([
      ["acme/acme-admin#16369", "sitting with a colleague"],
      ["acme/acme-admin#16366", "in flight, session pr-16366 — it opened on this branch"],
    ]);
  });

  it("stamps every row, ranked and dropped alike, with its standing", () => {
    expect(applied.ranked[0]!.standing).toEqual({ kind: "untouched" });
    expect(applied.dropped[0]!.standing).toEqual({ kind: "untouched" });
    expect(applied.dropped[1]!.standing).toEqual({ joinedBy: "branch", kind: "in-flight", slug: "pr-16366" });
  });
});
