import { describe, expect, it } from "vitest";
import type { Repository } from "../../../../config.js";
import { GithubFetchErrors } from "../../../../corpus/github/errors.js";
import type { FetchGithubItems } from "../../../../corpus/github/fetch.js";
import { fetchOrgActivity } from "../../../../corpus/github/orgActivity.js";
import type { GithubExportItem } from "../../../../corpus/github/project.js";
import { err, ok } from "../../../../lib/result.js";

const WINDOW = { since: "2026-06-01", until: "2026-07-24" };

function item({ number, tsIso }: { number: number; tsIso: string }): GithubExportItem {
  return {
    kind: "issue",
    number,
    raw: { number },
    title: `#${String(number)}`,
    tsIso,
    url: `https://x/${String(number)}`,
  };
}

/** A fake per-repo fetch that records each call's window + serves seeded items (or an error) per repo. */
function fakeFetch({
  itemsByRepo,
  failRepos = new Set<string>(),
  calls,
}: {
  itemsByRepo: Readonly<Record<string, readonly GithubExportItem[]>>;
  failRepos?: ReadonlySet<string>;
  calls: { repo: string; since: string }[];
}): FetchGithubItems {
  return async ({ repo, window }) => {
    const key = `${repo.owner}/${repo.repo}`;
    calls.push({ repo: key, since: window.since });
    if (failRepos.has(key)) {
      return err(GithubFetchErrors.searchFailed({ cause: new Error(`repo ${key} search failed`) }));
    }
    // Every fetched repo is seeded, an empty one with `[]`: an unseeded key is a fixture typo, never "no items".
    const items = itemsByRepo[key];
    if (items === undefined) {
      throw new Error(`fakeFetch: no items seeded for ${key}`);
    }
    return ok({ items, warnings: [] });
  };
}

const REPOS: readonly Repository[] = [
  { owner: "acme", repo: "app" },
  { owner: "acme", repo: "lib" },
];

/** Both {@link REPOS} seeded, each fetched with nothing in its window. */
const NO_ITEMS: Readonly<Record<string, readonly GithubExportItem[]>> = { "acme/app": [], "acme/lib": [] };

describe("fetchOrgActivity", () => {
  it("windows each repo from its OWN cursor (a re-run resumes past what it already saw)", async () => {
    const calls: { repo: string; since: string }[] = [];
    await fetchOrgActivity({
      concurrency: 2,
      fetchItems: fakeFetch({ calls, itemsByRepo: NO_ITEMS }),
      ratePerSec: 1000,
      repoCursors: new Map([["acme/app", "2026-07-10T00:00:00.000Z"]]),
      repos: REPOS,
      window: WINDOW,
    });
    expect(calls.find((c) => c.repo === "acme/app")!.since).toBe("2026-07-10");
    expect(calls.find((c) => c.repo === "acme/lib")!.since).toBe("2026-06-01");
  });

  // PR5.4: a present cursor wins UNCONDITIONALLY here — it is a fallback, not a floor. So the only way an
  // explicit `--since`/`--all`/`--lookback-days` can survive to the fetch is for the caller to WITHHOLD the
  // cursors. This is the path `runGithubOrgActivity` takes when `cursorOverridden` is set; without it, a
  // deep backfill silently re-fetched nothing across every repo that had a cursor.
  it("windows every repo from the base window when the cursors are WITHHELD (the explicit-override path)", async () => {
    const calls: { repo: string; since: string }[] = [];
    await fetchOrgActivity({
      concurrency: 2,
      fetchItems: fakeFetch({ calls, itemsByRepo: NO_ITEMS }),
      ratePerSec: 1000,
      repoCursors: new Map(), // what the shell passes once an explicit window overrides the cursors
      repos: REPOS,
      window: { since: "2026-04-01", until: "2026-07-24" },
    });
    expect(calls.map((c) => c.since)).toEqual(["2026-04-01", "2026-04-01"]);
  });

  it("a cursor LATER than the base window still wins when cursors are supplied (incremental is unchanged)", async () => {
    const calls: { repo: string; since: string }[] = [];
    await fetchOrgActivity({
      concurrency: 2,
      fetchItems: fakeFetch({ calls, itemsByRepo: NO_ITEMS }),
      ratePerSec: 1000,
      repoCursors: new Map([
        ["acme/app", "2026-07-20T00:00:00.000Z"],
        ["acme/lib", "2026-07-21T00:00:00.000Z"],
      ]),
      repos: REPOS,
      window: { since: "2026-04-01", until: "2026-07-24" },
    });
    expect(calls.map((c) => c.since).toSorted()).toEqual(["2026-07-20", "2026-07-21"]);
  });

  it("combines records + advances each repo to its max tsIso (empty-but-fetched ⇒ `until`)", async () => {
    const result = await fetchOrgActivity({
      concurrency: 2,
      fetchItems: fakeFetch({
        calls: [],
        itemsByRepo: {
          "acme/app": [
            item({ number: 1, tsIso: "2026-07-02T00:00:00.000Z" }),
            item({ number: 2, tsIso: "2026-07-09T00:00:00.000Z" }),
          ],
          "acme/lib": [],
        },
      }),
      ratePerSec: 1000,
      repoCursors: new Map(),
      repos: REPOS,
      window: WINDOW,
    });
    expect(result.records).toHaveLength(2);
    expect(result.advances).toEqual([
      { cursor: "2026-07-09T00:00:00.000Z", repo: "acme/app" },
      { cursor: "2026-07-24", repo: "acme/lib" },
    ]);
  });

  it("emits a per-repo progress event naming the repo + its record yield", async () => {
    const events: { done: number; total: number; repo: string; recordCount: number }[] = [];
    await fetchOrgActivity({
      concurrency: 1, // serial so the done counter is deterministic
      fetchItems: fakeFetch({
        calls: [],
        itemsByRepo: { "acme/app": [item({ number: 1, tsIso: "2026-07-02T00:00:00.000Z" })], "acme/lib": [] },
      }),
      onProgress: (p) => events.push(p),
      ratePerSec: 1000,
      repoCursors: new Map(),
      repos: REPOS,
      window: WINDOW,
    });
    expect(events).toEqual([
      { done: 1, recordCount: 1, repo: "acme/app", total: 2 },
      { done: 2, recordCount: 0, repo: "acme/lib", total: 2 },
    ]);
  });

  it("isolates one repo's fetch failure as a warning and does NOT advance that repo", async () => {
    const result = await fetchOrgActivity({
      concurrency: 2,
      fetchItems: fakeFetch({
        calls: [],
        failRepos: new Set(["acme/lib"]),
        itemsByRepo: { "acme/app": [item({ number: 1, tsIso: "2026-07-02T00:00:00.000Z" })] },
      }),
      ratePerSec: 1000,
      repoCursors: new Map(),
      repos: REPOS,
      window: WINDOW,
    });
    expect(result.advances.map((a) => a.repo)).toEqual(["acme/app"]);
    expect(result.warnings).toContain("repo acme/lib: repo acme/lib search failed");
  });
});
