import { describe, expect, it } from "vitest";
import type { GithubActivity } from "../../../../corpus/github/activity.js";
import {
  enrichFailureWarnings,
  searchCapWarnings,
  searchDropWarnings,
} from "../../../../corpus/github/crawlWarnings.js";
import { type GithubActivityError, GithubActivityErrors, GithubFetchErrors } from "../../../../corpus/github/errors.js";
import { collectSearchHits, makeGithubFetchItems, type SearchIssues } from "../../../../corpus/github/fetch.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

describe("collectSearchHits", () => {
  const goodHit = ({ n }: { n: number }): unknown => ({
    created_at: "2024-01-01T00:00:00Z",
    html_url: `url${String(n)}`,
    number: n,
    title: `t${String(n)}`,
    updated_at: "2024-01-02T00:00:00Z",
    user: { login: "u" },
  });

  it("keeps parseable hits and counts the unusable ones", () => {
    const out = collectSearchHits({ hits: [goodHit({ n: 1 }), { number: 2 }, goodHit({ n: 3 })] });
    expect(out.items.map((i) => i.number)).toEqual([1, 3]);
    expect(out.dropped).toBe(1);
  });

  it("returns empty for no hits", () => {
    expect(collectSearchHits({ hits: [] })).toEqual({ dropped: 0, items: [] });
  });
});

describe("searchDropWarnings", () => {
  it("is empty when nothing dropped", () => {
    expect(searchDropWarnings({ dropped: 0 })).toEqual([]);
  });

  it("names the dropped count when hits were dropped", () => {
    expect(searchDropWarnings({ dropped: 2 })[0]).toContain("skipped 2 GitHub search hit(s)");
  });
});

const repo = { owner: "o", repo: "r" };
const window = { since: "2024-01-01", until: "2024-01-03" };

const hit = ({ n, isPr }: { n: number; isPr: boolean }): unknown => ({
  created_at: "2024-01-01T00:00:00Z",
  html_url: `url${String(n)}`,
  number: n,
  title: `t${String(n)}`,
  updated_at: "2024-01-02T00:00:00Z",
  user: { login: "u" },
  ...(isPr ? { pull_request: {} } : {}),
});

/** page 1 returns `items`, later pages are empty (a short page stops the loop). */
const search =
  ({ items }: { items: readonly unknown[] }): SearchIssues =>
  async ({ page }) => ({ data: { items: page === 1 ? items : [] } });

const activityStub: GithubActivity = {
  comments: [],
  reviews: [],
  state: "OPEN",
  timeline: [],
  truncated: [],
  updatedAtIso: "2024-01-02T00:00:00Z",
};

describe("makeGithubFetchItems", () => {
  it("maps hits to items, discriminating PR vs issue", async () => {
    const fetchItems = makeGithubFetchItems({
      searchIssues: search({ items: [hit({ isPr: true, n: 1 }), hit({ isPr: false, n: 2 })] }),
    });
    const result = await fetchItems({ repo, window });
    expect(unwrap(result).items.map((i) => i.kind)).toEqual(["pr", "issue"]);
  });

  it("keeps the raw search hit on the shaped item", async () => {
    const rawHit = hit({ isPr: true, n: 1 });
    const fetchItems = makeGithubFetchItems({ searchIssues: search({ items: [rawHit] }) });
    const { items } = unwrap(await fetchItems({ repo, window }));
    expect(items[0]!.raw).toEqual(rawHit);
  });

  it("attaches activity on enrich success and ships the item bare on enrich failure", async () => {
    const fetchActivity = async ({
      number,
    }: {
      number: number;
    }): Promise<Result<GithubActivity, GithubActivityError>> =>
      number === 1 ? ok(activityStub) : err(GithubActivityErrors.nodeNotFound({ isPr: true, number }));
    const fetchItems = makeGithubFetchItems({
      fetchActivity,
      searchIssues: search({ items: [hit({ isPr: true, n: 1 }), hit({ isPr: true, n: 2 })] }),
    });
    const { items } = unwrap(await fetchItems({ repo, window }));
    expect(items[0]!.activity).toBeDefined();
    expect(items[1]!.activity).toBeUndefined();
  });

  it("a search failure is fatal (err), not a partial write", async () => {
    const fetchItems = makeGithubFetchItems({
      searchIssues: async () => {
        throw new Error("boom");
      },
    });
    const result = await fetchItems({ repo, window });
    expect(unwrapErr(result).code).toBe("SEARCH_FAILED");
    expect(unwrapErr(result).message).toBe("boom");
  });

  it("drops a hit missing a core field and surfaces the skip count (never silent)", async () => {
    const missingTitle = { html_url: "url9", number: 9, updated_at: "2024-01-02T00:00:00Z" }; // no title
    const fetchItems = makeGithubFetchItems({
      searchIssues: search({ items: [hit({ isPr: true, n: 1 }), missingTitle] }),
    });
    const result = await fetchItems({ repo, window });
    expect(unwrap(result).items.map((i) => i.number)).toEqual([1]);
    expect(unwrap(result).warnings.some((w) => w.includes("skipped 1"))).toBe(true);
  });

  it("honours the page cap", async () => {
    const items = [hit({ isPr: true, n: 1 }), hit({ isPr: true, n: 2 }), hit({ isPr: true, n: 3 })];
    const fetchItems = makeGithubFetchItems({ pageCap: 2, searchIssues: search({ items }) });
    expect(unwrap(await fetchItems({ repo, window })).items).toHaveLength(2);
  });

  it("fails fast with a clear message when the repo precheck reports the repo unreachable", async () => {
    let searched = false;
    const fetchItems = makeGithubFetchItems({
      checkRepo: async () => err(GithubFetchErrors.repoNotFound({ owner: "o", repo: "r" })),
      searchIssues: async () => {
        searched = true;
        return { data: { items: [] } };
      },
    });
    const result = await fetchItems({ repo, window });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe("repo o/r not found or inaccessible — check the org slug");
    expect(searched).toBe(false); // precheck short-circuits BEFORE any search call
  });

  it("proceeds to search when the repo precheck passes", async () => {
    const fetchItems = makeGithubFetchItems({
      checkRepo: async () => ok(undefined),
      searchIssues: search({ items: [hit({ isPr: true, n: 1 })] }),
    });
    expect(unwrap(await fetchItems({ repo, window })).items.map((i) => i.number)).toEqual([1]);
  });
});

