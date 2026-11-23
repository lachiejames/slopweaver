/*
 * `action_items` inside the page's tool cap by construction — when 18 queue items cross it, the whole answer is
 * swapped for a notice, and the voice can open nothing the owner names.
 */
import { describe, expect, it } from "vitest";

import { type Board, readBoard } from "../../components/live/read";
import { TOOL_OUTPUT_MAX } from "../../components/live/talkSession";
import type { LiveState } from "../../components/live/useLive";
import {
  ACTION_ITEMS_MAX_BYTES,
  type FittableAnswer,
  fitActionItems,
  fitJsonString,
  ITEM_FIELD_MAX_BYTES,
} from "../../lib/actionItemsFit";
import { queueScopeOf, queueShownCounts } from "../../lib/queueShownCounts";
import { NO_STEERS } from "../../lib/steeredCards";
import { actionItemsAnswer, type SpokenLeft } from "../../lib/talkActionItems";
import type { SpokenItem } from "../../lib/talkActionItemsSpoken";
import { ACME_PLACER } from "../organisationFixture";

/** UTF-8 bytes of a value's serialisation. */
function bytesOf({ value }: { value: unknown }): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** A string whose escaped form outweighs its length: quotes, a control character, non-ASCII and an emoji. */
const HOSTILE = 'they said "send it" \u0001 — café 👩🏽‍💻 ';

/** A field long and hostile enough to be shortened. */
function longText({ seed }: { seed: string }): string {
  return `${seed} ${HOSTILE.repeat(60)}`;
}

/** One flattened card, its lean long so detail weighs something. */
function item({ key, mark }: { key: string; mark: string | undefined }): SpokenItem {
  return {
    ifSilent: undefined,
    key,
    kind: "ask",
    lean: "l".repeat(300),
    parked: undefined,
    pill: "ask",
    problem: undefined,
    question: `Which way on ${key}?`,
    refused: undefined,
    subject: key,
    tier: "fleet-blocked",
    tierWords: "blocking the fleet",
    unblocks: undefined,
    whenIso: undefined,
    whyYou: undefined,
    workspaceMark: mark,
  };
}

/** One departed card. */
function departed({ key }: { key: string }): SpokenLeft {
  return { ...item({ key, mark: undefined }), removed: { atIso: "2026-10-08T04:00:00.000Z", why: "Settled answered" } };
}

/** Three queue cards, the middle one the top blocker and the last one marked, and two departed cards. */
function plate(): FittableAnswer {
  const items = [
    item({ key: "ask:a", mark: undefined }),
    item({ key: "ask:top", mark: undefined }),
    item({ key: "ask:c", mark: "no workspace — shown in both" }),
  ];
  return {
    beyondCap: { marked: false, more: true, parked: false },
    cut: undefined,
    items,
    recentlyLeft: [departed({ key: "ask:d1" }), departed({ key: "ask:d2" })],
    recentlyLeftBeyondCap: 0,
    top: { key: "ask:top", subject: "ask:top" },
  };
}

describe("fitJsonString", () => {
  it("leaves a string that fits untouched", () => {
    expect(fitJsonString({ maxBytes: 600, text: "short" })).toEqual({ cut: false, text: "short" });
  });

  it("cuts on the ESCAPED size, so quotes and control characters cannot carry a field past its budget", () => {
    const fitted = fitJsonString({ maxBytes: ITEM_FIELD_MAX_BYTES, text: longText({ seed: "problem" }) });
    expect(fitted.cut).toBe(true);
    expect(fitted.text.endsWith(" …")).toBe(true);
    expect(bytesOf({ value: fitted.text }) - 2).toBeLessThanOrEqual(ITEM_FIELD_MAX_BYTES);
    expect(fitted.text.length).toBeLessThan(ITEM_FIELD_MAX_BYTES);
  });

  it("never splits an emoji's grapheme", () => {
    const fitted = fitJsonString({ maxBytes: 30, text: "👩🏽‍💻".repeat(10) });
    expect(fitted.text).toBe("👩🏽‍💻 …");
  });
});

