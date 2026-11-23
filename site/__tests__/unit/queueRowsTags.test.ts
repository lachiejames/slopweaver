/*
 * The tags a Queue card carries, from the published registers through `rowsOf`: an ask inherits its own board row's
 * tags, a parked post states its platform, and a card whose row publishes no tags field reads `absent` rather than
 * untagged — so a "none" filter never claims it. Driven through the real readers.
 */

import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { type ParkedDraft, readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { partialTagsSplit } from "../../lib/queueCardTags";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { matchesTags, parseTagParams } from "../../lib/queueTags";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-27T14:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** An ask as `handover list --json` prints it, waiting on the owner, with whatever a case overrides. */
function ask({ slug, over = {} }: { slug: string; over?: Record<string, unknown> }): Record<string, unknown> {
  return {
    kind: "ask",
    ownerWait: "owner",
    prUrls: [],
    question: "OK to ship it?",
    reason: "waiting on the owner",
    section: "WAITING ON YOU",
    slug,
    status: "waiting",
    tags: [],
    ...over,
  };
}

/** One declared tag as the published row carries it. */
function tag({ key, value }: { key: string; value: string }): { key: string; value: string; source: string } {
  return { key, source: "declared", value };
}

/** One held Slack draft, parked on the owner's queue. */
const PARKED = {
  draft: {
    advisory: [],
    authorId: "U0SYN000001",
    channel: "C0SYN000002",
    channelName: "dev-team",
    digest: "5acbeeefe63addb229c5ba34d65b8731",
    mentions: [],
    payload: { text: "heads-up" },
    shape: "top-level",
    tsIso: "2026-09-27T13:39:00.000Z",
    why: "a heads-up",
  },
  id: "sd-a0615cb5",
  release: {
    command: "slopweaver slack post --as me --draft sd-a0615cb5 --approve 5acbeeefe63addb229c5ba34d65b8731",
    kind: "send",
  },
  state: "held",
};

/** The Queue's cards for these asks and parked posts. */
function cards({
  asks,
  posts = LOADING,
}: {
  asks: readonly Record<string, unknown>[];
  posts?: LiveState<readonly ParkedDraft[]>;
}): readonly QueueRow[] {
  return rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: ready({ value: readBoard({ rows: asks, unresolved: 0 })! }),
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts,
    reviews: LOADING,
    imports: LOADING,
  });
}

describe("a Queue card's tags", () => {
  it("gives an ask its own board row's tags, whole", () => {
    const [card] = cards({
      asks: [
        ask({
          over: { tags: [tag({ key: "workstream", value: "iso" }), tag({ key: "area", value: "vanta" })] },
          slug: "iso-ask",
        }),
      ],
    });
    expect({ key: card.key, tags: card.tags, tagsRead: card.tagsRead }).toEqual({
      key: "ask:iso-ask",
      tags: [
        { key: "workstream", value: "iso" },
        { key: "area", value: "vanta" },
      ],
      tagsRead: "whole",
    });
  });

  it("reads an ask whose row publishes no tags field as absent, which no 'none' filter claims", () => {
    const [card] = cards({ asks: [ask({ over: { tags: undefined }, slug: "old-ask" })] });
    expect(card.tagsRead).toBe("absent");
    expect(matchesTags({ card, selection: parseTagParams({ values: ["!workstream"] }) })).toBe(false);
  });

  it("reads a row that says its tags are incomplete as partial, which no 'none' filter claims", () => {
    const [card] = cards({
      asks: [ask({ over: { tags: [tag({ key: "area", value: "vanta" })], tagsIncomplete: true }, slug: "torn" })],
    });
    expect({ tags: card.tags, tagsRead: card.tagsRead }).toEqual({
      tags: [{ key: "area", value: "vanta" }],
      tagsRead: "partial",
    });
    expect(matchesTags({ card, selection: parseTagParams({ values: ["!workstream"] }) })).toBe(false);
  });

  it("reads a row that says its tags are incomplete and publishes none as partial, not absent", () => {
    const [card] = cards({ asks: [ask({ over: { tags: undefined, tagsIncomplete: true }, slug: "torn-bare" })] });
    expect(card.tagsRead).toBe("partial");
  });

  it("filters the cards to one workstream by the address's selector", () => {
    const drawn = cards({
      asks: [
        ask({ over: { tags: [tag({ key: "workstream", value: "iso" })] }, slug: "a" }),
        ask({ over: { tags: [tag({ key: "workstream", value: "console" })] }, slug: "b" }),
        ask({ slug: "c" }),
      ],
    });
    const selection = parseTagParams({ values: ["workstream:iso"] });
    expect(drawn.filter((card) => matchesTags({ card, selection })).map((card) => card.key)).toEqual(["ask:a"]);
  });

  it("states a parked post's platform itself, whole whatever the board says", () => {
    const posts = ready({ value: readParkedDrafts({ items: [PARKED] })! });
    const post = cards({ asks: [], posts }).find((card) => card.record.kind === "post")!;
    expect({ tags: post.tags, tagsRead: post.tagsRead }).toEqual({
      tags: [{ key: "platform", value: "slack" }],
      tagsRead: "whole",
    });
  });

  it("gives a parked post the tags of the board row its --row named, so a bump shows its workstream", () => {
    const named = { ...PARKED, draft: { ...PARKED.draft, row: "thread-chase-daily" } };
    const posts = ready({ value: readParkedDrafts({ items: [named] })! });
    const drawn = cards({
      asks: [
        ask({
          over: { tags: [tag({ key: "workstream", value: "slack-chase" }), tag({ key: "priority", value: "p2" })] },
          slug: "thread-chase-daily",
        }),
      ],
      posts,
    });
    const post = drawn.find((card) => card.record.kind === "post")!;
    expect({ tags: post.tags, tagsRead: post.tagsRead }).toEqual({
      tags: [
        { key: "platform", value: "slack" },
        { key: "workstream", value: "slack-chase" },
        { key: "priority", value: "p2" },
      ],
      tagsRead: "whole",
    });
    expect(matchesTags({ card: post, selection: parseTagParams({ values: ["workstream:slack-chase"] }) })).toBe(true);
  });

  it("splits part-read cards by why: a slug several rows carry is the data, a row whose tags did not read is a failed read", () => {
    const named = { ...PARKED, draft: { ...PARKED.draft, row: "dup" } };
    const posts = ready({ value: readParkedDrafts({ items: [named] })! });
    const asks = [
      ask({ over: { tags: [tag({ key: "workstream", value: "iso" })] }, slug: "dup" }),
      ask({ over: { tags: [tag({ key: "workstream", value: "console" })] }, slug: "dup" }),
      ask({ over: { tags: [tag({ key: "area", value: "vanta" })], tagsIncomplete: true }, slug: "torn" }),
    ];
    const drawn = cards({ asks, posts });
    const board = ready({ value: readBoard({ rows: asks, unresolved: 0 })! });

    expect(drawn.find((card) => card.record.kind === "post")!.tagsRead).toBe("partial");
    expect(partialTagsSplit({ board, rows: drawn })).toEqual({ ambiguous: 1, failed: 1 });
    expect(partialTagsSplit({ board: LOADING, rows: drawn })).toEqual({ ambiguous: 0, failed: 0 });
  });

  it("reads a --row this build cannot read as no row, rather than dropping the draft", () => {
    const odd = { ...PARKED, draft: { ...PARKED.draft, row: 7 } };
    const [draft] = readParkedDrafts({ items: [odd] })!;
    expect([draft.id, draft.row]).toEqual(["sd-a0615cb5", undefined]);
  });
});
