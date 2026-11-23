/**
 * Which of the owner's own walkthrough threads a landing verb resolves first, whether a pull request carries one, the
 * warning over those that do not, and the ledger row the resolving leaves. All pure.
 */
import { describe, expect, it } from "vitest";

import { requireSaid } from "../../../autonomy/fields.js";
import { INTERNAL_FINDING_SAID } from "../../../cli/commands/github/findingRulingGate.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { foldSummary } from "../../../outbound/briefing/vocabulary.js";
import { threadDetails } from "../../../review/prStateDetail.js";
import {
  collapsedReplies,
  hasWalkthrough,
  unansweredReplies,
  walkthroughAutonomyRow,
  walkthroughClearance,
  walkthroughRecheck,
  walkthroughWarningLine,
} from "../../../review/walkthroughClearance.js";
import { landingRowFake } from "../../landingRowFake.js";
import { walkthroughThread as sharedWalkthroughThread } from "../../walkthroughFake.js";

/** A walkthrough thread defaulting to the owner-login account as opener and last commenter. */
const walkthroughThread = (
  over: Parameters<typeof sharedWalkthroughThread>[0] = {},
): ReturnType<typeof sharedWalkthroughThread> =>
  sharedWalkthroughThread({ lastCommentLogin: "owner-login", openedByLogin: "owner-login", ...over });

const REVIEWER = walkthroughThread({ id: "PRRT_reviewer", lastCommentLogin: "teammate", openedByLogin: "teammate" });

describe("walkthroughClearance", () => {
  it("selects the owner's own open one-voice notes, by node id, on the owner's own pull request", () => {
    expect(
      walkthroughClearance({
        authorLogin: "owner-login",
        threads: [walkthroughThread({ id: "PRRT_a" }), walkthroughThread({ id: "PRRT_b" }), REVIEWER],
        viewerLogin: "owner-login",
      }),
    ).toEqual({ kind: "clear", threadIds: ["PRRT_a", "PRRT_b"] });
  });

  it("compares the author and the pressing account without regard to case", () => {
    expect(
      walkthroughClearance({
        authorLogin: "Owner-Login",
        threads: [walkthroughThread({ openedByLogin: "Owner-Login" })],
        viewerLogin: "owner-login",
      }).kind,
    ).toBe("clear");
  });

  it("leaves another account's notes alone and says how many there were", () => {
    expect(
      walkthroughClearance({
        authorLogin: "owner-login",
        threads: [walkthroughThread({})],
        viewerLogin: "someone-else",
      }),
    ).toEqual({ authorLogin: "owner-login", kind: "not-ours", open: 1 });
  });

  it("selects nothing resolved, replied into, opened by a reviewer, or opened by a bot", () => {
    const threads = [
      walkthroughThread({ id: "PRRT_done", isResolved: true }),
      walkthroughThread({ commentCount: 2, id: "PRRT_replied", lastCommentLogin: "teammate" }),
      walkthroughThread({ id: "PRRT_bot", openedByBot: true }),
      REVIEWER,
    ];
    expect(walkthroughClearance({ authorLogin: "owner-login", threads, viewerLogin: "owner-login" })).toEqual({
      kind: "none",
    });
  });

  /** Left open, a note carrying the owner's own last word is merged over by the admin door. */
  it("selects the owner's own note carrying more than one comment while theirs is the last word, never a reviewer's", () => {
    const threads = [
      walkthroughThread({ commentCount: 3, id: "PRRT_answered" }),
      walkthroughThread({ commentCount: 2, id: "PRRT_reviewer_answered", openedByLogin: "teammate" }),
    ];
    expect(walkthroughClearance({ authorLogin: "owner-login", threads, viewerLogin: "owner-login" })).toEqual({
      kind: "clear",
      threadIds: ["PRRT_answered"],
    });
  });

  it("still selects an outdated note, which holds the queue exactly as a current one does", () => {
    expect(
      walkthroughClearance({
        authorLogin: "owner-login",
        threads: [walkthroughThread({ id: "PRRT_old", isOutdated: true })],
        viewerLogin: "owner-login",
      }),
    ).toEqual({ kind: "clear", threadIds: ["PRRT_old"] });
  });

  it("refuses to select any when one came back with no node id, rather than landing into GitHub's refusal", () => {
    expect(
      walkthroughClearance({
        authorLogin: "owner-login",
        threads: [walkthroughThread({ id: "PRRT_a" }), walkthroughThread({ id: "" })],
        viewerLogin: "owner-login",
      }),
    ).toEqual({ kind: "unaddressable", open: 2, unaddressable: 1 });
  });
});

