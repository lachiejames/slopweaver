/*
 * The by-branch read an act card takes when it opens: argv out, payloads in, the exact pull requests out. The
 * payloads are the verbs' real shapes, captured off
 * `slopweaver github search "is:pr head:the-hands-card-on-the-queue-page-shows-no-command-to-paste" --repo lachiejames/slopweaver --json`
 * and `slopweaver github pr summary https://github.com/lachiejames/slopweaver/pull/<number> --json`, trimmed to the fields read.
 * The console's own search names no `--repo`; the answer's `repo` field is the same either way.
 */

import { describe, expect, it } from "vitest";

import {
  actPullCandidates,
  actPullRead,
  actPullReadArgv,
  actPullSearchArgv,
  actPullStateOf,
  exactActPulls,
  isActPullRepo,
} from "../../lib/actPullVerb";
import type { ReadPullRequest } from "../../lib/findingActCard";

const BRANCH = "the-hands-card-on-the-queue-page-shows-no-command-to-paste";
const REPO = "lachiejames/slopweaver";
/** An install on a fork: its own `origin`, whose search must never draw the upstream pull request. */
const FORK = "someone/slopweaver";
const PR_1356 = "https://github.com/lachiejames/slopweaver/pull/1356";
const TITLE_1356 = "The queue's hands card draws the step's literal whole, with a copy button";

/** A `github search --json` answer holding the given matches. */
function searchAnswer({
  matches,
  totalCount,
}: {
  matches: readonly Record<string, unknown>[];
  totalCount: number;
}): Record<string, unknown> {
  return {
    coverage: { detail: "all 1 match(es) on one page (--limit 10)", kind: "complete", residue: [] },
    matches,
    repo: REPO,
    searchedAtIso: "2026-09-26T12:17:23.732Z",
    source: "github",
    term: `is:pr head:${BRANCH}`,
    totalCount,
  };
}

const MATCH_1356 = {
  identity: "lachiejames/slopweaver#1356",
  kind: "pull-request",
  number: 1356,
  state: "closed",
  title: TITLE_1356,
  updatedAt: "2026-09-26T11:58:18Z",
  url: PR_1356,
};

describe("actPullSearchArgv", () => {
  it("names no repository, so the verb searches the serving checkout's own origin", () => {
    expect(actPullSearchArgv({ branch: BRANCH })).toEqual({
      argv: ["github", "search", `is:pr head:${BRANCH}`, "--json"],
      kind: "argv",
      title: `slopweaver github search "is:pr head:${BRANCH}" --json`,
    });
  });

  it("refuses a branch that could carry a second search qualifier", () => {
    expect(actPullSearchArgv({ branch: "main is:open" })).toEqual({
      kind: "refused",
      why: "main is:open is not a branch name the console looks a pull request up by",
    });
  });

  it("refuses a branch spelled as a flag", () => {
    expect(actPullSearchArgv({ branch: "--repo" })).toEqual({
      kind: "refused",
      why: "--repo is not a branch name the console looks a pull request up by",
    });
  });
});

describe("actPullReadArgv", () => {
  it("reads a pull request on the repository the search answered", () => {
    expect(actPullReadArgv({ repo: REPO, url: PR_1356 })).toEqual({
      argv: ["github", "pr", "summary", PR_1356, "--json"],
      kind: "argv",
      title: `slopweaver github pr summary ${PR_1356} --json`,
    });
  });

  it("matches the searched repository whatever its letter case, as GitHub does", () => {
    expect(actPullReadArgv({ repo: "LachieJames/Slopweaver", url: PR_1356 }).kind).toBe("argv");
  });

  it("refuses an address on another repository", () => {
    expect(actPullReadArgv({ repo: REPO, url: "https://github.com/acme/acme-admin/pull/1356" })).toEqual({
      kind: "refused",
      why: "https://github.com/acme/acme-admin/pull/1356 is not a pull request on lachiejames/slopweaver",
    });
  });

  it("refuses the upstream pull request when the install is a fork", () => {
    expect(actPullReadArgv({ repo: FORK, url: PR_1356 })).toEqual({
      kind: "refused",
      why: `${PR_1356} is not a pull request on someone/slopweaver`,
    });
  });

  it.each([
    ["a trailing path segment", `${PR_1356}/files`],
    ["a trailing slash", `${PR_1356}/`],
    ["a query", `${PR_1356}?x=1`],
    ["a fragment", `${PR_1356}#top`],
    ["a number that is not decimal", "https://github.com/lachiejames/slopweaver/pull/0x1"],
    ["plain http", "http://github.com/lachiejames/slopweaver/pull/1356"],
    ["another host", "https://gitlab.com/lachiejames/slopweaver/pull/1356"],
    ["an issue", "https://github.com/lachiejames/slopweaver/issues/1356"],
  ])("refuses an address with %s", (_what, url) => {
    expect(actPullReadArgv({ repo: REPO, url }).kind).toBe("refused");
  });

  it("reads a dot in the repository's name as a dot, never as any character", () => {
    expect(
      actPullReadArgv({ repo: "someone/slop.weaver", url: "https://github.com/someone/slop.weaver/pull/1" }).kind,
    ).toBe("argv");
    expect(
      actPullReadArgv({ repo: "someone/slop.weaver", url: "https://github.com/someone/slopxweaver/pull/1" }).kind,
    ).toBe("refused");
  });

  it("refuses when the repository it is checked against is not a slug", () => {
    expect(actPullReadArgv({ repo: "lachiejames/slopweaver/pull/1356", url: PR_1356 }).kind).toBe("refused");
  });

  it("refuses a non-ASCII letter that only lowercases onto the repository's own", () => {
    // U+212A, a compatibility letter, lowercases to ASCII "k" in JavaScript; GitHub never treats it as one.
    expect(actPullReadArgv({ repo: "owner/k", url: "https://github.com/owner/K/pull/1" }).kind).toBe("refused");
  });
});

