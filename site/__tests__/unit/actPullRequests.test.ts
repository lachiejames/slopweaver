/*
 * Which of the owner's open pull requests an act is about (a finding card must name the pull request, a link
 * and what it did). The finding gate records the ledger row before the pull request
 * exists, so the join is the landing reading's head branch or declared board row against the row's slug —
 * strongest first, and never a guess between two.
 */

import { describe, expect, it } from "vitest";

import { actPullRequests, type LinkedPullRequest } from "../../lib/queueCardAct";

const SLUG = "codex-seats-spawn-the-chatgpt-app-s-computer";

/** An open pull request as `github landing --json` carries it, with `over` laid on top. */
function pull(over: Partial<LinkedPullRequest> = {}): LinkedPullRequest {
  return {
    boardRowSlug: undefined,
    headRefName: SLUG,
    number: 1353,
    repoSlug: "lachiejames/slopweaver",
    title: "No Codex Slopweaver starts can launch the ChatGPT app's browser",
    url: "https://github.com/lachiejames/slopweaver/pull/1353",
    ...over,
  };
}

const OTHER = pull({
  headRefName: "renovate/zod-4.x",
  number: 17012,
  repoSlug: "acme/acme-admin",
  title: "bump zod",
  url: "https://github.com/acme/acme-admin/pull/17012",
});

describe("actPullRequests", () => {
  it("joins a finding to the one open pull request on a branch spelling its slug", () => {
    expect(actPullRequests({ act: { run: SLUG, subject: SLUG }, rows: [OTHER, pull()] })).toEqual([pull()]);
  });

  it("joins by the run alone when the subject is something else", () => {
    expect(actPullRequests({ act: { run: SLUG, subject: "elsewhere" }, rows: [pull()] })).toEqual([pull()]);
  });

  it("prefers the pull request whose URL is the subject over any branch match", () => {
    const subject = OTHER.url;
    expect(actPullRequests({ act: { run: SLUG, subject }, rows: [pull(), OTHER] })).toEqual([OTHER]);
  });

  it("prefers a declared board row over a head branch", () => {
    const declared = pull({
      boardRowSlug: SLUG,
      headRefName: "finding-pr-card",
      number: 1357,
      url: "https://github.com/lachiejames/slopweaver/pull/1357",
    });
    expect(actPullRequests({ act: { run: SLUG, subject: SLUG }, rows: [pull(), declared] })).toEqual([declared]);
  });

  it("names nothing when two repositories carry the branch, rather than the wrong one", () => {
    const twin = pull({ repoSlug: "acme/acme-admin", url: "https://github.com/acme/acme-admin/pull/9" });
    expect(actPullRequests({ act: { run: SLUG, subject: SLUG }, rows: [pull(), twin] })).toEqual([]);
  });

  it("lists each declared pull request once, in landing order", () => {
    const first = pull({ boardRowSlug: SLUG });
    const second = pull({
      boardRowSlug: SLUG,
      number: 1360,
      url: "https://github.com/lachiejames/slopweaver/pull/1360",
    });
    expect(actPullRequests({ act: { run: SLUG, subject: SLUG }, rows: [first, second, first] })).toEqual([
      first,
      second,
    ]);
  });

  it("joins nothing for an act no open pull request names", () => {
    expect(actPullRequests({ act: { run: undefined, subject: "machine-load-hold" }, rows: [pull(), OTHER] })).toEqual(
      [],
    );
  });

  it("joins nothing out of an empty reading", () => {
    expect(actPullRequests({ act: { run: SLUG, subject: SLUG }, rows: [] })).toEqual([]);
  });
});
