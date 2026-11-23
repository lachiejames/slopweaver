/*
 * A pull request row's state in words the owner would say out loud, never the all-caps machine verdict, and its open age. Every word of the three closed sets is said; one the map has never seen
 * prints as itself rather than as a guessed state.
 */
import { describe, expect, it } from "vitest";

import type { LandingRow } from "../../components/live/readLandingRow";
import { openAgeOf, plainStateOf } from "../../lib/prPlainState";
import { drawnWaitOf } from "../../lib/reviewHook";
import { landingRow } from "./landingRowFixture";

/** The landing action words `src/review/landing.ts` declares. */
const ACTIONS = [
  "press",
  "queued",
  "pressed-not-queued",
  "spawn-ci",
  "spawn-coderabbit",
  "answer-threads",
  "blocked-on",
  "conflicting",
  "stacked",
  "draft",
  "no-queue",
  "opted-out",
  "unknown",
] as const;

/** The dispatch verdicts `src/review/landingDispatch.ts` declares. */
const VERDICTS = [
  "rebase-and-fix",
  "merge-now",
  "resolve-then-merge",
  "resolve-then-bump",
  "coderabbit-loop",
  "needs-owner-judgment",
  "draft-first-review-ask",
  "finish-or-card-close",
] as const;

/** The human-wait next acts `src/review/humanWait.ts` declares. */
const WAITS = [
  "bump",
  "wait",
  "wait-on-channel",
  "ask",
  "name-the-reviewer",
  "read-the-messages",
  "sync-slack",
] as const;

/** A row carrying one landing action and, when given, an `act` dispatch with that verdict. */
function row({
  action,
  verdict,
}: {
  action: string;
  verdict: string | undefined;
}): Pick<LandingRow, "action" | "dispatchKind" | "verdict"> {
  if (verdict === undefined) {
    return { action, dispatchKind: undefined, verdict };
  }
  return { action, dispatchKind: "act", verdict };
}

