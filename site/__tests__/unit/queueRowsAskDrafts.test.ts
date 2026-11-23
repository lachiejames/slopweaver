/*
 * An ask that names a parked Slack draft by id carries that draft on its own card.
 *
 * A queue card asking the owner to react to a Slack draft must show that draft on the card, always. A card whose
 * question named `draft sd-a0615cb5` in prose drew only a draft offered as an ACTION. The fixture below is that
 * row's question, driven through the real readers.
 */

import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { type ParkedDraft, readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-26T07:40:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** The ask as `handover list --json` would print it: waiting on the owner, its draft named in the question alone. */
const ASK = {
  kind: "ask",
  lean: "send it as drafted, it says what the owner said on the call",
  options: [
    {
      letter: "A",
      option: "send the post as drafted and ready the pull request",
      tradeoff: "three advisory lanes per PR",
    },
    { letter: "B", option: "edit the wording first", tradeoff: "the draft is re-recorded" },
  ],
  ownerWait: "owner",
  prUrls: [],
  problem: "Local E2Es are green, and the pull request is held as a draft until the #dev-team heads-up is OK'd",
  question: "OK to send the #dev-team heads-up (draft sd-a0615cb5) and ready the pull request?",
  reason: "waiting on the owner",
  section: "WAITING ON YOU",
  slug: "local-e2es-become-a-required-pr-check-on",
  status: "waiting",
};

/** One parked draft, in whichever state the case needs. */
function parkedItem({ id, state }: { id: string; state: string }): unknown {
  return {
    draft: {
      advisory: [],
      authorId: "U0SYN000001",
      channel: "C0SYN000002",
      channelName: "dev-team",
      digest: "5acbeeefe63addb229c5ba34d65b8731",
      mentions: [],
      payload: { text: "heads-up: local E2Es now run on every PR, advisory for now" },
      shape: "top-level",
      tsIso: "2026-09-26T03:39:00.000Z",
      why: "local E2Es heads-up",
    },
    id,
    ...(state === "held"
      ? { release: { command: `slopweaver slack post --as me --draft ${id} --approve 5acbeeef`, kind: "send" } }
      : { resolvedIso: "2026-09-26T04:00:00.000Z" }),
    state,
  };
}

function askRowFor({
  asks = [ASK],
  posts,
  postsWhy,
  slug = ASK.slug,
}: {
  asks?: readonly unknown[];
  posts: unknown;
  postsWhy?: string;
  slug?: string;
}): QueueRow {
  let register: LiveState<readonly ParkedDraft[]> = LOADING;
  if (postsWhy !== undefined) {
    register = { phase: "not-measured", why: postsWhy };
  }
  if (posts !== undefined) {
    register = ready({ value: readParkedDrafts(posts)! });
  }
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: ready({ value: readBoard({ rows: asks, unresolved: 0 })! }),
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: register,
    reviews: LOADING,
    imports: LOADING,
  });
  return rows.find((row) => row.key === `ask:${slug}`)!;
}

type AskRecord = Extract<QueueRow["record"], { kind: "ask" }>;

/** The ask row's own record, asserted to be one first so the narrowing is a checked fact rather than a cast. */
function askRecordOf({ row }: { row: QueueRow }): AskRecord {
  expect(row.record.kind).toBe("ask");
  return row.record as AskRecord;
}

