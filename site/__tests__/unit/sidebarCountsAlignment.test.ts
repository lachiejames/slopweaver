/*
 * The Alignment entry's sidebar count: the general-ruling questions the owner has not answered, never the acts the
 * fleet already did, counted off readings and never printed while one it is made from is on its way or failed. Split
 * out of `sidebarCounts.test.ts` by describe block, so each file stays under the test-file size cap.
 */
import { describe, expect, it } from "vitest";

import type { SteeredAct } from "../../lib/alignmentRules";
import type { LiveState } from "../../lib/liveState";
import { alignmentWaitingOf, alignmentWaitingReadingOf, answerTo } from "../../lib/sidebarCountsAlignment";
import { staleCountFactsOf } from "../../lib/sidebarCountsBasis";

/**
 * A current reading of `value`, one kept over a failed read when `stale` is given, or one handed over to the next
 * read when `refreshing` is.
 */
function readingOf<T>({
  value,
  stale,
  refreshing,
  at = "2026-10-17T00:00:00.000Z",
}: {
  value: T;
  stale?: { why: string };
  refreshing?: true;
  at?: string;
}): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: at,
    phase: "ready",
    stampedByRoute: true,
    value,
    ...(stale === undefined ? {} : { stale }),
    ...(refreshing === undefined ? {} : { refreshing }),
  };
}

/** One ledger act of `kind`, steered by the owner after it when `steered`, under a standing rule when `ruled`. */
function act({
  actionId,
  kind = "github.rebase",
  steered = false,
  ruled = false,
}: {
  actionId: string;
  kind?: string;
  steered?: boolean;
  ruled?: boolean;
}): SteeredAct {
  return {
    actionId,
    directSteer: steered
      ? { atIso: "2026-10-20T00:00:00.000Z", dateBasis: "steered", given: "after", words: "fine" }
      : undefined,
    doneIso: "2026-10-19T00:00:00.000Z",
    kind,
    rule: ruled ? { classId: "press-merge-when-ready" } : undefined,
    subject: `https://github.com/acme/widgets/pull/${actionId}`,
  };
}

const ZERO = { count: 0, title: "no general-ruling question waiting on your answer" };

describe("answerTo", () => {
  const answers = [
    { about: "align:rule-close-pr", words: "shorter" },
    { about: "align:rule-merge", words: "yes" },
  ];

  it("finds the owner's answer to a question by its key, and none for a question not yet answered", () => {
    expect([
      answerTo({ answers, key: "align:rule-merge" }),
      answerTo({ answers, key: "align:rule-rebase" }),
      answerTo({ answers: undefined, key: "align:rule-merge" }),
    ]).toEqual([{ about: "align:rule-merge", words: "yes" }, undefined, undefined]);
  });
});

describe("staleCountFactsOf", () => {
  const count = { count: 2, title: "2 general-ruling questions waiting on your answer" };

  const next = "The console tries again today 9:14 am";

  it("warns only over a FAILED read: one fact per failure, its raw reason whole, and what the console does after the last", () => {
    const failed = {
      failures: [
        { lead: "the autonomy ledger did not read", subject: "the autonomy ledger", why: "exit 2" },
        { lead: "your answers on the page did not read", subject: "your answers on the page", why: "timed out" },
      ],
      kind: "failed",
      notes: [],
      observedAtIso: "2026-11-03T09:00:00.000Z",
    } as const;
    expect(staleCountFactsOf({ next, reading: { count, phase: "measured", stale: failed } })).toEqual([
      { observedAtIso: "2026-11-03T09:00:00.000Z", subject: "the autonomy ledger", why: "exit 2" },
      { after: next, observedAtIso: "2026-11-03T09:00:00.000Z", subject: "your answers on the page", why: "timed out" },
    ]);
  });

  it("draws no warning for a count merely being updated, a current one, or one with no number", () => {
    const updating = {
      kind: "updating",
      notes: ["the autonomy ledger is being read again now"],
      observedAtIso: "2026-11-03T09:00:00.000Z",
    } as const;
    expect([
      staleCountFactsOf({ next, reading: { count, phase: "measured", stale: updating } }),
      staleCountFactsOf({ next, reading: { count, phase: "measured" } }),
      staleCountFactsOf({ next, reading: { phase: "loading" } }),
      staleCountFactsOf({ next, reading: { phase: "not-measured", why: "exit 4" } }),
    ]).toEqual([[], [], [], []]);
  });
});

describe("alignmentWaitingOf", () => {
  it("counts only the questions not yet answered", () => {
    expect(
      alignmentWaitingOf({
        answers: [{ about: "align:rule-close-pr" }],
        questionKeys: ["align:rule-close-pr", "align:rule-rebase", "align:rule-card-no-receipts"],
      }),
    ).toEqual({ count: 2, title: "2 general-ruling questions waiting on your answer" });
  });

  it("says one question in the singular", () => {
    expect(alignmentWaitingOf({ answers: [], questionKeys: ["align:rule-rebase"] })).toEqual({
      count: 1,
      title: "1 general-ruling question waiting on your answer",
    });
  });

  it("reads zero, said as zero, once every question carries an answer or none is asked", () => {
    expect([
      alignmentWaitingOf({ answers: [{ about: "align:rule-close-pr" }], questionKeys: ["align:rule-close-pr"] }),
      alignmentWaitingOf({ answers: [], questionKeys: [] }),
    ]).toEqual([ZERO, ZERO]);
  });
});