describe("walkthroughRecheck", () => {
  const before = ["a", "b", "c", "gone"].map((id) => walkthroughThread({ id }));

  it("counts a resolved thread that gained a reply, a reopened one, and one the re-read lost", () => {
    const threads = [
      walkthroughThread({ id: "a", isResolved: true }),
      walkthroughThread({ commentCount: 2, id: "b", isResolved: true }),
      walkthroughThread({ id: "c", isResolved: false }),
    ];
    expect(walkthroughRecheck({ before, threadIds: ["a", "b", "c", "gone"], threads })).toEqual({
      open: ["c", "gone"],
      replied: ["b"],
    });
  });

  it("is clean when every thread it resolved reads back resolved with the comments it was selected with", () => {
    const threads = [walkthroughThread({ commentCount: 2, id: "a", isResolved: true })];
    expect(
      walkthroughRecheck({ before: [walkthroughThread({ commentCount: 2, id: "a" })], threadIds: ["a"], threads }),
    ).toEqual({ open: [], replied: [] });
  });

  it("reads a thread the selecting read never carried as replied, the direction that reopens it", () => {
    const threads = [walkthroughThread({ id: "a", isResolved: true })];
    expect(walkthroughRecheck({ before: [], threadIds: ["a"], threads })).toEqual({ open: [], replied: ["a"] });
  });
});

describe("collapsedReplies", () => {
  const collapsed = walkthroughThread({
    commentCount: 2,
    id: "collapsed",
    isResolved: true,
    lastCommentLogin: "teammate",
    resolvedByLogin: "Owner-Login",
  });

  const landing = { resolved: ["collapsed", "answered", "theirs-resolved", "open", "surfaced"], surfaced: {} };
  /** The thread as the landing reopened it: two comments, the colleague's reply last. */
  const shownAt = { replyAtIso: collapsed.lastCommentAtIso, replyCount: 2 };

  it("selects a thread the landing resolved, resolved by the owner's account under a colleague's last word, and nothing else", () => {
    const threads = [
      collapsed,
      walkthroughThread({
        id: "answered",
        isResolved: true,
        lastCommentLogin: "owner-login",
        resolvedByLogin: "owner-login",
      }),
      walkthroughThread({
        id: "theirs-resolved",
        isResolved: true,
        lastCommentLogin: "teammate",
        resolvedByLogin: "teammate",
      }),
      walkthroughThread({ id: "open", lastCommentLogin: "teammate" }),
    ];
    expect(
      collapsedReplies({ authorLogin: "owner-login", memory: landing, threads, viewerLogin: "owner-login" }),
    ).toEqual(["collapsed"]);
  });

  /** GitHub records the owner's own deliberate resolve under the same login as the landing's. */
  it("leaves a resolve the landing never made, and one it already reopened, to the owner", () => {
    const threads = [
      walkthroughThread({ ...collapsed, id: "owner-own" }),
      walkthroughThread({ ...collapsed, id: "surfaced" }),
    ];
    const memory = { resolved: ["surfaced"], surfaced: { surfaced: shownAt } };
    expect(collapsedReplies({ authorLogin: "owner-login", memory, threads, viewerLogin: "owner-login" })).toEqual([]);
  });

  /** The exemption is for the reply the owner was shown, never for the thread for good. */
  it("selects a thread it already reopened once it holds a reply the owner was not shown, however GitHub stamps it", () => {
    const threads = [
      walkthroughThread({ ...collapsed, id: "later", lastCommentAtIso: "2026-09-28T06:00:00.000Z" }),
      walkthroughThread({ ...collapsed, commentCount: 3, id: "same-instant" }),
    ];
    const memory = { resolved: ["later", "same-instant"], surfaced: { later: shownAt, "same-instant": shownAt } };
    expect(collapsedReplies({ authorLogin: "owner-login", memory, threads, viewerLogin: "owner-login" })).toEqual([
      "later",
      "same-instant",
    ]);
  });

  it("selects nothing on a pull request the pressing account did not author", () => {
    expect(
      collapsedReplies({
        authorLogin: "owner-login",
        memory: landing,
        threads: [collapsed],
        viewerLogin: "someone-else",
      }),
    ).toEqual([]);
  });
});