describe("isActPullRepo", () => {
  it("accepts an owner/name slug", () => {
    expect(isActPullRepo({ repo: REPO })).toBe(true);
  });

  it.each([
    ["an Enterprise Managed User owner", "mona-cat_octo/widget"],
    ["a legacy owner with a doubled hyphen", "a--b/repo"],
  ])("accepts %s", (_what, repo) => {
    expect(isActPullRepo({ repo })).toBe(true);
  });

  it("accepts an owner and a name at GitHub's own limits", () => {
    expect(isActPullRepo({ repo: `${"a".repeat(39)}/${"r".repeat(100)}` })).toBe(true);
  });

  it.each([
    ["a bare name", "slopweaver"],
    ["a third segment", "a/b/c"],
    ["a query", "a/b?x"],
    ["empty", ""],
    ["a name that is a dot", "a/."],
    ["a name that is two dots", "a/.."],
    ["an owner past GitHub's 39 characters", `${"a".repeat(40)}/r`],
    ["a name past GitHub's 100 characters", `a/${"r".repeat(101)}`],
  ])("refuses %s", (_what, repo) => {
    expect(isActPullRepo({ repo })).toBe(false);
  });
});

describe("actPullCandidates", () => {
  it("keeps each pull-request match, counts none beyond a complete page, and names the repository searched", () => {
    expect(actPullCandidates({ payload: searchAnswer({ matches: [MATCH_1356], totalCount: 1 }) })).toEqual({
      beyond: 0,
      candidates: [{ number: 1356, title: TITLE_1356, url: PR_1356 }],
      repo: REPO,
    });
  });

  it("refuses an answer that does not say which repository it searched", () => {
    const { repo: _dropped, ...unscoped } = searchAnswer({ matches: [MATCH_1356], totalCount: 1 });
    expect(actPullCandidates({ payload: unscoped })).toBe(undefined);
  });

  it.each([
    ["blank", ""],
    ["a bare name", "slopweaver"],
    ["a third segment", "lachiejames/slopweaver/pull"],
  ])("refuses an answer whose repository is %s", (_what, repo) => {
    const payload = { ...searchAnswer({ matches: [MATCH_1356], totalCount: 1 }), repo };
    expect(actPullCandidates({ payload })).toBe(undefined);
  });

  it("counts the matches GitHub reported past the page it printed", () => {
    expect(actPullCandidates({ payload: searchAnswer({ matches: [MATCH_1356], totalCount: 14 }) })!.beyond).toBe(13);
  });

  it("leaves out a match that is not a pull request", () => {
    const issue = {
      ...MATCH_1356,
      kind: "issue",
      number: 7,
      url: "https://github.com/lachiejames/slopweaver/issues/7",
    };
    expect(actPullCandidates({ payload: searchAnswer({ matches: [issue], totalCount: 1 }) })!.candidates).toEqual([]);
  });

  it("refuses an answer with a match missing its number", () => {
    const { number: _dropped, ...unnumbered } = MATCH_1356;
    expect(actPullCandidates({ payload: searchAnswer({ matches: [unnumbered], totalCount: 1 }) })).toBe(undefined);
  });

  it("refuses an answer without a total count", () => {
    expect(actPullCandidates({ payload: { matches: [MATCH_1356] } })).toBe(undefined);
  });
});