describe("fitActionItems", () => {
  it("returns an answer inside the budget whole, with no cut line", () => {
    const answer = plate();
    expect(fitActionItems({ answer, maxBytes: ACTION_ITEMS_MAX_BYTES, shortened: 0 })).toEqual(answer);
  });

  it("says a shortened field even when nothing is shed", () => {
    expect(fitActionItems({ answer: plate(), maxBytes: ACTION_ITEMS_MAX_BYTES, shortened: 2 }).cut).toBe(
      'action_items carries 20480 bytes: 2 long field(s) end in "…"',
    );
  });

  it("sheds the departed cards first, then the queue's tail, and keeps the top blocker over a card ranked above it", () => {
    const answer = plate();
    const expected: FittableAnswer = {
      ...answer,
      beyondCap: { marked: true, more: true, parked: false },
      cut:
        'action_items carries BUDGET bytes: 0 long field(s) end in "…", and some queue cards and departed cards ' +
        "are listed by key and subject only",
      items: [answer.items[1]],
      recentlyLeft: [],
      recentlyLeftBeyondCap: 2,
    };
    // The budget is exactly what that answer weighs, so one byte less would shed the top blocker too.
    const maxBytes = bytesOf({ value: expected }) - "BUDGET".length + String(bytesOf({ value: expected })).length;
    const fitted = fitActionItems({ answer, maxBytes, shortened: 0 });
    expect(fitted).toEqual({ ...expected, cut: expected.cut!.replace("BUDGET", String(maxBytes)) });
    expect(bytesOf({ value: fitted })).toBe(maxBytes);
  });

  it("sheds the top blocker's detail last, when nothing else is left to shed", () => {
    const fitted = fitActionItems({ answer: plate(), maxBytes: 1, shortened: 0 });
    expect(fitted.items).toEqual([]);
    expect(fitted.recentlyLeft).toEqual([]);
    expect(fitted.beyondCap).toEqual({ marked: true, more: true, parked: false });
    expect(fitted.recentlyLeftBeyondCap).toBe(2);
    expect(fitted.top).toEqual({ key: "ask:top", subject: "ask:top" });
  });
});