describe("alignmentWaitingReadingOf", () => {
  const nothing = readingOf({ value: [] });
  /** Every input current and empty. */
  const current = { acts: nothing, answers: nothing, feedback: nothing, posts: nothing };

  it("reads zero over 1,259 acts the fleet did with no steer, since an act is never a question", () => {
    const acts = Array.from({ length: 1259 }, (_, index) =>
      act({ actionId: String(index), kind: index % 2 === 0 ? "press-merge-when-ready" : "resolve-own-threads" }),
    );
    expect(alignmentWaitingReadingOf({ ...current, acts: readingOf({ value: acts }) })).toEqual({
      count: ZERO,
      phase: "measured",
    });
  });

  it("counts a kind steered twice with no standing rule, until the owner answers it", () => {
    const acts = readingOf({
      value: [act({ actionId: "1", steered: true }), act({ actionId: "2", steered: true })],
    });
    expect([
      alignmentWaitingReadingOf({ ...current, acts }),
      alignmentWaitingReadingOf({
        ...current,
        acts,
        answers: readingOf({ value: [{ about: "align:rule-github.rebase" }] }),
      }),
    ]).toEqual([
      { count: { count: 1, title: "1 general-ruling question waiting on your answer" }, phase: "measured" },
      { count: ZERO, phase: "measured" },
    ]);
  });

  it("asks nothing of a kind a standing rule already covers, however often it was steered", () => {
    const acts = readingOf({
      value: [act({ actionId: "1", ruled: true, steered: true }), act({ actionId: "2", ruled: true, steered: true })],
    });
    expect(alignmentWaitingReadingOf({ ...current, acts })).toEqual({ count: ZERO, phase: "measured" });
  });

  it("prints no number while any reading it is made from is on its way or failed", () => {
    expect([
      alignmentWaitingReadingOf({ ...current, answers: { phase: "loading" } }),
      alignmentWaitingReadingOf({ ...current, acts: { phase: "loading" } }),
      alignmentWaitingReadingOf({ ...current, feedback: readingOf({ stale: { why: "exit 2" }, value: [] }) }),
      alignmentWaitingReadingOf({ ...current, posts: { phase: "not-measured", why: "exit 3" } }),
      alignmentWaitingReadingOf({ ...current, acts: { phase: "not-measured", why: "exit 5" } }),
      alignmentWaitingReadingOf({
        ...current,
        answers: { phase: "loading" },
        posts: readingOf({ refreshing: true, value: [] }),
      }),
    ]).toEqual([
      { phase: "loading" },
      { phase: "loading" },
      {
        failures: [
          {
            lead: "your feedback on drafts you sent back did not read",
            subject: "your feedback on drafts you sent back",
            why: "exit 2",
          },
        ],
        phase: "not-measured",
      },
      {
        failures: [{ lead: "the draft register did not read", subject: "the draft register", why: "exit 3" }],
        phase: "not-measured",
      },
      {
        failures: [{ lead: "the autonomy ledger did not read", subject: "the autonomy ledger", why: "exit 5" }],
        phase: "not-measured",
      },
      { phase: "loading" },
    ]);
  });

  it("names every read that failed at once, never only the first", () => {
    expect(
      alignmentWaitingReadingOf({
        ...current,
        acts: { phase: "not-measured", why: "autonomy failed" },
        answers: { phase: "not-measured", why: "answers failed" },
      }),
    ).toEqual({
      failures: [
        { lead: "the autonomy ledger did not read", subject: "the autonomy ledger", why: "autonomy failed" },
        { lead: "your answers on the page did not read", subject: "your answers on the page", why: "answers failed" },
      ],
      phase: "not-measured",
    });
  });

  it("counts readings handed over from the page before, marked stale as of the oldest — never a spinner, never unmarked", () => {
    expect(
      alignmentWaitingReadingOf({
        ...current,
        acts: readingOf({ at: "2026-10-25T18:05:00.000Z", refreshing: true, value: [] }),
        answers: readingOf({ at: "2026-10-25T18:01:00.000Z", refreshing: true, value: [] }),
      }),
    ).toEqual({
      count: ZERO,
      phase: "measured",
      stale: {
        kind: "updating",
        notes: ["the autonomy ledger and your answers on the page are being read again now"],
        observedAtIso: "2026-10-25T18:01:00.000Z",
      },
    });
  });

  it("still prints no number for a handed-over reading while another reading failed", () => {
    expect(
      alignmentWaitingReadingOf({
        ...current,
        answers: { phase: "not-measured", why: "exit 4" },
        posts: readingOf({ refreshing: true, value: [] }),
      }),
    ).toEqual({
      failures: [{ lead: "your answers on the page did not read", subject: "your answers on the page", why: "exit 4" }],
      phase: "not-measured",
    });
  });
});