/** `slopweaver github pr summary <#N> --json`, cells trimmed. */
const SUMMARY_1356 = {
  form: {
    blastRadius: "The console's Queue page, on a hands card.",
    kind: "parsed",
    problem: 'A hands card read "Paste this in a terminal" and never showed the command.',
    risk: "Low risk. The site's hand reader now refuses a step whose literal is present but not a string.",
  },
  crossRepository: false,
  headRefName: BRANCH,
  mergedAt: "2026-09-26T11:58:18Z",
  number: 1356,
  readAtIso: "2026-09-26T16:04:13.430Z",
  state: "merged",
  title: TITLE_1356,
  url: PR_1356,
};

/** {@link SUMMARY_1356} as the card holds it. */
const PULL_1356: ReadPullRequest = {
  boardRowSlug: undefined,
  form: {
    blastRadius: "The console's Queue page, on a hands card.",
    kind: "parsed",
    problem: 'A hands card read "Paste this in a terminal" and never showed the command.',
    risk: "Low risk. The site's hand reader now refuses a step whose literal is present but not a string.",
  },
  headRefName: BRANCH,
  mergedAt: "2026-09-26T11:58:18Z",
  number: 1356,
  readAtIso: "2026-09-26T16:04:13.430Z",
  repoSlug: "lachiejames/slopweaver",
  state: "merged",
  title: TITLE_1356,
  url: PR_1356,
};

describe("actPullRead", () => {
  it("reads the verb's summary into the pull request the card holds", () => {
    expect(actPullRead({ payload: SUMMARY_1356, repo: REPO })).toEqual({ crossRepository: false, pull: PULL_1356 });
  });

  it("keeps a declined description's reason, and an unmerged pull request's absent merge instant", () => {
    const declined = { kind: "declined", reason: "its description carries no Risk or Blast radius row" } as const;
    const payload = { ...SUMMARY_1356, form: declined, mergedAt: null, state: "open" };
    expect(actPullRead({ payload, repo: REPO })).toEqual({
      crossRepository: false,
      pull: { ...PULL_1356, form: declined, mergedAt: undefined, state: "open" },
    });
  });

  it.each([
    ["no head branch", { ...SUMMARY_1356, headRefName: undefined }],
    ["a state that is not a lifecycle word", { ...SUMMARY_1356, state: "MERGED" }],
    ["parsed cells missing one", { ...SUMMARY_1356, form: { kind: "parsed", problem: "p", risk: "r" } }],
    ["a pull request on another repository", { ...SUMMARY_1356, url: "https://github.com/acme/acme-admin/pull/1" }],
    ["a merge instant that is not text", { ...SUMMARY_1356, mergedAt: 7 }],
    ["no word on whether its head is a fork", { ...SUMMARY_1356, crossRepository: undefined }],
  ])("refuses a summary with %s", (_what, payload) => {
    expect(actPullRead({ payload, repo: REPO })).toBe(undefined);
  });

  it("refuses the upstream pull request when the install is a fork", () => {
    expect(actPullRead({ payload: SUMMARY_1356, repo: FORK })).toBe(undefined);
  });

  it("reads a fork install's own pull request, naming the fork as its repository", () => {
    const url = "https://github.com/someone/slopweaver/pull/12";
    expect(actPullRead({ payload: { ...SUMMARY_1356, number: 12, url }, repo: FORK })).toEqual({
      crossRepository: false,
      pull: { ...PULL_1356, number: 12, repoSlug: FORK, url },
    });
  });
});

describe("exactActPulls", () => {
  const candidates = [
    { number: 1356, title: "The search's older title", url: PR_1356 },
    {
      number: 1200,
      title: "Another branch sharing a token",
      url: "https://github.com/lachiejames/slopweaver/pull/1200",
    },
  ];
  const other = { ...PULL_1356, headRefName: "the-hands-card", number: 1200, url: candidates[1].url };
  const own = { crossRepository: false, pull: PULL_1356 };
  const elsewhere = { crossRepository: false, pull: other };

  it("keeps only the read pull request whose head IS the branch, with the read's title", () => {
    expect(exactActPulls({ beyond: 0, branch: BRANCH, candidates, reads: [own, elsewhere] })).toEqual({
      pulls: [PULL_1356],
      unchecked: 0,
    });
  });

  it("rules out a fork whose head branch shares the name, and counts it as read", () => {
    const fork = { crossRepository: true, pull: { ...PULL_1356, number: 1200, url: candidates[1].url } };
    expect(exactActPulls({ beyond: 0, branch: BRANCH, candidates, reads: [own, fork] })).toEqual({
      pulls: [PULL_1356],
      unchecked: 0,
    });
  });

  it("counts candidates past the read cap and matches past the page as unchecked", () => {
    expect(exactActPulls({ beyond: 3, branch: BRANCH, candidates, reads: [elsewhere] })).toEqual({
      pulls: [],
      unchecked: 4,
    });
  });
});