describe("plainStateOf", () => {
  it("says every landing action as a state", () => {
    expect(
      ACTIONS.map((action) => plainStateOf({ row: row({ action, verdict: undefined }), wait: undefined })),
    ).toEqual([
      "Ready to land",
      "In merge queue",
      "Pressed · not in the merge queue",
      "CI needs work",
      "CodeRabbit review needs attention",
      "Review comments to answer",
      "Waiting on a human review",
      "Conflicts with its base",
      "Based on a branch other than the default",
      "Draft",
      "No merge queue on its base branch",
      "Opted out of landing",
      "Not known yet",
    ]);
  });

  it("says every dispatch verdict as a state, over the action, never the all-caps word", () => {
    expect(
      VERDICTS.map((verdict) => plainStateOf({ row: row({ action: "draft", verdict }), wait: undefined })),
    ).toEqual([
      "CI needs work · fleet to fix",
      "Ready · fleet to land it",
      "Review comments · fleet to answer",
      "A reviewer still to clear it",
      "Bot review comments · fleet to answer",
      "Needs your call",
      "Nobody asked yet · fleet to draft the first message",
      "Draft · fleet to finish it or propose closing it",
    ]);
  });

  it("never says ready over a dispatch the gate refused as unread, whatever the action reads", () => {
    expect(
      ["press", "conflicting", "unknown"].map((action) =>
        plainStateOf({ row: { action, dispatchKind: "unread", verdict: undefined }, wait: undefined }),
      ),
    ).toEqual([
      "Not known yet · a fact it rests on was not read",
      "Not known yet · a fact it rests on was not read",
      "Not known yet · a fact it rests on was not read",
    ]);
  });

  it("says the action under a waiting or outside-the-set dispatch, which carry no verdict", () => {
    expect([
      plainStateOf({ row: { action: "queued", dispatchKind: "waiting", verdict: undefined }, wait: undefined }),
      plainStateOf({
        row: { action: "no-queue", dispatchKind: "outside-the-set", verdict: undefined },
        wait: undefined,
      }),
    ]).toEqual(["In merge queue", "No merge queue on its base branch"]);
  });

  it("tells a conflict from failing CI under rebase-and-fix by the landing action", () => {
    expect([
      plainStateOf({ row: row({ action: "conflicting", verdict: "rebase-and-fix" }), wait: undefined }),
      plainStateOf({ row: row({ action: "spawn-ci", verdict: "rebase-and-fix" }), wait: undefined }),
    ]).toEqual(["Conflicts · fleet to fix", "CI needs work · fleet to fix"]);
  });

  it("tells a CodeRabbit verdict from open bot threads under coderabbit-loop by the landing action", () => {
    expect([
      plainStateOf({ row: row({ action: "spawn-coderabbit", verdict: "coderabbit-loop" }), wait: undefined }),
      plainStateOf({ row: row({ action: "answer-threads", verdict: "coderabbit-loop" }), wait: undefined }),
    ]).toEqual(["CodeRabbit review · fleet to handle it", "Bot review comments · fleet to answer"]);
  });

  it("says every human wait as a state, over the verdict, the action and an unread dispatch", () => {
    expect([
      ...WAITS.map((next) =>
        plainStateOf({ row: row({ action: "blocked-on", verdict: "merge-now" }), wait: { next } }),
      ),
      plainStateOf({ row: { action: "press", dispatchKind: "unread", verdict: undefined }, wait: { next: "wait" } }),
    ]).toEqual([
      "Asked for a review · ask again",
      "Asked for a review · waiting",
      "Shared in a channel · waiting",
      "Next: ask for a review, or open a discussion",
      "Needs a reviewer named",
      "Slack messages need reading",
      "Slack history needs syncing",
      "Asked for a review · waiting",
    ]);
  });

  it("says a pick's ask as asking the picked reviewer, never as a discussion opener", () => {
    const drawn = drawnWaitOf({
      people: new Map(),
      picked: { reviewer: "U0SYN000006" },
      row: landingRow({ action: "blocked-on", number: 7 }),
    });

    expect([
      drawn!.next,
      plainStateOf({ row: row({ action: "blocked-on", verdict: undefined }), wait: drawn }),
      plainStateOf({
        row: row({ action: "blocked-on", verdict: undefined }),
        wait: { next: "ask", pickedReviewer: undefined },
      }),
    ]).toEqual(["ask", "Next: ask the reviewer you picked", "Next: ask for a review, or open a discussion"]);
  });

  it("prints a word it has never seen as itself, never a guessed state", () => {
    expect([
      plainStateOf({ row: row({ action: "brand-new-action", verdict: undefined }), wait: undefined }),
      plainStateOf({ row: row({ action: "draft", verdict: "brand-new-verdict" }), wait: undefined }),
      plainStateOf({ row: row({ action: "draft", verdict: undefined }), wait: { next: "brand-new-wait" } }),
    ]).toEqual(["brand-new-action", "brand-new-verdict", "brand-new-wait"]);
  });

  it("prints a word naming an inherited object member as itself, never the member", () => {
    expect([
      plainStateOf({ row: row({ action: "toString", verdict: undefined }), wait: undefined }),
      plainStateOf({ row: row({ action: "draft", verdict: "constructor" }), wait: undefined }),
      plainStateOf({ row: row({ action: "draft", verdict: undefined }), wait: { next: "__proto__" } }),
      plainStateOf({ row: row({ action: "hasOwnProperty", verdict: undefined }), wait: undefined }),
    ]).toEqual(["toString", "constructor", "__proto__", "hasOwnProperty"]);
  });
});

describe("openAgeOf", () => {
  const NOW = Date.parse("2026-11-04T12:00:00.000Z");

  it("says minutes, hours and days, rounded down, and now inside the first minute", () => {
    expect(
      [
        "2026-11-04T11:59:30.000Z",
        "2026-11-04T11:15:00.000Z",
        "2026-11-04T10:00:01.000Z",
        "2026-11-03T12:00:01.000Z",
        "2026-11-01T11:00:00.000Z",
      ].map((createdAtIso) => openAgeOf({ createdAtIso, nowMs: NOW })),
    ).toEqual(["now", "45m", "1h", "23h", "3d"]);
  });

  it("names an instant it cannot read, and never prints a negative age", () => {
    expect([
      openAgeOf({ createdAtIso: "2026-11-04T1x", nowMs: NOW }),
      openAgeOf({ createdAtIso: "2026-11-05T12:00:00.000Z", nowMs: NOW }),
      openAgeOf({ createdAtIso: "2026-02-30T12:00:00.000Z", nowMs: NOW }),
      openAgeOf({ createdAtIso: "2026-11-01T25:00:00Z", nowMs: NOW }),
      openAgeOf({ createdAtIso: "the first of November", nowMs: NOW }),
      openAgeOf({ createdAtIso: "2026-11-01T12:00:00Z", nowMs: NOW }),
    ]).toEqual(["age unreadable", "now", "age unreadable", "age unreadable", "age unreadable", "3d"]);
  });
});