describe("an ask naming a parked draft carries it on its card", () => {
  it("resolves the draft its question names to the held draft itself", () => {
    const posts = { items: [parkedItem({ id: "sd-a0615cb5", state: "held" })], people: [] };
    const { drafts } = askRecordOf({ row: askRowFor({ posts }) });
    expect(drafts.map((named) => [named.kind, named.id])).toEqual([["held", "sd-a0615cb5"]]);
    const held = drafts[0] as Extract<(typeof drafts)[number], { kind: "held" }>;
    expect(held.draft.channelName).toBe("dev-team");
  });

  it("names a draft that has already gone out as spent, never drops it", () => {
    const posts = { items: [parkedItem({ id: "sd-a0615cb5", state: "released" })], people: [] };
    const { drafts } = askRecordOf({ row: askRowFor({ posts }) });
    expect(drafts.map((named) => [named.kind, named.id])).toEqual([["spent", "sd-a0615cb5"]]);
  });

  it("names a draft the register does not hold as absent", () => {
    const posts = { items: [parkedItem({ id: "sd-00000001", state: "held" })], people: [] };
    const { drafts } = askRecordOf({ row: askRowFor({ posts }) });
    expect(drafts).toEqual([{ id: "sd-a0615cb5", kind: "absent" }]);
  });

  it("says the register is unread while it has not been read", () => {
    const { drafts } = askRecordOf({ row: askRowFor({ posts: undefined }) });
    expect(drafts).toEqual([{ id: "sd-a0615cb5", kind: "unread" }]);
  });

  it("says the register could not be read, with why, when it failed rather than loads", () => {
    const { drafts } = askRecordOf({ row: askRowFor({ posts: undefined, postsWhy: "slack draft list exited 1" }) });
    expect(drafts).toEqual([{ id: "sd-a0615cb5", kind: "not-measured", why: "slack draft list exited 1" }]);
  });

  it("finds an id in an option and in the lean, each once, in the order the card draws them", () => {
    const ask = {
      ...ASK,
      lean: "send sd-39f8a0e2 first",
      options: [{ letter: "A", option: "post sd-39f8a0e2 then sd-a0615cb5", tradeoff: "two posts" }],
    };
    const { drafts } = askRecordOf({ row: askRowFor({ asks: [ask], posts: { items: [], people: [] } }) });
    expect(drafts.map((named) => named.id)).toEqual(["sd-a0615cb5", "sd-39f8a0e2"]);
  });

  it("resolves a draft id the row's own slug is, since the card draws the slug as its subject", () => {
    const ask = { ...ASK, question: "OK to ready the pull request?", slug: "sd-deadbeef" };
    const { drafts } = askRecordOf({
      row: askRowFor({ asks: [ask], posts: { items: [], people: [] }, slug: "sd-deadbeef" }),
    });
    expect(drafts).toEqual([{ id: "sd-deadbeef", kind: "absent" }]);
  });

  it("resolves an id the offered Slack action's body quotes, since the card draws that body", () => {
    const ask = {
      ...ASK,
      action: {
        actor: "me",
        body: "heads-up, as in sd-deadbeef",
        destinations: [{ channel: "C01SDLC", kind: "channel", label: "Post it to #delivery", tradeoff: "loud" }],
        mentions: [],
        version: 1,
      },
      question: "OK to ready the pull request?",
    };
    const { drafts } = askRecordOf({ row: askRowFor({ asks: [ask], posts: { items: [], people: [] } }) });
    expect(drafts).toEqual([{ id: "sd-deadbeef", kind: "absent" }]);
  });

  it("resolves an id an offered mail's subject quotes, since the card draws the mail", () => {
    const ask = {
      ...ASK,
      action: {
        actor: "me",
        form: { bcc: [], body: "Body", cc: [], subject: "Review sd-deadbeef", to: ["a@b.c"] },
        from: "me@b.c",
        kind: "mail",
        version: 2,
      },
      mailPreview: { digest: "d1", url: "/queue/mail/x/d1" },
      question: "OK to ready the pull request?",
    };
    const { drafts } = askRecordOf({ row: askRowFor({ asks: [ask], posts: { items: [], people: [] } }) });
    expect(drafts).toEqual([{ id: "sd-deadbeef", kind: "absent" }]);
  });

  it("carries no drafts on an ask that names none", () => {
    const ask = { ...ASK, question: "OK to ready the pull request?" };
    const { drafts } = askRecordOf({ row: askRowFor({ asks: [ask], posts: { items: [], people: [] } }) });
    expect(drafts).toEqual([]);
  });
});
