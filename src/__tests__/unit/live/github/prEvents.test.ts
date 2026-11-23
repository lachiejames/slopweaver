import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import {
  diffPrEvents,
  type GithubPrActivity,
  isIsoZInstant,
  makeFetchGithubPrActivity,
  type PrEventCursor,
  parsePrActivity,
} from "../../../../live/github/prEvents.js";

const HEAD = "abcdef1234567890";
const OLD_HEAD = "0123456789abcdef";

function activity({
  reviews = [],
  comments = [],
  state = "OPEN",
  headSha = HEAD,
  mergedAt,
}: Partial<GithubPrActivity> = {}): GithubPrActivity {
  return { comments, headSha, mergedAt, reviews, state, viewer: "me" };
}

function cursor({ since = "2026-09-03T00:00:00Z" }: { since?: string } = {}): PrEventCursor {
  return { seenCommentIds: new Set(), seenReviewIds: new Set(), since };
}

const BOT_REVIEW = {
  author: "reviewbot",
  commitSha: HEAD,
  id: "r1",
  state: "CHANGES_REQUESTED",
  submittedAt: "2026-09-03T00:05:00Z",
};

describe("isIsoZInstant", () => {
  it("accepts only a UTC instant ending in Z", () => {
    expect(isIsoZInstant({ value: "2026-09-03T00:00:00Z" })).toBe(true);
    expect(isIsoZInstant({ value: "2026-09-03T00:00:00.123Z" })).toBe(true);
    expect(isIsoZInstant({ value: "2026-09-03T10:00:00+10:00" })).toBe(false);
    expect(isIsoZInstant({ value: "2026-09-03" })).toBe(false);
    expect(isIsoZInstant({ value: "now" })).toBe(false);
  });
});

describe("parsePrActivity", () => {
  const RAW = {
    repository: {
      pullRequest: {
        comments: {
          nodes: [
            {
              author: { __typename: "User", login: "alice" },
              body: "looks   fine\nto me",
              createdAt: "2026-09-03T00:06:00Z",
              id: "c1",
            },
            {
              author: { __typename: "Bot", login: "reviewapp" },
              body: "summary",
              createdAt: "2026-09-03T00:06:10Z",
              id: "c9",
            },
            { author: null, body: "ghost", createdAt: "2026-09-03T00:07:00Z", id: "c2" },
          ],
        },
        headRefOid: HEAD,
        mergedAt: null,
        reviews: {
          nodes: [
            {
              author: { login: "reviewbot" },
              commit: { oid: HEAD },
              id: "r1",
              state: "CHANGES_REQUESTED",
              submittedAt: "2026-09-03T00:05:00Z",
            },
            {
              author: { login: "nocommit" },
              commit: null,
              id: "r2",
              state: "APPROVED",
              submittedAt: "2026-09-03T00:05:30Z",
            },
          ],
        },
        state: "OPEN",
      },
    },
    viewer: { login: "me" },
  };

  it("shapes reviews and comments, dropping any node missing a field it needs", () => {
    expect(unwrap(parsePrActivity({ data: RAW, identity: "o/r#1" }))).toEqual({
      comments: [
        { author: "alice", body: "looks   fine\nto me", bot: false, createdAt: "2026-09-03T00:06:00Z", id: "c1" },
        { author: "reviewapp", body: "summary", bot: true, createdAt: "2026-09-03T00:06:10Z", id: "c9" },
      ],
      headSha: HEAD,
      mergedAt: undefined,
      reviews: [BOT_REVIEW],
      state: "OPEN",
      viewer: "me",
    });
  });

  it("refuses when GitHub reports no such pull request", () => {
    expect(unwrapErr(parsePrActivity({ data: { repository: { pullRequest: null } }, identity: "o/r#1" })).code).toBe(
      "NOT_FOUND",
    );
  });

  it("refuses a response with no viewer, head or a state it does not know", () => {
    const noViewer = { repository: RAW.repository };
    expect(unwrapErr(parsePrActivity({ data: noViewer, identity: "o/r#1" })).code).toBe("READ_FAILED");
    const oddState = { ...RAW, repository: { pullRequest: { ...RAW.repository.pullRequest, state: "DRAFTY" } } };
    expect(unwrapErr(parsePrActivity({ data: oddState, identity: "o/r#1" })).code).toBe("READ_FAILED");
  });
});

describe("makeFetchGithubPrActivity", () => {
  it("sends the exact query variables and parses a successful response", async () => {
    const seen: Record<string, unknown>[] = [];
    const fetch = makeFetchGithubPrActivity({
      graphql: ({ variables }) => {
        seen.push({ ...variables });
        return Promise.resolve(
          ok({
            repository: { pullRequest: { headRefOid: HEAD, mergedAt: null, state: "OPEN" } },
            viewer: { login: "me" },
          }),
        );
      },
    });
    const result = await fetch({ number: 7, owner: "o", repo: "r" });
    expect(seen).toEqual([{ number: 7, owner: "o", repo: "r", window: 30 }]);
    expect(unwrap(result).headSha).toBe(HEAD);
  });

  it("propagates a transport failure without parsing", async () => {
    const fetch = makeFetchGithubPrActivity({
      graphql: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "boom" }))),
    });
    expect(unwrapErr(await fetch({ number: 7, owner: "o", repo: "r" })).message).toBe("boom");
  });
});

