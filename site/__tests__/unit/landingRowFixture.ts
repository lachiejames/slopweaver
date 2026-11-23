/*
 * One `github landing` row with every field set, for the pull-request page's pure tests: the voice reading and the
 * state selector draw the same rows, so they build them the same way.
 */
import type { LandingRow } from "../../components/live/readLanding";

/** The wait the verb publishes on a `blocked-on` row — a real sentence, so the voice's size budget is measured with it. */
export const WAIT: NonNullable<LandingRow["humanWait"]> = {
  lastAskAtIso: undefined,
  lastAskPermalink: undefined,
  next: "name-the-reviewer",
  requestedAtIso: "2026-09-22T05:07:00Z",
  sentence:
    "Waiting on @acme/platform · requested 2026-09-22 05:07Z · no ask found · stale — a business day of " +
    "silence (24 business hours, weekends excluded) · next: name a person to ask — only your word is missing",
  slackThroughIso: undefined,
  stale: "yes",
  who: ["@acme/platform"],
};

/**
 * A row carrying `action`, a draft exactly when the act is `draft`, waiting on {@link WAIT} exactly when it is
 * `blocked-on`.
 *
 * @returns the row
 */
export function landingRow({ number, action }: { number: number; action: string }): LandingRow {
  let humanWait: LandingRow["humanWait"];
  if (action === "blocked-on") {
    humanWait = WAIT;
  }
  return {
    action,
    actionDetail: `detail ${String(number)}`,
    askTrail: [],
    authorLogin: "octocat",
    baseRefName: "main",
    blockedOn: [],
    boardRowKind: "declared",
    boardRowSlug: undefined,
    boardRowWhy: undefined,
    bump: undefined,
    channelShare: undefined,
    ci: "green",
    ciFailure: { kind: "not-red" },
    codeRabbit: { awaitingUs: 0, open: 1 },
    createdAtIso: "2026-09-23T10:00:00.000Z",
    dispatchKind: undefined,
    dispatchWhy: undefined,
    draft: action === "draft",
    failingChecks: [{ name: "lint", required: true, state: "FAILURE", url: undefined }],
    headOid: "abc",
    headRefName: `branch-${String(number)}`,
    humanWait,
    humans: { awaitingUs: 0, open: 2 },
    labels: [],
    number,
    repoSlug: "lachiejames/slopweaver",
    slackAsked: "none",
    slackBounded: undefined,
    slackWhy: undefined,
    stackPosition: undefined,
    stackSize: undefined,
    stacked: false,
    tests: [{ id: "undrafted", verdict: "pass", why: "not a draft" }],
    title: `pull request ${String(number)}`,
    updatedAtIso: "2026-09-23T11:00:00.000Z",
    url: `https://github.com/lachiejames/slopweaver/pull/${String(number)}`,
    verdict: undefined,
    waitingOn: [{ login: "reviewer", open: 3 }],
  };
}
