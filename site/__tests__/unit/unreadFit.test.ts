/*
 * A Queue answer's unread list held to its own budget: it is added after the answer was fitted,
 * so unbounded it could carry the answer past the page's tool cap and have the whole answer refused.
 */
import { describe, expect, it } from "vitest";

import type { UnreadSource } from "../../lib/talkActionItems";
import { fitUnread, UNREAD_MAX_BYTES, unreadClause } from "../../lib/unreadFit";

/**
 * The list's weight as an answer carries it.
 *
 * @param unread the list
 * @returns its UTF-8 bytes inside `{"unread":…}`
 */
function weight({ unread }: { unread: readonly UnreadSource[] }): number {
  return new TextEncoder().encode(JSON.stringify({ unread })).length;
}

/**
 * Sources with reasons of one length.
 *
 * @param count how many
 * @param why each one's reason
 * @returns the list
 */
function sources({ count, why }: { count: number; why: string }): UnreadSource[] {
  return Array.from({ length: count }, (_, at) => ({ source: `register ${String(at)}`, why }));
}

describe("fitUnread", () => {
  it("leaves a list inside the budget exactly as it was", () => {
    const unread = sources({ count: 3, why: "the verb exited 1" });
    expect(fitUnread({ unread })).toBe(unread);
  });

  it("shortens every reason, visibly, and still names every source when that is enough", () => {
    const unread = sources({ count: 16, why: "slow ".repeat(400) });
    const fitted = fitUnread({ unread });
    expect(weight({ unread: fitted })).toBeLessThanOrEqual(UNREAD_MAX_BYTES);
    expect(fitted.map(({ source }) => source)).toEqual(unread.map(({ source }) => source));
    expect(fitted.every(({ why }) => why.endsWith(" …"))).toBe(true);
  });

  it("names the leading sources and folds the rest into one entry saying they were not named", () => {
    const unread = sources({ count: 200, why: "slow ".repeat(40) });
    const fitted = fitUnread({ unread });
    expect(weight({ unread: fitted })).toBeLessThanOrEqual(UNREAD_MAX_BYTES);
    expect(fitted.at(0)!.source).toBe("register 0");
    expect(fitted.at(-1)).toEqual({ source: "further sources", why: "past the answer's size, so not named here" });
    expect(fitted.length).toBeLessThan(unread.length);
  });

  it("holds a single source carrying a huge reason to the budget", () => {
    const fitted = fitUnread({
      unread: [{ source: "the Queue on screen", why: "ask:acme-gone (check-in), ".repeat(5000) }],
    });
    expect(weight({ unread: fitted })).toBeLessThanOrEqual(UNREAD_MAX_BYTES);
    expect(fitted.map(({ source }) => source)).toEqual(["the Queue on screen"]);
  });
});

describe("unreadClause", () => {
  it("speaks a short list whole", () => {
    expect(
      unreadClause({
        unread: [
          { source: "the board", why: "still loading" },
          { source: "card deferrals", why: "the verb exited 1" },
        ],
      }),
    ).toBe("the board (still loading), card deferrals (the verb exited 1)");
  });

  it("holds a 30 KiB reason to the budget, still naming its source", () => {
    const clause = unreadClause({ unread: [{ source: "autonomy acts", why: "e".repeat(30 * 1024) }] });
    expect(clause.startsWith("autonomy acts (")).toBe(true);
    expect(Buffer.byteLength(clause)).toBeLessThanOrEqual(UNREAD_MAX_BYTES);
  });
});
