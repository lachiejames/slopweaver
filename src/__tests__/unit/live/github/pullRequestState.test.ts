/**
 * The shared pull-request read asked for a PULL REQUEST, as the chase hold asks (`slack draft record`). The same
 * decoder asked for either kind, and its not-found wording, are session-start's contract and are held down in
 * `../../sessionStart/verifyRows.test.ts`, beside the verdicts they feed.
 */
import { describe, expect, it } from "vitest";

import { pullRequestStateAddress, pullRequestStateOf } from "../../../../live/github/pullRequestState.js";

describe("pullRequestStateAddress", () => {
  it("reads a pull-request subject by its /pull/ address, which the live reader refuses for an issue", () => {
    expect(pullRequestStateAddress({ number: 238, repo: "acme/widget", subject: "pull-request" })).toBe(
      "https://github.com/acme/widget/pull/238",
    );
  });

  it("reads an either-kind subject by its /issues/ address, which GitHub answers with whichever kind holds it", () => {
    expect(pullRequestStateAddress({ number: 238, repo: "acme/widget", subject: "issue-or-pull-request" })).toBe(
      "https://github.com/acme/widget/issues/238",
    );
  });
});

describe("pullRequestStateOf asked for a pull request", () => {
  it("reads an OPEN issue at the number as absent, never as an open pull request", () => {
    expect(pullRequestStateOf({ data: { __typename: "Issue", state: "OPEN" }, subject: "pull-request" })).toStrictEqual(
      { kind: "absent" },
    );
  });

  it("reads a pull request node by its state", () => {
    expect(
      pullRequestStateOf({ data: { __typename: "PullRequest", state: "CLOSED" }, subject: "pull-request" }),
    ).toStrictEqual({ kind: "settled", state: "CLOSED" });
  });

  it("reads a node of no stated type as not checked", () => {
    expect(pullRequestStateOf({ data: { state: "OPEN" }, subject: "pull-request" })).toStrictEqual({
      kind: "notChecked",
    });
  });
});