describe("diffPrEvents", () => {
  it("reports nothing on a quiet poll, and carries the cursor forward unchanged", () => {
    const diff = diffPrEvents({ activity: activity(), cursor: cursor(), previousHead: HEAD });
    expect(diff.lines).toEqual([]);
    expect(diff.reviewed).toBe(false);
    expect(diff.commented).toBe(false);
    expect(diff.terminal).toBe(undefined);
    expect(diff.cursor.since).toBe("2026-09-03T00:00:00Z");
  });

  it("reports a new review on the current head after the cursor, once", () => {
    const first = diffPrEvents({ activity: activity({ reviews: [BOT_REVIEW] }), cursor: cursor(), previousHead: HEAD });
    expect(first.lines).toEqual([`REVIEW reviewbot CHANGES_REQUESTED on abcdef12 at 2026-09-03T00:05:00Z`]);
    expect(first.reviewed).toBe(true);
    const second = diffPrEvents({
      activity: activity({ reviews: [BOT_REVIEW] }),
      cursor: first.cursor,
      previousHead: HEAD,
    });
    expect(second.lines).toEqual([]);
    expect(second.reviewed).toBe(false);
  });

  it("ignores a review on an old head, before the cursor, or by the viewer", () => {
    const stale = { ...BOT_REVIEW, commitSha: OLD_HEAD, id: "r-old" };
    const early = { ...BOT_REVIEW, id: "r-early", submittedAt: "2026-09-02T23:59:59Z" };
    const mine = { ...BOT_REVIEW, author: "me", id: "r-mine" };
    const diff = diffPrEvents({
      activity: activity({ reviews: [stale, early, mine] }),
      cursor: cursor(),
      previousHead: HEAD,
    });
    expect(diff.lines).toEqual([]);
    expect(diff.reviewed).toBe(false);
  });

  it("reports a human comment after the cursor, squashed to one line, and never a bot's or the viewer's", () => {
    const comments = [
      { author: "alice", body: "  two\n\nlines   here ", bot: false, createdAt: "2026-09-03T00:06:00Z", id: "c1" },
      { author: "helper[bot]", body: "beep", bot: true, createdAt: "2026-09-03T00:06:30Z", id: "c2" },
      { author: "me", body: "@bot review", bot: false, createdAt: "2026-09-03T00:07:00Z", id: "c3" },
      { author: "reviewapp", body: "an app with a bare login", bot: true, createdAt: "2026-09-03T00:07:30Z", id: "c4" },
    ];
    const diff = diffPrEvents({ activity: activity({ comments }), cursor: cursor(), previousHead: HEAD });
    expect(diff.lines).toEqual(["COMMENT alice at 2026-09-03T00:06:00Z: two lines here"]);
    expect(diff.commented).toBe(true);
    expect([...diff.cursor.seenCommentIds]).toEqual(["c1"]);
  });

  it("orders several new events oldest first, reviews before comments", () => {
    const later = { ...BOT_REVIEW, id: "r2", state: "APPROVED", submittedAt: "2026-09-03T00:09:00Z" };
    const comments = [{ author: "alice", body: "hi", bot: false, createdAt: "2026-09-03T00:06:00Z", id: "c1" }];
    const diff = diffPrEvents({
      activity: activity({ comments, reviews: [later, BOT_REVIEW] }),
      cursor: cursor(),
      previousHead: HEAD,
    });
    expect(diff.lines).toEqual([
      "REVIEW reviewbot CHANGES_REQUESTED on abcdef12 at 2026-09-03T00:05:00Z",
      "REVIEW reviewbot APPROVED on abcdef12 at 2026-09-03T00:09:00Z",
      "COMMENT alice at 2026-09-03T00:06:00Z: hi",
    ]);
  });

  it("announces a head change, and stays silent about the head on the baseline poll", () => {
    expect(diffPrEvents({ activity: activity(), cursor: cursor(), previousHead: undefined }).lines).toEqual([]);
    expect(diffPrEvents({ activity: activity(), cursor: cursor(), previousHead: OLD_HEAD }).lines).toEqual([
      "HEAD abcdef12 pushed (was 01234567) — CI and reviews restart",
    ]);
  });

  it("reports MERGED with its instant, and CLOSED, as terminal", () => {
    const merged = diffPrEvents({
      activity: activity({ mergedAt: "2026-09-03T01:00:00Z", state: "MERGED" }),
      cursor: cursor(),
      previousHead: HEAD,
    });
    expect(merged.lines).toEqual(["MERGED 2026-09-03T01:00:00Z"]);
    expect(merged.terminal).toBe("MERGED");
    const closed = diffPrEvents({ activity: activity({ state: "CLOSED" }), cursor: cursor(), previousHead: HEAD });
    expect(closed.lines).toEqual(["CLOSED"]);
    expect(closed.terminal).toBe("CLOSED");
  });
});