describe("unansweredReplies", () => {
  const memory = {
    resolved: ["reopened", "answered", "resolved"],
    surfaced: { reopened: { replyAtIso: "2026-09-28T04:00:00.000Z", replyCount: 2 } },
  };

  /** Once reopened, the reply is no longer `ours-open`, and the admin door bypasses the rule. */
  it("selects an open thread the landing resolved whose last word is a colleague's, and nothing else", () => {
    const threads = [
      walkthroughThread({ commentCount: 2, id: "reopened", lastCommentLogin: "teammate" }),
      walkthroughThread({ commentCount: 3, id: "answered", lastCommentLogin: "owner-login" }),
      walkthroughThread({ commentCount: 2, id: "resolved", isResolved: true, lastCommentLogin: "teammate" }),
      walkthroughThread({ commentCount: 2, id: "theirs", lastCommentLogin: "teammate", openedByLogin: "teammate" }),
    ];
    expect(unansweredReplies({ authorLogin: "owner-login", memory, threads, viewerLogin: "owner-login" })).toEqual([
      "reopened",
    ]);
  });

  /** A reply landing just before the landing's read is on a thread it never resolved. */
  it("selects the owner's own open note a colleague answered, though the register has never heard of it", () => {
    const threads = [walkthroughThread({ commentCount: 2, id: "fresh-reply", lastCommentLogin: "teammate" })];
    const empty = { resolved: [], surfaced: {} };
    expect(
      unansweredReplies({ authorLogin: "owner-login", memory: empty, threads, viewerLogin: "owner-login" }),
    ).toEqual(["fresh-reply"]);
    expect(
      unansweredReplies({ authorLogin: "owner-login", memory: empty, threads, viewerLogin: "someone-else" }),
    ).toEqual([]);
  });
});

describe("hasWalkthrough", () => {
  it("counts a note the owner opened even once it is resolved", () => {
    const threads = threadDetails({ prAuthorLogin: "owner-login", threads: [walkthroughThread({ isResolved: true })] });
    expect(hasWalkthrough({ authorLogin: "owner-login", threads })).toBe(true);
  });

  it("does not count a thread only a reviewer opened", () => {
    const threads = threadDetails({ prAuthorLogin: "owner-login", threads: [REVIEWER] });
    expect(hasWalkthrough({ authorLogin: "owner-login", threads })).toBe(false);
  });
});

describe("walkthroughWarningLine", () => {
  const withNote = landingRowFake({
    authorLogin: "owner-login",
    number: 1,
    threads: threadDetails({ prAuthorLogin: "owner-login", threads: [walkthroughThread({})] }),
  });

  it("names every row with no walkthrough", () => {
    expect(
      walkthroughWarningLine({
        rows: [withNote, landingRowFake({ authorLogin: "owner-login", number: 2, repoSlug: "acme/acme-admin" })],
      }),
    ).toBe(
      "⚠ no self-review walkthrough on 1: acme/acme-admin#2. Every pull request of the owner's carries inline notes " +
        "guiding the reviewer — post a round with `slopweaver github pr update --self-review -`",
    );
  });

  it("says nothing when every row has one, or when the only bare row's threads were truncated", () => {
    expect(
      walkthroughWarningLine({
        rows: [withNote, landingRowFake({ authorLogin: "owner-login", threadsTruncated: true })],
      }),
    ).toBeUndefined();
  });
});