describe("actPullStateOf", () => {
  it("reads the route's answer into a ready lookup", () => {
    const body = { observedAtIso: "2026-09-26T12:17:24.000Z", ok: true, pulls: [PULL_1356], repo: REPO, unchecked: 0 };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "ready",
      pulls: [PULL_1356],
      unchecked: 0,
    });
  });

  it("refuses a pull request the route says came from another branch", () => {
    const body = {
      observedAtIso: "2026-09-26T12:17:24.000Z",
      ok: true,
      pulls: [{ ...PULL_1356, headRefName: "other" }],
      repo: REPO,
      unchecked: 0,
    };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "not-measured",
      why: `/api/act-pull answered ${PR_1356}, which is not from branch ${BRANCH}`,
    });
  });

  it("refuses a pull request missing its description cells", () => {
    const { form: _dropped, ...formless } = PULL_1356;
    const body = { observedAtIso: "2026-09-26T12:17:24.000Z", ok: true, pulls: [formless], repo: REPO, unchecked: 0 };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "not-measured",
      why: "/api/act-pull answered a pull request missing its fields, or not on lachiejames/slopweaver",
    });
  });

  it("refuses an upstream pull request when the repository searched is a fork", () => {
    const body = { observedAtIso: "2026-09-26T12:17:24.000Z", ok: true, pulls: [PULL_1356], repo: FORK, unchecked: 0 };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "not-measured",
      why: "/api/act-pull answered a pull request missing its fields, or not on someone/slopweaver",
    });
  });

  it("refuses a stamped repository whose non-ASCII letter only lowercases onto the searched one", () => {
    const pull = { ...PULL_1356, repoSlug: "owner/K", url: "https://github.com/owner/k/pull/1" };
    const body = { observedAtIso: "2026-09-26T12:17:24.000Z", ok: true, pulls: [pull], repo: "owner/k", unchecked: 0 };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "not-measured",
      why: "/api/act-pull answered a pull request missing its fields, or not on owner/k",
    });
  });

  it("refuses a pull request whose stamped repository disagrees with its own address", () => {
    const stamped = { ...PULL_1356, repoSlug: "attacker/other" };
    const body = { observedAtIso: "2026-09-26T12:17:24.000Z", ok: true, pulls: [stamped], repo: REPO, unchecked: 0 };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "not-measured",
      why: "/api/act-pull answered a pull request missing its fields, or not on lachiejames/slopweaver",
    });
  });

  it("accepts a fork install's own pull request under the fork it searched", () => {
    const url = "https://github.com/someone/slopweaver/pull/12";
    const own = { ...PULL_1356, number: 12, repoSlug: FORK, url };
    const body = { observedAtIso: "2026-09-26T12:17:24.000Z", ok: true, pulls: [own], repo: FORK, unchecked: 0 };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "ready",
      pulls: [own],
      unchecked: 0,
    });
  });

  it("refuses an answer whose repository is not a slug", () => {
    const body = { observedAtIso: "2026-09-26T12:17:24.000Z", ok: true, pulls: [], repo: "slopweaver", unchecked: 0 };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "not-measured",
      why: "/api/act-pull answered without the repository it searched",
    });
  });

  it("refuses an answer that does not say which repository it searched", () => {
    const body = { observedAtIso: "2026-09-26T12:17:24.000Z", ok: true, pulls: [PULL_1356], unchecked: 0 };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "not-measured",
      why: "/api/act-pull answered without the repository it searched",
    });
  });

  it("carries the route's own reason when it did not measure", () => {
    const body = {
      notMeasured: "slopweaver github search timed out",
      observedAtIso: "2026-09-26T12:17:24.000Z",
      ok: false,
    };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "not-measured",
      why: "slopweaver github search timed out",
    });
  });

  it("refuses a count of unread matches that is not a whole number of them", () => {
    const body = { observedAtIso: "2026-09-26T12:17:24.000Z", ok: true, pulls: [], repo: REPO, unchecked: -1 };
    expect(actPullStateOf({ body, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "not-measured",
      why: "/api/act-pull answered without its pull requests",
    });
  });

  it("refuses an answer that is not the route's shape", () => {
    expect(actPullStateOf({ body: { ok: true }, branch: BRANCH })).toEqual({
      branch: BRANCH,
      phase: "not-measured",
      why: "/api/act-pull answered without its pull requests",
    });
  });
});
