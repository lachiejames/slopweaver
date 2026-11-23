/**
 * "Come back to it": a card the owner put off steps below every card they have not, keeps its tier for the badge's count, and the
 * order is derived from the `queue deferred` reading alone.
 */
import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { type CardDeferrals, readCardDeferrals } from "../../components/live/readCardDeferrals";
import type { LiveState } from "../../components/live/useLive";
import { deferralGap, deferredLast, withDeferrals } from "../../lib/cardDeferrals";
import { cardLinksOf } from "../../lib/openCard";
import { queueCounts } from "../../lib/queueCardCounts";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { triageOrder } from "../../lib/triage";
import { ACME_PLACER } from "../organisationFixture";
import { queueLayout } from "./inItsOwnView";

const LOADING = { phase: "loading" } as const;

/** One ready reading. */
function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-05T12:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** The one ask row a published board with a single ask yields, re-keyed per test. */
function askRow({ slug, tier }: { slug: string; tier: QueueRow["tier"] }): QueueRow {
  const board = readBoard({
    rows: [
      {
        anchor: "transcript:fixture#entry",
        kind: "ask",
        options: [
          { letter: "A", option: "Approve the policies", tradeoff: "an hour of reading" },
          { letter: "B", option: "Leave them", tradeoff: "the audit gate stays shut" },
        ],
        ownerWait: "owner",
        priority: "p1",
        question: "Approve the policy documents?",
        questionAskedIso: "2026-10-01T09:00:00.000Z",
        reason: "waiting on the owner",
        section: "runnable",
        slug: "policy-approvals",
        status: "waiting-on-owner",
      },
    ],
    unresolved: 0,
  })!;
  const [row] = rowsOf({
    acts: LOADING,
    board: ready({ value: board }),
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    standing: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  return { ...row, id: slug, key: `ask:${slug}`, tier };
}

/** A `queue deferred` reading naming these cards, oldest first as the verb folds them. */
function deferring({
  cards,
}: {
  cards: readonly { cardKey: string; deferredIso: string }[];
}): LiveState<CardDeferrals> {
  return ready({ value: readCardDeferrals({ deferrals: cards, unreadable: [] })! });
}

const POLICIES = askRow({ slug: "policy-approvals", tier: "team-blocked" });
const BLOCKER = askRow({ slug: "pool-exhaustion", tier: "team-blocked" });
const FLEET = askRow({ slug: "fleet-stopped", tier: "fleet-blocked" });
const CHECK_IN = askRow({ slug: "evaluation", tier: "check-in" });
const ROWS = [POLICIES, BLOCKER, FLEET, CHECK_IN];

describe("readCardDeferrals", () => {
  it("reads the verb's payload, and refuses the whole reading over one deferral that does not read", () => {
    expect([
      readCardDeferrals({
        deferrals: [{ cardKey: "ask:x", deferredIso: "2026-10-05T11:58:00.000Z" }],
        unreadable: [3],
      }),
      readCardDeferrals({ deferrals: [{ cardKey: "ask:x" }], unreadable: [] }),
      // A string that is no instant would ride the row as words the voice reads a briefing out of.
      readCardDeferrals({ deferrals: [{ cardKey: "ask:x", deferredIso: "page:deferral-briefing" }], unreadable: [] }),
      readCardDeferrals({ deferrals: [] }),
      readCardDeferrals("not a payload"),
    ]).toEqual([
      { deferrals: [{ cardKey: "ask:x", deferredIso: "2026-10-05T11:58:00.000Z" }], unreadable: 1 },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("withDeferrals and the Queue's order", () => {
  const deferred = withDeferrals({
    deferrals: deferring({ cards: [{ cardKey: "ask:policy-approvals", deferredIso: "2026-10-05T11:58:00.000Z" }] }),
    rows: ROWS,
  });

  it("stamps only the card the owner put off, leaving its tier where it was", () => {
    expect(deferred.map((row) => [row.key, row.tier, row.deferredIso])).toEqual([
      ["ask:policy-approvals", "team-blocked", "2026-10-05T11:58:00.000Z"],
      ["ask:pool-exhaustion", "team-blocked", undefined],
      ["ask:fleet-stopped", "fleet-blocked", undefined],
      ["ask:evaluation", "check-in", undefined],
    ]);
  });

  it("draws the card the owner put off below every card they have not, check-ins included", () => {
    const keys = queueLayout({ expanded: [], focuses: [], rows: deferred }).map((entry) =>
      "key" in entry ? entry.key : "fold",
    );
    expect(keys).toEqual(["ask:pool-exhaustion", "ask:fleet-stopped", "ask:evaluation", "ask:policy-approvals"]);
  });

  it("puts the policy card first again once the owner brings it back up", () => {
    const restored = withDeferrals({ deferrals: deferring({ cards: [] }), rows: ROWS });
    const keys = queueLayout({ expanded: [], focuses: [], rows: restored }).map((entry) =>
      "key" in entry ? entry.key : "fold",
    );
    expect(keys).toEqual(["ask:policy-approvals", "ask:pool-exhaustion", "ask:fleet-stopped", "ask:evaluation"]);
  });

  it("keeps the answered-or-not accounting exactly as it was", () => {
    expect([queueCounts({ rows: deferred }), queueCounts({ rows: ROWS })]).toEqual([
      { toReview: 1, waiting: 3 },
      { toReview: 1, waiting: 3 },
    ]);
  });

  it("leaves every card in its own place while the reading has not arrived, or did not read", () => {
    const loading = withDeferrals({ deferrals: LOADING, rows: ROWS });
    const failed = withDeferrals({ deferrals: { phase: "not-measured", why: "exit 1" }, rows: ROWS });
    expect([loading, failed]).toEqual([ROWS, ROWS]);
  });

  it("stamps no row from a reading built by hand whose instant is not one, so it names no briefing", () => {
    const built = ready({
      value: {
        deferrals: [
          { cardKey: "ask:policy-approvals", deferredIso: "page:deferral-briefing" },
          { cardKey: "ask:pool-exhaustion", deferredIso: "2026-10-05T11:58:00Z" },
        ],
        unreadable: 0,
      },
    });
    const stamped = withDeferrals({ deferrals: built, rows: ROWS });
    expect(stamped.map((row) => row.deferredIso)).toEqual([undefined, "2026-10-05T11:58:00Z", undefined, undefined]);
    const policies = stamped.find((row) => row.key === "ask:policy-approvals")!;
    expect(cardLinksOf({ row: policies }).briefings).toEqual([]);
  });

  it("walks the card the owner put off last in a triage pass", () => {
    const walk = triageOrder({ rows: deferred, sectionOf: (row) => row.tier });
    expect(walk.map((row) => row.key)).toEqual([
      "ask:pool-exhaustion",
      "ask:fleet-stopped",
      "ask:evaluation",
      "ask:policy-approvals",
    ]);
  });
});

describe("deferredLast", () => {
  it("orders the deferred cards oldest deferral first, the rest in the order given", () => {
    const rows = [
      { deferredIso: "2026-10-05T12:30:00.000Z", key: "c" },
      { key: "a" },
      { deferredIso: "2026-10-05T11:58:00.000Z", key: "d" },
      { key: "b" },
    ];
    const { now, deferred } = deferredLast({ rows });
    expect([now.map((row) => row.key), deferred.map((row) => row.key)]).toEqual([
      ["a", "b"],
      ["d", "c"],
    ]);
  });

  // A park dated before a plain deferral sorts behind it, and takes the voice list's last place.
  it("orders a parked card after every merely deferred one, however early the owner parked it", () => {
    const triage = { verdict: "park-working-session" } as const;
    const rows = [
      { deferredIso: "2026-01-01T00:00:00.000Z", key: "parked-early", triage },
      { deferredIso: "2026-02-01T00:00:00.000Z", key: "deferred" },
      { deferredIso: "2025-12-01T00:00:00.000Z", key: "parked-earlier", triage },
    ];
    expect(deferredLast({ rows }).deferred.map((row) => row.key)).toEqual([
      "deferred",
      "parked-earlier",
      "parked-early",
    ]);
  });

  // A triage mark other than a park never sorts as one, so a deferred recut carrying `rewrite` stays ahead of a real park.
  it("orders a deferred card carrying a non-park ruling with the merely deferred, ahead of every park", () => {
    const rows = [
      { deferredIso: "2026-01-01T00:00:00.000Z", key: "parked", triage: { verdict: "park-working-session" } as const },
      { deferredIso: "2026-02-01T00:00:00.000Z", key: "rewriting", triage: { verdict: "rewrite" } as const },
    ];
    expect(deferredLast({ rows }).deferred.map((row) => row.key)).toEqual(["rewriting", "parked"]);
  });
});

describe("deferralGap", () => {
  it("marks nothing while loading or when whole, and a staleness fact saying why when the order is not the owner's", () => {
    expect([
      deferralGap({ deferrals: LOADING }),
      deferralGap({ deferrals: deferring({ cards: [] }) }),
      deferralGap({ deferrals: { phase: "not-measured", why: "exit 1" } }),
      deferralGap({ deferrals: ready({ value: { deferrals: [], unreadable: 2 } }) }),
    ]).toEqual([
      undefined,
      undefined,
      { subject: "the cards you put off", why: "exit 1; every card stands in its own place" },
      {
        subject: "2 line(s) of the cards you put off",
        why: "the ledger line did not parse; one may be back in its own place",
      },
    ]);
  });

  it("starts a new sentence after a reason that already ends one, never `.;`", () => {
    expect(deferralGap({ deferrals: { phase: "not-measured", why: "so it has to be inside one." } })).toEqual({
      subject: "the cards you put off",
      why: "so it has to be inside one. Every card stands in its own place",
    });
  });
});