describe("enrichFailureWarnings", () => {
  it("is empty when every item enriched", () => {
    expect(enrichFailureWarnings({ failed: 0, firstError: "ignored", total: 11 })).toEqual([]);
  });

  it("names the count, the population and the first cause", () => {
    expect(enrichFailureWarnings({ failed: 11, firstError: "Field 'nope' doesn't exist", total: 11 })).toEqual([
      "11 of 11 item(s) shipped WITHOUT activity (no reviews, comments or state) — first: Field 'nope' doesn't exist",
    ]);
  });

  it("still names the count when there is no cause to quote", () => {
    expect(enrichFailureWarnings({ failed: 2, firstError: undefined, total: 11 })).toEqual([
      "2 of 11 item(s) shipped WITHOUT activity (no reviews, comments or state)",
    ]);
  });
});

describe("a selection set the whole population rejects is never silent", () => {
  it("relays one warning naming how many items shipped bare, and why", async () => {
    // The witness for the widened selection set. A query naming one field GitHub does not have fails EVERY
    // item identically, and the old lane swallowed each failure — so a refetch of 4,458 items would report a
    // clean number while writing a bare atom for every one of them.
    const fetchItems = makeGithubFetchItems({
      fetchActivity: async ({ number }) =>
        err(GithubActivityErrors.fetchFailed({ cause: new Error("Field 'headRefOid' doesn't exist"), number })),
      searchIssues: search({ items: [hit({ isPr: true, n: 1 }), hit({ isPr: true, n: 2 })] }),
    });
    const { warnings } = unwrap(await fetchItems({ repo, window }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!).toContain("2 of 2 item(s) shipped WITHOUT activity");
    expect(warnings[0]!).toContain("Field 'headRefOid' doesn't exist");
  });

  it("says nothing when every item enriched — so the line's presence is the signal", async () => {
    const fetchItems = makeGithubFetchItems({
      fetchActivity: async () => ok(activityStub),
      searchIssues: search({ items: [hit({ isPr: true, n: 1 })] }),
    });
    expect(unwrap(await fetchItems({ repo, window })).warnings).toEqual([]);
  });
});

describe("searchCapWarnings", () => {
  it("is empty when the window was exhausted", () => {
    expect(searchCapWarnings({ cap: 1000, truncated: false })).toEqual([]);
  });

  it("names the ceiling and the fix when the window was truncated", () => {
    expect(searchCapWarnings({ cap: 1000, truncated: true })).toEqual([
      "window hit GitHub's 1000-result search ceiling — items beyond it were NOT fetched; split the window (--since/--until) and run again",
    ]);
  });
});

describe("a window at GitHub's search ceiling says so", () => {
  const fullPage = (): readonly unknown[] => Array.from({ length: 100 }, (_unused, i) => hit({ isPr: true, n: i + 1 }));

  it("warns when paging stopped at the cap with a full page", async () => {
    const fetchItems = makeGithubFetchItems({
      pageCap: 200,
      searchIssues: async () => ({ data: { items: fullPage() } }),
    });
    const { items, warnings } = unwrap(await fetchItems({ repo, window }));
    expect(items).toHaveLength(200);
    expect(warnings).toEqual([
      "window hit GitHub's 200-result search ceiling — items beyond it were NOT fetched; split the window (--since/--until) and run again",
    ]);
  });

  it("says nothing when a short page proved the window exhausted", async () => {
    const fetchItems = makeGithubFetchItems({ searchIssues: search({ items: [hit({ isPr: true, n: 1 })] }) });
    expect(unwrap(await fetchItems({ repo, window })).warnings).toEqual([]);
  });

  it("warns when the ten-page walk runs out with every page full", async () => {
    const fetchItems = makeGithubFetchItems({
      pageCap: 5000,
      searchIssues: async () => ({ data: { items: fullPage() } }),
    });
    const { items, warnings } = unwrap(await fetchItems({ repo, window }));
    expect(items).toHaveLength(1000);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!).toContain("5000-result search ceiling");
  });
});
