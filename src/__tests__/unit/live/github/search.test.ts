import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import {
  buildGithubSearchQuery,
  collectSearchMatches,
  judgeSearchCoverage,
  renderGithubSearchJson,
  renderGithubSearchText,
  searchGithubObjects,
} from "../../../../live/github/search.js";

const REPO = { owner: "acme", repo: "widget" };
const NOW = "2026-08-10T12:00:00.000Z";

describe("buildGithubSearchQuery", () => {
  it("scopes the caller's term to one repository", () => {
    expect(buildGithubSearchQuery({ repo: REPO, term: "is:pr fix login" })).toBe("is:pr fix login repo:acme/widget");
  });
});

describe("collectSearchMatches", () => {
  it("shapes a raw issue and a raw pull request hit, dropping one missing a core field", () => {
    const { dropped, matches } = collectSearchMatches({
      hits: [
        {
          html_url: "https://github.com/acme/widget/issues/3",
          number: 3,
          state: "open",
          title: "A bug",
          updated_at: "2026-08-01T00:00:00Z",
        },
        {
          html_url: "https://github.com/acme/widget/pull/9",
          number: 9,
          pull_request: {},
          state: "closed",
          title: "A fix",
          updated_at: "2026-08-02T00:00:00Z",
        },
        { number: 4, title: "no url or state" },
      ],
      repo: REPO,
    });

    expect(dropped).toBe(1);
    expect(matches).toEqual([
      {
        identity: "acme/widget#3",
        kind: "issue",
        number: 3,
        state: "open",
        title: "A bug",
        updatedAt: "2026-08-01T00:00:00Z",
        url: "https://github.com/acme/widget/issues/3",
      },
      {
        identity: "acme/widget#9",
        kind: "pull-request",
        number: 9,
        state: "closed",
        title: "A fix",
        updatedAt: "2026-08-02T00:00:00Z",
        url: "https://github.com/acme/widget/pull/9",
      },
    ]);
  });
});

describe("searchGithubObjects", () => {
  it("returns the shaped matches and the exact query it sent", async () => {
    const calls: unknown[] = [];
    const result = await searchGithubObjects({
      limit: 10,
      nowIso: () => NOW,
      repo: REPO,
      search: (args) => {
        calls.push(args);
        return Promise.resolve(
          ok({
            incomplete_results: false,
            items: [
              {
                html_url: "https://github.com/acme/widget/issues/3",
                number: 3,
                state: "open",
                title: "A bug",
                updated_at: "2026-08-01T00:00:00Z",
              },
            ],
            total_count: 1,
          }),
        );
      },
      term: "a bug",
    });

    expect(calls).toEqual([{ per_page: 10, q: "a bug repo:acme/widget" }]);
    expect(unwrap(result)).toEqual({
      coverage: {
        detail: "all 1 match(es) on one page (--limit 10)",
        kind: "complete",
        residue: ["only GitHub's own best-match relevance ranking was used; no fuzzy or model-based matching"],
      },
      matches: [
        {
          identity: "acme/widget#3",
          kind: "issue",
          number: 3,
          state: "open",
          title: "A bug",
          updatedAt: "2026-08-01T00:00:00Z",
          url: "https://github.com/acme/widget/issues/3",
        },
      ],
      repo: "acme/widget",
      searchedAtIso: NOW,
      source: "github",
      term: "a bug",
      totalCount: 1,
    });
  });

  it("answers zero hits as a normal, empty result rather than an error", async () => {
    const result = await searchGithubObjects({
      limit: 10,
      nowIso: () => NOW,
      repo: REPO,
      search: () => Promise.resolve(ok({ incomplete_results: false, items: [], total_count: 0 })),
      term: "nothing matches this",
    });

    expect(unwrap(result).matches).toEqual([]);
    expect(unwrap(result).totalCount).toBe(0);
  });

  it("reports a page that held fewer hits than GitHub counted as bounded, never complete", async () => {
    const result = await searchGithubObjects({
      limit: 1,
      nowIso: () => NOW,
      repo: REPO,
      search: () =>
        Promise.resolve(
          ok({
            incomplete_results: false,
            items: [
              {
                html_url: "https://github.com/acme/widget/pull/9",
                number: 9,
                pull_request: {},
                state: "open",
                title: "A fix",
                updated_at: "2026-08-02T00:00:00Z",
              },
            ],
            total_count: 13,
          }),
        ),
      term: "is:pr is:open",
    });

    expect(unwrap(result).coverage).toEqual({
      detail:
        "1 of 13 match(es) — 12 withheld by the page bound (--limit 1); GitHub's best-match order decides which (measured " +
        "newest-first for a term-less query, so the OLDEST are the ones missing), so this is a SAMPLE, not the set",
      kind: "bounded",
      residue: ["only GitHub's own best-match relevance ranking was used; no fuzzy or model-based matching"],
    });
    expect(unwrap(result).totalCount).toBe(13);
  });

  it("refuses a blank term before touching the search seam", async () => {
    let called = false;
    const result = await searchGithubObjects({
      limit: 10,
      nowIso: () => NOW,
      repo: REPO,
      search: () => {
        called = true;
        return Promise.resolve(ok({ incomplete_results: false, items: [], total_count: 0 }));
      },
      term: "   ",
    });

    expect(called).toBe(false);
    expect(unwrapErr(result)).toEqual(GithubLiveErrors.invalidTerm({ message: "a search term is required" }));
  });
});