describe("walkthroughAutonomyRow", () => {
  const base = {
    bySession: "session:test",
    doneIso: "2026-09-28T05:00:00.000Z",
    headOid: "BCDEF0123456789A",
    number: 17519,
    repoSlug: "acme/acme-admin",
    selected: 3,
    threadIds: ["PRRT_c", "PRRT_a", "PRRT_b"],
    url: "https://github.com/acme/acme-admin/pull/17519",
    verb: "github enqueue",
  };

  it("qualifies its id by repository, since one ledger holds both repositories' numbers", () => {
    const row = unwrap(walkthroughAutonomyRow(base));
    expect([row.actionId, row.kind, row.subject]).toEqual([
      "acme-acme-admin-17519-resolve-own-threads-bcdef01-89aaef",
      "resolve-own-threads",
      "https://github.com/acme/acme-admin/pull/17519",
    ]);
    expect(row.witness).toBe(
      "slopweaver github enqueue -> resolved 3 of 3 own open walkthrough thread(s) on acme/acme-admin#17519 " +
        "at head BCDEF01",
    );
  });

  /** A retry after a partial resolve is a second act on the same head. */
  it("gives a second round on one head its own id, and the same threads in any order the same one", () => {
    const first = unwrap(walkthroughAutonomyRow({ ...base, threadIds: ["PRRT_a"] })).actionId;
    const again = unwrap(walkthroughAutonomyRow({ ...base, threadIds: ["PRRT_b", "PRRT_a", "PRRT_c"] })).actionId;
    expect([first === unwrap(walkthroughAutonomyRow(base)).actionId, again]).toEqual([
      false,
      unwrap(walkthroughAutonomyRow(base)).actionId,
    ]);
  });

  it("refuses through the ledger's own builder when a field breaks its rules", () => {
    expect(unwrapErr(walkthroughAutonomyRow({ ...base, doneIso: "not an instant" })).code).toBe("INVALID_FIELD");
  });
});

/**
 * The briefing's recent block takes a ledger row's `said` first sentence as its fold summary, which
 * `foldSummary` caps at 120 characters. Measured: a resolve-own-threads row
 * ran 155 and the chair could not close its pass.
 */
describe("a fleet-written autonomy `said` against the briefing's fold-summary cap", () => {
  const firstSentenceOf = ({ said }: { said: string }): string => said.split(/(?<=[.!?])\s+/u)[0]!;
  /** The longest slug the 80-character action id still admits beside its 41-character suffix. */
  const longRepo = `${"o".repeat(18)}/${"r".repeat(20)}`;
  const written: readonly { name: string; said: string }[] = [
    ...[1, 9, 10, 99999].flatMap((resolved) =>
      ["acme/acme-admin", "lachiejames/slopweaver", longRepo].map((repoSlug) => ({
        name: `resolve-own-threads, ${String(resolved)} on ${repoSlug.length} chars of repo`,
        said: unwrap(
          walkthroughAutonomyRow({
            bySession: "session:test",
            doneIso: "2026-09-28T05:00:00.000Z",
            headOid: "BCDEF0123456789A",
            number: 1750,
            repoSlug,
            selected: resolved,
            threadIds: Array.from({ length: resolved }, (_, index) => `PRRT_${String(index)}`),
            url: "https://github.com/lachiejames/slopweaver/pull/1750",
            verb: "github enqueue",
          }),
        ).said!,
      })),
    ),
    { name: "internal finding door", said: INTERNAL_FINDING_SAID },
  ];

  it("covers every written line", () => {
    expect(written.length).toBeGreaterThan(0);
  });

  it.each(written)("fits the fold summary on its first sentence: $name", ({ said }) => {
    expect(foldSummary.safeParse(firstSentenceOf({ said })).success).toBe(true);
  });

  it.each(written)("is one the ledger door takes whole: $name", ({ said }) => {
    expect(unwrap(requireSaid({ said }))).toBe(said);
  });

  it("is the two sentences the resolve row promises, the long one refused by the cap it must meet", () => {
    const said = written[0]!.said;
    expect(said.split(/(?<=[.!?])\s+/u)).toHaveLength(2);
    const oldFirstSentence = `I resolved 3 of your own self-review notes on ${"x".repeat(60)}/${"y".repeat(20)}#1750 before landing it.`;
    expect(foldSummary.safeParse(oldFirstSentence).success).toBe(false);
  });
});
