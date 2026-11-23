/*
 * The Linear-style properties an opened Queue card draws — status, priority, workstream, related, and the people a
 * message tags (no effort, no slug, a workstream by its name).
 * Driven from the published registers through the real readers and `rowsOf`, then the one join the card's tags came
 * through, so a property and a tag cannot disagree about which rows a card is.
 */

import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { type ParkedDraft, readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { cardProperties, cardWorkstreams, openedCardProperties } from "../../lib/cardProperties";
import { rowLabel } from "../../lib/cardPropertiesRelated";
import type { CardProperties } from "../../lib/cardPropertiesTypes";
import { type CardPeople, cardPeople } from "../../lib/personMentions";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import type { WorkstreamsView, WorkstreamView } from "../../lib/workstreamTiles";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-02T12:00:00.000Z",
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

/** One tag as the published row carries it. */
function tag({ key, value, source = "declared" }: { key: string; value: string; source?: string }): {
  key: string;
  value: string;
  source: string;
} {
  return { key, source, value };
}

/** One held Slack draft, parked on the owner's queue, naming a board row and tagging people when a case gives them. */
function parked({
  row,
  mentions = [],
}: {
  row: string | undefined;
  mentions?: readonly { key: string; kind: string; target: string }[];
}): unknown {
  return {
    draft: {
      advisory: [],
      authorId: "U0SYN000001",
      channel: "C0SYN000002",
      channelName: "dev-team",
      digest: "5acbeeefe63addb229c5ba34d65b8731",
      mentions,
      payload: { text: "heads-up" },
      shape: "top-level",
      tsIso: "2026-10-02T11:39:00.000Z",
      why: "a heads-up",
      ...(row === undefined ? {} : { row }),
    },
    id: "sd-a0615cb5",
    release: {
      command: "slopweaver slack post --as me --draft sd-a0615cb5 --approve 5acbeeefe63addb229c5ba34d65b8731",
      kind: "send",
    },
    state: "held",
  };
}

/** The workstreams register, with one outcome tile a card can name. */
const WORKSTREAMS: LiveState<WorkstreamsView> = ready({
  value: {
    channels: new Map(),
    grouping: null,
    initiatives: [],
    lanes: [],
    priorities: [],
    skipped: 0,
    workstreams: [
      {
        atRisk: false,
        id: "iso-certification",
        kind: "outcome",
        lane: "active",
        name: "ISO 27001 certification",
        progressLine: "2 of 5 done, next: Evidence collected",
        workspace: "team",
      } as unknown as WorkstreamView,
    ],
  },
});

/** The roster a card resolves people against: a colleague, and the owner. */
const PEOPLE = cardPeople({
  board: [],
  owner: "U0SYNADAOWN",
  roster: new Map([
    ["U0ARI", { firstNameUnique: true, handle: "ari", name: "Ari Shepard", nameUnique: true }],
    ["U0SYNADAOWN", { firstNameUnique: true, handle: "ada", name: "Ada Owner", nameUnique: true }],
  ]),
});

/** The Queue's cards for these asks and parked posts, each with its properties as the opened panel derives them. */
function opened({
  asks,
  posts = LOADING,
  people = PEOPLE,
}: {
  asks: readonly Record<string, unknown>[];
  posts?: LiveState<readonly ParkedDraft[]>;
  people?: CardPeople;
}): readonly { readonly card: QueueRow; readonly properties: CardProperties }[] {
  const board = ready({ value: readBoard({ rows: asks, unresolved: 0 })! });
  const drawn = rowsOf({
    acts: LOADING,
    board,
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts,
    reviewers: LOADING,
    standing: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  return drawn.map((card) => ({
    card,
    properties: openedCardProperties({ board, people, row: card, workstreams: WORKSTREAMS }),
  }));
}

describe("an opened card's properties", () => {
  it("gives an ask its own row's status, its chosen band, its workstream by name, and what it is related to", () => {
    const pullNumber = 1733;
    const pullUrl = `https://github.com/lachiejames/slopweaver/pull/${pullNumber}`;
    const [own] = opened({
      asks: [
        ask({
          over: {
            blockedBy: ["vanta-api-token"],
            priority: "p0",
            prUrls: [pullUrl],
            tags: [
              tag({ key: "workstream", value: "iso-certification" }),
              tag({ key: "effort", value: "m" }),
              tag({ key: "pr", value: `lachiejames/slopweaver#${pullNumber}` }),
              tag({ key: "priority", source: "derived", value: "p0" }),
            ],
          },
          slug: "iso-gap-register",
        }),
        ask({ over: { question: "Mint the Vanta API token?" }, slug: "vanta-api-token" }),
      ],
    });
    expect(own.properties).toEqual({
      board: undefined,
      caveats: [],
      priority: { band: "p0", source: "chosen", why: "stated on this row" },
      related: [
        { kind: "blocked-by", label: "Mint the Vanta API token?", slug: "vanta-api-token" },
        {
          href: pullUrl,
          kind: "pr",
          label: `lachiejames/slopweaver#${pullNumber}`,
        },
      ],
      status: { source: "row", value: "waiting" },
      tagged: undefined,
      thread: undefined,
      workstreams: [
        {
          href: "/workstreams?open=iso-certification",
          id: "iso-certification",
          kind: "read",
          name: "ISO 27001 certification",
          progress: "2 of 5 done, next: Evidence collected",
        },
      ],
    });
  });

  it("calls a backfilled band the kind's default, never a choice, and carries no workstream at all when none is tagged", () => {
    const [only] = opened({
      asks: [
        ask({
          over: {
            priority: "p1",
            priorityFrom: "default",
            tags: [tag({ key: "priority", source: "derived", value: "p1" })],
          },
          slug: "an-old-ask",
        }),
      ],
    });
    expect([only.properties.priority, only.properties.workstreams]).toEqual([
      { band: "p1", source: "default", why: "the ask default, on this row" },
      [],
    ]);
  });

  it("gives a parked post its record's state, and the band and relation of its board row, never by slug", () => {
    const posts = ready({ value: readParkedDrafts({ items: [parked({ row: "thread-chase-daily" })] })! });
    const post = opened({
      asks: [
        ask({ over: { tags: [tag({ key: "priority", source: "derived", value: "p2" })] }, slug: "thread-chase-daily" }),
      ],
      posts,
    }).find((each) => each.card.record.kind === "post")!;
    expect([post.properties.status, post.properties.priority, post.properties.related]).toEqual([
      { source: "record", value: "parked for your yes" },
      { band: "p2", source: "default", why: "the ask default, on a row this card belongs to" },
      [{ kind: "row", label: "OK to ship it?", slug: "thread-chase-daily", status: "waiting" }],
    ]);
  });

  it("gives a card on no board row its Queue tier's default band, said to be one", () => {
    const posts = ready({ value: readParkedDrafts({ items: [parked({ row: undefined })] })! });
    const post = opened({ asks: [], posts }).find((each) => each.card.record.kind === "post")!;
    expect([post.card.tier, post.properties.priority, post.properties.related]).toEqual([
      "team-blocked",
      { band: "p0", source: "default", why: "default for work a colleague waits on" },
      [],
    ]);
  });

  it("lists who a post tags, each once and never the owner, and an id the roster does not hold as unresolved", () => {
    const tagging = parked({
      mentions: [
        { key: "@ari", kind: "person", target: "U0ARI" },
        { key: "@ada", kind: "person", target: "U0SYNADAOWN" },
        { key: "@security", kind: "group", target: "S0SECURITY" },
        { key: "@ghost", kind: "person", target: "U0GHOST" },
      ],
      row: undefined,
    });
    const posts = ready({ value: readParkedDrafts({ items: [tagging] })! });
    const post = opened({ asks: [], posts }).find((each) => each.card.record.kind === "post")!;
    const tagged = post.properties.tagged!;
    expect(tagged.kind).toBe("listed");
    expect([
      (tagged as Extract<typeof tagged, { kind: "listed" }>).people.map((person) => person.id),
      (tagged as Extract<typeof tagged, { kind: "listed" }>).unresolved,
      post.properties.thread,
      post.properties.caveats,
    ]).toEqual([["U0ARI"], ["U0GHOST"], undefined, []]);
  });

  it("says who you are was not read when the people listed cannot have the owner left out", () => {
    const posts = ready({
      value: readParkedDrafts({
        items: [parked({ mentions: [{ key: "@ari", kind: "person", target: "U0ARI" }], row: undefined })],
      })!,
    });
    const anonymous = cardPeople({ board: [], owner: undefined, roster: new Map() });
    const post = opened({ asks: [], people: anonymous, posts }).find((each) => each.card.record.kind === "post")!;
    expect(post.properties.caveats).toEqual([
      "who you are was not read off any message sent as you, so you may be listed among the people",
    ]);
  });

  it("marks the board reading, or failed with its reason, rather than drawing a card on no row or saying so in words", () => {
    const posts = ready({ value: readParkedDrafts({ items: [parked({ row: "thread-chase-daily" })] })! });
    const post = opened({ asks: [], posts }).find((each) => each.card.record.kind === "post")!;
    const unread = ({
      boardRead,
      rows = { phase: "unread" },
    }: {
      boardRead: Parameters<typeof cardProperties>[0]["boardRead"];
      rows?: Parameters<typeof cardProperties>[0]["rows"];
    }): CardProperties =>
      cardProperties({
        board: [],
        boardRead,
        people: PEOPLE,
        record: post.card.record,
        rows,
        self: undefined,
        tags: post.card.tags,
        tier: post.card.tier,
        workstreams: WORKSTREAMS,
      });
    const reading = unread({ boardRead: { phase: "loading" } });
    const failed = unread({ boardRead: { phase: "not-measured", why: "handover list exited 1" } });
    const partial = unread({
      boardRead: { phase: "loading" },
      rows: { ambiguous: [], phase: "ready", rows: [], unread: ["docs/a.md", "b's tags"] },
    });
    const ambiguous = unread({
      boardRead: { phase: "loading" },
      rows: { ambiguous: ["twice"], phase: "ready", rows: [], unread: [] },
    });
    expect([
      reading.board,
      reading.caveats,
      failed.board,
      failed.caveats,
      partial.board,
      partial.caveats,
      ambiguous.board,
      ambiguous.caveats,
      post.properties.board,
    ]).toEqual([
      { kind: "reading" },
      [],
      { kind: "failed", why: "handover list exited 1" },
      [],
      { kind: "failed", why: "docs/a.md, b's tags did not read, so this card may belong to a row not shown" },
      [],
      undefined,
      ["twice names several board rows, so none of them is shown as this card's"],
      undefined,
    ]);
  });
});

describe("cardWorkstreams", () => {
  it("says the register is reading, failed with its reason, or holds no such workstream", () => {
    expect([
      ...cardWorkstreams({ ids: ["iso-certification"], register: LOADING }),
      ...cardWorkstreams({ ids: ["iso-certification"], register: { phase: "not-measured", why: "verb exited 1" } }),
      ...cardWorkstreams({ ids: ["nope"], register: WORKSTREAMS }),
    ]).toEqual([
      { href: "/workstreams?open=iso-certification", id: "iso-certification", kind: "loading" },
      { href: "/workstreams?open=iso-certification", id: "iso-certification", kind: "failed", why: "verb exited 1" },
      {
        href: "/workstreams?open=nope",
        id: "nope",
        kind: "unread",
        why: "the workstreams register holds no workstream by this name",
      },
    ]);
  });
});

describe("rowLabel", () => {
  it("reads a row by its question, else its summary's first sentence, else its reason, cut at a word", () => {
    expect([
      rowLabel({ row: { question: "Ship it?", reason: "r", summary: "S. More." } }),
      rowLabel({ row: { question: undefined, reason: "r", summary: "First sentence. Second." } }),
      rowLabel({ row: { question: undefined, reason: "waiting on the owner", summary: undefined } }),
      rowLabel({ row: { question: `${"word ".repeat(20)}end`, reason: "r", summary: undefined } }),
    ]).toEqual(["Ship it?", "First sentence.", "waiting on the owner", `${"word ".repeat(16).trimEnd()}…`]);
  });
});