describe("actionItemsAnswer — inside the page's tool cap however heavy the owner's Queue", () => {
  const AT = "2026-10-08T04:30:00.000Z";

  /** One ask waiting on the owner, every free-text field long and hostile. */
  const heavyAsk = ({ slug }: { slug: string }): Record<string, unknown> => ({
    kind: "ask",
    lean: longText({ seed: `lean ${slug}` }),
    ownerWait: "owner",
    problem: longText({ seed: `problem ${slug}` }),
    question: `Which way on ${slug}, ${HOSTILE.repeat(60)}?`,
    questionAskedIso: "2026-10-08T01:00:00.000Z",
    reason: "waiting on the owner",
    section: "runnable",
    slug,
    status: "waiting-on-owner",
    workspace: "self",
  });

  /** One ask that was the owner's and settled inside the last day, its witness long and hostile. */
  const heavySettled = ({ slug, minute }: { slug: string; minute: number }): Record<string, unknown> => ({
    ...heavyAsk({ slug }),
    ownerWait: "not-waiting",
    question: undefined,
    settledIso: `2026-10-08T04:${String(minute).padStart(2, "0")}:00.000Z`,
    settlement: "answered",
    settlementWitness: longText({ seed: `witness ${slug}` }),
    summary: `Settle ${slug}?`,
  });

  /**
   * 26 asks waiting and 12 settled — one past each cap — on an otherwise empty, fully read Queue.
   *
   * @param slugLength the length each slug is padded out to with dashes, so a key can be filled to `CARD_KEY`'s
   *   160-character brim
   */
  function heavyQueue({ slugLength = 0 }: { slugLength?: number } = {}): Parameters<typeof actionItemsAnswer>[0] {
    const waiting = Array.from({ length: 26 }, (_, n) =>
      heavyAsk({ slug: `heavy-${String(n).padStart(2, "0")}`.padEnd(slugLength, "-") }),
    );
    const settled = Array.from({ length: 12 }, (_, n) =>
      heavySettled({ minute: 10 + n, slug: `gone-${String(n).padStart(2, "0")}`.padEnd(slugLength, "-") }),
    );
    const ready = <T>({ value }: { value: T }): LiveState<T> => ({
      fixture: undefined,
      observedAtIso: AT,
      phase: "ready",
      stampedByRoute: false,
      value,
    });
    return {
      acts: ready({ value: [] }),
      board: ready<Board>({ value: readBoard({ rows: [...waiting, ...settled], unresolved: 0 })! }),
      context: "everything",
      drafts: ready({ value: [] }),
      hands: ready({ value: [] }),
      landing: ready({
        value: {
          by: "a tick",
          landing: {
            advisoryRedBypassed: undefined,
            byAction: [],
            census: undefined,
            people: new Map(),
            ready: 0,
            residue: [],
            rows: [],
            selection: undefined,
            total: 0,
          },
          observedAtIso: AT,
          readingId: "r1",
          recordedAtIso: AT,
        },
      }),
      nowIso: "2026-10-08T05:00:00.000Z",
      placer: ACME_PLACER,
      posts: ready({ value: [] }),
      reviewers: { phase: "loading" },
      standing: { phase: "loading" },
      reviews: ready({ value: [] }),
      imports: ready({ value: { questions: [] } }),
      shown: queueShownCounts({
        allDrawn: true,
        badgeRead: true,
        boardRead: true,
        context: "work",
        otherRows: [],
        rows: [],
        scope: queueScopeOf({ pathname: "/queue", search: "" }),
        splitRead: true,
      }),
      shows: () => true,
      spoken: ready({ value: { landings: [], moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] } }),
      currency: { phase: "loading" },
      steers: NO_STEERS,
      workstreams: { phase: "loading" },
      deferrals: { phase: "loading" },
    };
  }

  it("weighs no more than its budget, which sits inside the page's byte cap", () => {
    const answer = actionItemsAnswer(heavyQueue());
    expect(bytesOf({ value: answer })).toBeLessThanOrEqual(ACTION_ITEMS_MAX_BYTES);
    expect(bytesOf({ value: answer })).toBeLessThanOrEqual(TOOL_OUTPUT_MAX);
  });

  // Keys are never cut, so the bound rests on CARD_KEY's 160 characters — filled to the brim here.
  it("stays inside its budget with every key at CARD_KEY's longest", () => {
    const answer = actionItemsAnswer(heavyQueue({ slugLength: 160 }));
    expect(answer.itemNames.map((name) => name.key.length)).toEqual(Array.from({ length: 25 }, () => 4 + 160));
    expect(answer.recentlyLeftNames.map((name) => name.key.length)).toEqual(Array.from({ length: 10 }, () => 4 + 160));
    expect(bytesOf({ value: answer })).toBeLessThanOrEqual(ACTION_ITEMS_MAX_BYTES);
  });

  it("still names every card inside the caps by key and subject, so the one the owner names can be opened", () => {
    const answer = actionItemsAnswer(heavyQueue());
    expect(answer.itemNames.map((name) => name.key)).toEqual(
      Array.from({ length: 25 }, (_, n) => `ask:heavy-${String(n).padStart(2, "0")}`),
    );
    expect(answer.recentlyLeftNames.map((name) => name.key)).toEqual(
      Array.from({ length: 10 }, (_, n) => `ask:gone-${String(11 - n).padStart(2, "0")}`),
    );
    expect(answer.top).toEqual({ key: "ask:heavy-00", subject: "heavy-00" });
  });

  it("keeps the top of the ranking in full and says which cards it shed, never how many queue cards", () => {
    const answer = actionItemsAnswer(heavyQueue());
    const kept = answer.items.length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(25);
    expect(answer.items.map((one) => one.key)).toEqual(answer.itemNames.slice(0, kept).map((name) => name.key));
    expect(answer.recentlyLeft).toEqual([]);
    expect(answer.beyondCap).toEqual({ marked: false, more: true, parked: false });
    expect(answer.recentlyLeftBeyondCap).toBe(2 + 10);
    expect(answer.cut).toContain(", and some queue cards and departed cards are listed by key");
  });

  it("shortens each long field it keeps, visibly", () => {
    const lead = actionItemsAnswer(heavyQueue()).items[0];
    expect(lead.problem!.endsWith(" …")).toBe(true);
    expect(lead.lean!.endsWith(" …")).toBe(true);
    expect(bytesOf({ value: lead.problem }) - 2).toBeLessThanOrEqual(ITEM_FIELD_MAX_BYTES);
  });
});