describe("judgeSearchCoverage", () => {
  it("is complete when the page held every counted hit and dropped none", () => {
    expect(judgeSearchCoverage({ dropped: 0, held: 13, incomplete: false, limit: 25, totalCount: 13 })).toEqual({
      detail: "all 13 match(es) on one page (--limit 25)",
      kind: "complete",
      residue: ["only GitHub's own best-match relevance ranking was used; no fuzzy or model-based matching"],
    });
  });

  it("is complete on an empty result: zero counted, zero held", () => {
    expect(judgeSearchCoverage({ dropped: 0, held: 0, incomplete: false, limit: 10, totalCount: 0 }).kind).toBe(
      "complete",
    );
  });

  it("is bounded when GitHub marked the search incomplete, even with every counted hit on the page", () => {
    expect(judgeSearchCoverage({ dropped: 0, held: 3, incomplete: true, limit: 10, totalCount: 3 })).toEqual({
      detail:
        "GitHub marked the search incomplete_results (it timed out), so its 3 match(es) are a SAMPLE, not the set",
      kind: "bounded",
      residue: ["only GitHub's own best-match relevance ranking was used; no fuzzy or model-based matching"],
    });
  });

  it("is bounded when GitHub counted more than the page held", () => {
    expect(judgeSearchCoverage({ dropped: 0, held: 10, incomplete: false, limit: 10, totalCount: 13 })).toEqual({
      detail:
        "10 of 13 match(es) — 3 withheld by the page bound (--limit 10); GitHub's best-match order decides which (measured " +
        "newest-first for a term-less query, so the OLDEST are the ones missing), so this is a SAMPLE, not the set",
      kind: "bounded",
      residue: ["only GitHub's own best-match relevance ranking was used; no fuzzy or model-based matching"],
    });
  });

  it("is bounded when a hit was dropped, even though the page held every counted hit", () => {
    expect(judgeSearchCoverage({ dropped: 1, held: 3, incomplete: false, limit: 10, totalCount: 3 })).toEqual({
      detail:
        "2 of 3 match(es) — 0 withheld by the page bound (--limit 10); GitHub's best-match order decides which (measured " +
        "newest-first for a term-less query, so the OLDEST are the ones missing), so this is a SAMPLE, not the set",
      kind: "bounded",
      residue: [
        "only GitHub's own best-match relevance ranking was used; no fuzzy or model-based matching",
        "skipped 1 search hit(s) missing a core field",
      ],
    });
  });
});

describe("rendering", () => {
  it("renders JSON identical to the document", async () => {
    const result = await searchGithubObjects({
      limit: 10,
      nowIso: () => NOW,
      repo: REPO,
      search: () => Promise.resolve(ok({ incomplete_results: false, items: [], total_count: 0 })),
      term: "a term",
    });
    const document = unwrap(result);

    expect(JSON.parse(renderGithubSearchJson({ document }))).toEqual(document);
  });

  it("renders an explicit no-match line when nothing was found", async () => {
    const result = await searchGithubObjects({
      limit: 10,
      nowIso: () => NOW,
      repo: REPO,
      search: () => Promise.resolve(ok({ incomplete_results: false, items: [], total_count: 0 })),
      term: "a term",
    });

    expect(renderGithubSearchText({ document: unwrap(result) })).toContain("no match found");
  });

  it("renders one line per match, naming its kind, state, identity and url", async () => {
    const result = await searchGithubObjects({
      limit: 10,
      nowIso: () => NOW,
      repo: REPO,
      search: () =>
        Promise.resolve(
          ok({
            incomplete_results: false,
            items: [
              {
                html_url: "https://github.com/acme/widget/pull/9",
                number: 9,
                pull_request: {},
                state: "open",
                title: "A fix",
                updated_at: "2026-08-02T00:00:00Z",
              },
            ],
            total_count: 1,
          }),
        ),
      term: "fix",
    });

    expect(renderGithubSearchText({ document: unwrap(result) })).toContain(
      "[pull-request open] acme/widget#9 — A fix (https://github.com/acme/widget/pull/9)",
    );
  });
});
