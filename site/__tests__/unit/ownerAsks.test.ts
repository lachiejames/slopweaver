/*
 * The console's own half of "is this ask really waiting on the owner's word". `src/handover/ownerWait.ts` decides
 * the verdict and `src/__tests__/unit/handover/ownerWait.test.ts` pins it; what is pinned here is what the
 * PAGE does with the verdict — which rows it lists, in what order, what age it is allowed to print, and
 * that the rows it drops are counted rather than vanished.
 *
 * It sits under `site/__tests__/unit/` because a file under `src/` may not import one outside it (TS6059,
 * the CI `compile` job); the unit lane reaches both roots.
 */

import { describe, expect, it } from "vitest";

import { type AskRow, askedOrder, askHint, askWhenIso, ownerAsksOf, waitWord } from "../../lib/ownerAsks";

const row = (over: Partial<AskRow> = {}): AskRow => ({
  ownerWait: "owner",
  question: "which option?",
  questionAskedIso: "2026-09-01T00:00:00.000Z",
  reason: "recorded question",
  ruledSinceQuestionIso: undefined,
  slug: "a-row",
  status: "ready",
  ...over,
});

describe("ownerAsksOf", () => {
  it("keeps only the rows whose verdict is the owner's", () => {
    const kept = ownerAsksOf({
      rows: [
        row({ ownerWait: "owner", slug: "owned" }),
        row({ ownerWait: "already-ruled", slug: "ruled" }),
        row({ ownerWait: "settled", slug: "settled" }),
        row({ ownerWait: "not-runnable", slug: "paused" }),
        row({ ownerWait: "not-waiting", question: undefined, slug: "quiet" }),
      ],
    });
    expect(kept.map((kept_) => kept_.slug)).toEqual(["owned"]);
  });

  it("orders the kept rows oldest question first, not by board order", () => {
    const kept = ownerAsksOf({
      rows: [
        row({ questionAskedIso: "2026-09-10T00:00:00.000Z", slug: "newest" }),
        row({ questionAskedIso: "2026-08-30T00:00:00.000Z", slug: "oldest" }),
        row({ questionAskedIso: "2026-09-05T00:00:00.000Z", slug: "middle" }),
      ],
    });
    expect(kept.map((kept_) => kept_.slug)).toEqual(["oldest", "middle", "newest"]);
  });

  it("sorts a row with no readable instant LAST rather than to the top", () => {
    const kept = ownerAsksOf({
      rows: [
        row({ questionAskedIso: "not-a-date", slug: "unparseable" }),
        row({ questionAskedIso: undefined, slug: "absent" }),
        row({ questionAskedIso: "2026-09-10T00:00:00.000Z", slug: "dated" }),
      ],
    });
    expect(kept.map((kept_) => kept_.slug)).toEqual(["dated", "unparseable", "absent"]);
  });

  it("drops a row carrying the owner's verdict but no question at all", () => {
    expect(ownerAsksOf({ rows: [row({ question: undefined })] })).toEqual([]);
  });
});

describe("askedOrder", () => {
  it("reads a well-formed instant as its epoch milliseconds", () => {
    expect(askedOrder({ row: row({ questionAskedIso: "2026-09-01T00:00:00.000Z" }) })).toBe(1788220800000);
  });

  it("answers Infinity for an unparseable instant", () => {
    expect(askedOrder({ row: row({ questionAskedIso: "not-an-instant" }) })).toBe(Number.POSITIVE_INFINITY);
  });

  it("answers Infinity for an absent instant", () => {
    expect(askedOrder({ row: row({ questionAskedIso: undefined }) })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("askWhenIso", () => {
  it("gives the owner's row its asked instant", () => {
    expect(askWhenIso({ row: row({ ownerWait: "owner", questionAskedIso: "2026-09-02T03:04:05.000Z" }) })).toBe(
      "2026-09-02T03:04:05.000Z",
    );
  });

  it("gives a PAUSED row no instant at all — a paused row carries no clock", () => {
    expect(
      askWhenIso({ row: row({ ownerWait: "not-runnable", questionAskedIso: "2026-09-02T03:04:05.000Z" }) }),
    ).toBeUndefined();
  });

  it("gives an already-ruled row no instant", () => {
    expect(askWhenIso({ row: row({ ownerWait: "already-ruled" }) })).toBeUndefined();
  });

  it("gives a settled row no instant", () => {
    expect(askWhenIso({ row: row({ ownerWait: "settled" }) })).toBeUndefined();
  });
});

describe("askHint", () => {
  it("is the one hint text, so a tally and a list cannot filter different sets", () => {
    expect(askHint({ row: row({ question: "which option?", reason: "parked", slug: "a-row" }) })).toBe(
      "a-row which option? parked",
    );
  });

  it("leaves an absent question as an empty field rather than the word undefined", () => {
    expect(askHint({ row: row({ question: undefined, reason: "parked", slug: "a-row" }) })).toBe("a-row  parked");
  });

  it("searches a detached ask's read reason too, since the question may sit inside the reason", () => {
    expect(askHint({ row: row({ reason: "its doc would not read", reasonWhy: "see the doc", slug: "a-row" }) })).toBe(
      "a-row which option? its doc would not read see the doc",
    );
  });
});

describe("waitWord", () => {
  it("names the ruling instant on an already-ruled row", () => {
    expect(
      waitWord({ row: row({ ownerWait: "already-ruled", ruledSinceQuestionIso: "2026-09-16T05:06:18.000Z" }) }),
    ).toBe("nobody: you ruled at 2026-09-16T05:06:18.000Z; it waits on a session to execute that");
  });

  it("says the instant is unrecorded rather than printing undefined", () => {
    expect(waitWord({ row: row({ ownerWait: "already-ruled", ruledSinceQuestionIso: undefined }) })).toBe(
      "nobody: you ruled at an unrecorded instant; it waits on a session to execute that",
    );
  });

  it("names the derived status on a settled row", () => {
    expect(waitWord({ row: row({ ownerWait: "settled", status: "done" }) })).toBe(
      "nobody: the row reads done, and the question was never cleared off its journal",
    );
  });

  it("says a paused row is not runnable either", () => {
    expect(waitWord({ row: row({ ownerWait: "not-runnable" }) })).toBe(
      "nobody right now: the row is paused, so it is not runnable either",
    );
  });

  it("says no question is open on a not-waiting row", () => {
    expect(waitWord({ row: row({ ownerWait: "not-waiting" }) })).toBe("nobody: no question is open on this row");
  });

  it("says you on the owner's row", () => {
    expect(waitWord({ row: row({ ownerWait: "owner" }) })).toBe("you");
  });
});
