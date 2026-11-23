/**
 * The durable per-container commit seams on the Linear and GitHub connectors — the probe this handover's
 * claim rests on.
 *
 * What each case has to be able to FAIL on is the same property stated three ways: a connector that went
 * back to buffering its whole window and writing once at the end would offer the sink nothing, and a
 * connector that committed AND re-offered the same records would double them in the run's counts. So every
 * case asserts BOTH halves — what the sink was offered, and what the caller was left holding. Asserting only
 * that the bulk batch came back empty is true of a fetch that found nothing, which is the shape
 * `.claude/rules/testing.md` calls a witness that is not falsifiable.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Repository } from "../../../config.js";
import type { GithubActivity } from "../../../corpus/github/activity.js";
import { GithubFetchErrors } from "../../../corpus/github/errors.js";
import {
  type FetchGithubItems,
  type GithubItemsCommit,
  makeGithubFetchItems,
  type SearchIssues,
} from "../../../corpus/github/fetch.js";
import { fetchOrgActivity, type OrgRepoCommit } from "../../../corpus/github/orgActivity.js";
import type { GithubExportItem } from "../../../corpus/github/project.js";
import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import { ingestSources } from "../../../corpus/ingestSource.js";
import type { LinearApi, LinearIssuesPage, LinearProjectsPage } from "../../../corpus/linear/apiTypes.js";
import {
  collectLinearIssues,
  collectLinearProjects,
  type LinearPageCommit,
} from "../../../corpus/linear/fetchCollect.js";
import type { LinearIssueItem, LinearProjectItem } from "../../../corpus/linear/items.js";
import { readWatermark } from "../../../corpus/watermark.js";
import { err, ok, type Result, unwrap } from "../../../lib/result.js";

const WINDOW = { since: "2026-06-01", until: "2026-07-24" };

// Every fixture directory this file has minted, so `afterEach` can remove it. The ambient home is never
// written: each ingest case passes its own `home` explicitly (`.claude/rules/testing.md`).
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-durable-"));
  fixtureDirs.push(root);
  return join(root, "home");
}

/* ------------------------------------------------------------------ GitHub org mode */

function githubItem({ number, tsIso }: { number: number; tsIso: string }): GithubExportItem {
  return {
    kind: "issue",
    number,
    raw: { number },
    title: `#${String(number)}`,
    tsIso,
    url: `https://x/${String(number)}`,
  };
}

/** The thinnest enrichment payload the GraphQL seam can honestly return: an open item with no events. */
const EMPTY_ACTIVITY: GithubActivity = {
  comments: [],
  reviews: [],
  state: "OPEN",
  timeline: [],
  truncated: [],
  updatedAtIso: "2026-07-01T00:00:00.000Z",
};

const REPOS: readonly Repository[] = [
  { owner: "acme", repo: "app" },
  { owner: "acme", repo: "lib" },
];

/** A fake per-repo fetch serving seeded items, or a hard search failure for a named repo. */
function fakeOrgFetch({
  itemsByRepo,
  failRepos = new Set<string>(),
}: {
  itemsByRepo: Readonly<Record<string, readonly GithubExportItem[]>>;
  failRepos?: ReadonlySet<string>;
}): FetchGithubItems {
  return async ({ repo }) => {
    const key = `${repo.owner}/${repo.repo}`;
    if (failRepos.has(key)) {
      return err(GithubFetchErrors.searchFailed({ cause: new Error(`repo ${key} search failed`) }));
    }
    const seeded = itemsByRepo[key];
    if (seeded === undefined) {
      return ok({ items: [], warnings: [] });
    }
    return ok({ items: seeded, warnings: [] });
  };
}

/**
 * A recording commit sink.
 *
 * Its two failure modes are deliberately separate, because the production seam's are: `failRepos` is a
 * BRONZE WRITE that missed, so nothing is banked; `cursorFailRepos` is a repo whose rows landed and whose
 * CURSOR would not persist, which is still banked.
 */
function recordingRepoSink({
  banked,
  failRepos = new Set<string>(),
  cursorFailRepos = new Set<string>(),
}: {
  banked: { repoKey: string; count: number }[];
  failRepos?: ReadonlySet<string>;
  cursorFailRepos?: ReadonlySet<string>;
}): OrgRepoCommit {
  return ({ records, repoKey }) => {
    if (failRepos.has(repoKey)) {
      return { banked: false, warnings: [`repo ${repoKey}: bronze commit failed: disk full`] };
    }
    banked.push({ count: records.length, repoKey });
    if (cursorFailRepos.has(repoKey)) {
      return { banked: true, warnings: [`per-repo watermark persist failed for ${repoKey}: read-only`] };
    }
    return { banked: true, warnings: [] };
  };
}

describe("fetchOrgActivity — the repo is the durable container", () => {
  it("banks EVERY fetched repo as it lands, and hands the closing write nothing it banked", async () => {
    const banked: { repoKey: string; count: number }[] = [];
    const activity = await fetchOrgActivity({
      concurrency: 2,
      fetchItems: fakeOrgFetch({
        itemsByRepo: {
          "acme/app": [githubItem({ number: 1, tsIso: "2026-07-01T00:00:00.000Z" })],
          "acme/lib": [githubItem({ number: 2, tsIso: "2026-07-02T00:00:00.000Z" })],
        },
      }),
      onRepoCommit: recordingRepoSink({ banked }),
      ratePerSec: 1000,
      repoCursors: new Map(),
      repos: REPOS,
      window: WINDOW,
    });

    // The sink was OFFERED both repos' records — the half that fails if the connector goes back to buffering.
    expect(banked.map((entry) => entry.repoKey).toSorted()).toEqual(["acme/app", "acme/lib"]);
    expect(banked.every((entry) => entry.count > 0)).toBe(true);
    // And the caller is left holding nothing, so `ingestSource` cannot count those records a second time.
    expect(activity.records).toEqual([]);
    // Nor any advance: each banked repo's cursor was written the instant its commit landed.
    expect(activity.advances).toEqual([]);
  });

  it("offers a FAILED repo nothing, and still withholds its advance so the next run re-reads it", async () => {
    const banked: { repoKey: string; count: number }[] = [];
    const activity = await fetchOrgActivity({
      concurrency: 2,
      fetchItems: fakeOrgFetch({
        failRepos: new Set(["acme/lib"]),
        itemsByRepo: { "acme/app": [githubItem({ number: 1, tsIso: "2026-07-01T00:00:00.000Z" })] },
      }),
      onRepoCommit: recordingRepoSink({ banked }),
      ratePerSec: 1000,
      repoCursors: new Map(),
      repos: REPOS,
      window: WINDOW,
    });

    expect(banked.map((entry) => entry.repoKey)).toEqual(["acme/app"]);
    expect(activity.advances).toEqual([]);
    expect(activity.warnings.some((line) => line.includes("acme/lib"))).toBe(true);
  });

  it("falls back to the closing write when a repo's own COMMIT fails — it has no other route to disk", async () => {
    const banked: { repoKey: string; count: number }[] = [];
    const activity = await fetchOrgActivity({
      concurrency: 2,
      fetchItems: fakeOrgFetch({
        itemsByRepo: { "acme/lib": [githubItem({ number: 2, tsIso: "2026-07-02T00:00:00.000Z" })] },
      }),
      onRepoCommit: recordingRepoSink({ banked, failRepos: new Set(["acme/lib"]) }),
      ratePerSec: 1000,
      repoCursors: new Map(),
      repos: REPOS,
      window: WINDOW,
    });

    expect(banked).toEqual([{ count: 0, repoKey: "acme/app" }]);
    expect(activity.records.length).toBeGreaterThan(0);
    expect(activity.records.every((record) => record.container === "acme/lib")).toBe(true);
    // The failed repo is back on the pooled advance list, because its commit wrote no cursor of its own.
    expect(activity.advances.map((advance) => advance.repo)).toEqual(["acme/lib"]);
    expect(activity.warnings.some((line) => line.includes("bronze commit failed"))).toBe(true);
  });

  // The counting bug this pins: collapsing "bronze write failed" and "cursor persist failed" into one
  // warnings list made a repo whose rows WERE on disk fall back to the closing write, so every one of its
  // records was counted once in `committedPerContainer` and again as a dedup — a clean run reporting half
  // its work as a re-fetch.
  it("keeps a repo BANKED when only its cursor would not persist, and still says so", async () => {
    const banked: { repoKey: string; count: number }[] = [];
    const activity = await fetchOrgActivity({
      concurrency: 2,
      fetchItems: fakeOrgFetch({
        itemsByRepo: { "acme/app": [githubItem({ number: 1, tsIso: "2026-07-01T00:00:00.000Z" })] },
      }),
      onRepoCommit: recordingRepoSink({ banked, cursorFailRepos: new Set(["acme/app"]) }),
      ratePerSec: 1000,
      repoCursors: new Map(),
      repos: REPOS,
      window: WINDOW,
    });

    expect(banked.map((entry) => entry.repoKey).toSorted()).toEqual(["acme/app", "acme/lib"]);
    // Banked rows are NEVER re-offered, whatever else the commit reported.
    expect(activity.records).toEqual([]);
    expect(activity.advances).toEqual([]);
    expect(activity.warnings.some((line) => line.includes("watermark persist failed"))).toBe(true);
  });

  it("without a sink behaves exactly as before: every record returned, every repo advanced", async () => {
    const activity = await fetchOrgActivity({
      concurrency: 2,
      fetchItems: fakeOrgFetch({
        itemsByRepo: { "acme/app": [githubItem({ number: 1, tsIso: "2026-07-01T00:00:00.000Z" })] },
      }),
      ratePerSec: 1000,
      repoCursors: new Map(),
      repos: REPOS,
      window: WINDOW,
    });

    expect(activity.records.length).toBeGreaterThan(0);
    expect(activity.advances.map((advance) => advance.repo).toSorted()).toEqual(["acme/app", "acme/lib"]);
  });
});

/* ------------------------------------------------------- GitHub single repo, mid-crawl */

/** A search seam serving one page of `count` hits, then a short page. */
function fakeSearch({ count }: { count: number }): SearchIssues {
  return async ({ page }) => {
    if (page > 1) {
      return { data: { items: [] } };
    }
    const items = Array.from({ length: count }, (_unused, index) => ({
      html_url: `https://x/${String(index)}`,
      number: index + 1,
      title: `#${String(index + 1)}`,
      updated_at: "2026-07-01T00:00:00.000Z",
    }));
    return { data: { items } };
  };
}

/** A recording batch sink: banks every batch offered to it. */
function recordingBatchSink({ batches }: { batches: number[][] }): GithubItemsCommit {
  return ({ items }) => {
    batches.push(items.map((item) => item.number));
    return ok({ written: items.length });
  };
}

describe("makeGithubFetchItems — the enrichment loop banks as it goes", () => {
  it("flushes every 25 enriched items, plus the remainder, and returns nothing it banked", async () => {
    const batches: number[][] = [];
    const fetched = await makeGithubFetchItems({
      fetchActivity: async () => ok(EMPTY_ACTIVITY),
      onBatch: recordingBatchSink({ batches }),
      searchIssues: fakeSearch({ count: 60 }),
    })({ repo: { owner: "acme", repo: "app" }, window: WINDOW });

    expect(fetched.isOk()).toBe(true);
    // Three flushes: 25, 25, then the 10 left over when the loop ended.
    expect(batches.map((batch) => batch.length)).toEqual([25, 25, 10]);
    // Every discovered item was offered exactly once, in discovery order.
    expect(batches.flat()).toEqual(Array.from({ length: 60 }, (_unused, index) => index + 1));
    expect(unwrap(fetched).items).toEqual([]);
  });

  it("retains a batch whose COMMIT failed, and says so, rather than losing it", async () => {
    const fetched = await makeGithubFetchItems({
      fetchActivity: async () => ok(EMPTY_ACTIVITY),
      onBatch: () => err(["disk full"]),
      searchIssues: fakeSearch({ count: 3 }),
    })({ repo: { owner: "acme", repo: "app" }, window: WINDOW });

    const value = unwrap(fetched);
    expect(value.items.map((item) => item.number)).toEqual([1, 2, 3]);
    expect(value.warnings.some((line) => line.includes("batch commit failed"))).toBe(true);
  });

  it("without a sink returns every enriched item, exactly as it did before the seam existed", async () => {
    const fetched = await makeGithubFetchItems({
      fetchActivity: async () => ok(EMPTY_ACTIVITY),
      searchIssues: fakeSearch({ count: 30 }),
    })({ repo: { owner: "acme", repo: "app" }, window: WINDOW });

    expect(unwrap(fetched).items.map((item) => item.number)).toEqual(
      Array.from({ length: 30 }, (_unused, index) => index + 1),
    );
  });
});

/* ------------------------------------------------------------------------- Linear */

function linearIssue({ identifier }: { identifier: string }): LinearIssueItem {
  return {
    comments: [],
    identifier,
    labels: [],
    title: identifier,
    tsIso: "2026-07-01T00:00:00.000Z",
    url: `https://linear.app/${identifier}`,
  };
}

function linearProject({ id }: { id: string }): LinearProjectItem {
  return { id, name: id, tsIso: "2026-07-02T00:00:00.000Z", url: `https://linear.app/p/${id}` };
}

/** A whole `LinearApi` serving `pages` pages of one item each on both walking lanes, then stopping. */
function fakeLinearApi({ pages }: { pages: number }): LinearApi {
  const issues = async ({ cursor }: { cursor?: string }): Promise<LinearIssuesPage> => {
    const index = cursor === undefined ? 0 : Number(cursor);
    return {
      historyRows: [],
      issues: [linearIssue({ identifier: `ENG-${String(index + 1)}` })],
      ...(index + 1 < pages ? { nextCursor: String(index + 1) } : {}),
    };
  };
  const projects = async ({ cursor }: { cursor?: string }): Promise<LinearProjectsPage> => {
    const index = cursor === undefined ? 0 : Number(cursor);
    return {
      projects: [linearProject({ id: `P-${String(index + 1)}` })],
      ...(index + 1 < pages ? { nextCursor: String(index + 1) } : {}),
    };
  };
  return { issues, projects, users: async () => ({ nodes: [] }) };
}

/** A recording page sink: banks each page offered to it, or fails on command. */
function recordingPageSink({
  pages,
  failing = false,
}: {
  pages: { issues: readonly string[]; projects: readonly string[] }[];
  failing?: boolean;
}): LinearPageCommit {
  return ({ issues, projects }): Result<{ written: number }> => {
    if (failing) {
      return err(["disk full"]);
    }
    pages.push({
      issues: issues.map((issue) => issue.identifier),
      projects: projects.map((project) => project.id),
    });
    return ok({ written: issues.length + projects.length });
  };
}

describe("the Linear lanes — the page is the durable container", () => {
  it("banks each ISSUES page as it lands and returns nothing it banked", async () => {
    const pages: { issues: readonly string[]; projects: readonly string[] }[] = [];
    const collected = await collectLinearIssues({
      api: fakeLinearApi({ pages: 3 }),
      onPage: recordingPageSink({ pages }),
      since: WINDOW.since,
    });

    expect(pages.map((page) => page.issues)).toEqual([["ENG-1"], ["ENG-2"], ["ENG-3"]]);
    // Every page carried ONLY its own lane, so one committer serves both walks without crossing them.
    expect(pages.every((page) => page.projects.length === 0)).toBe(true);
    expect(collected.issues).toEqual([]);
  });

  it("banks each PROJECTS page on the same seam, on the other side of the page shape", async () => {
    const pages: { issues: readonly string[]; projects: readonly string[] }[] = [];
    const collected = await collectLinearProjects({
      api: fakeLinearApi({ pages: 2 }),
      onPage: recordingPageSink({ pages }),
      since: WINDOW.since,
    });

    expect(pages.map((page) => page.projects)).toEqual([["P-1"], ["P-2"]]);
    expect(pages.every((page) => page.issues.length === 0)).toBe(true);
    expect(collected.projects).toEqual([]);
  });

  it("retains a page whose COMMIT failed, and says so, rather than losing it", async () => {
    const collected = await collectLinearIssues({
      api: fakeLinearApi({ pages: 2 }),
      onPage: recordingPageSink({ failing: true, pages: [] }),
      since: WINDOW.since,
    });

    expect(collected.issues.map((issue) => issue.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(collected.warnings.some((line) => line.includes("page commit failed"))).toBe(true);
  });

  it("without a sink returns every page, exactly as it did before the seam existed", async () => {
    const collected = await collectLinearIssues({
      api: fakeLinearApi({ pages: 3 }),
      since: WINDOW.since,
    });

    expect(collected.issues.map((issue) => issue.identifier)).toEqual(["ENG-1", "ENG-2", "ENG-3"]);
  });
});

/* ------------------------------------------------------ the counts, which is where this breaks */

describe("ingestSources — a run that banked everything is not an empty run", () => {
  it("sums the banked half into projected/written and does NOT jump the cursor to the window end", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "linear",
      run: async () =>
        ok({
          // Everything reached bronze container by container, so the closing write is handed nothing.
          committedCursor: "2026-07-02T00:00:00.000Z",
          committedPerContainer: 7,
          projectedPerContainer: 9,
          records: [],
          warnings: [],
        }),
      source: "linear",
      window: WINDOW,
    };

    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;

    expect(result.ok).toBe(true);
    expect(result.projected).toBe(9);
    expect(result.written).toBe(7);
    expect(result.deduped).toBe(2);
    // The cursor follows what was actually banked, not the window end — the difference between resuming
    // where the crawl really got to and stepping over everything it never read.
    expect(readWatermark({ home, source: "linear" })).toBe("2026-07-02T00:00:00.000Z");
  });

  it("reports a lane that banked NOTHING exactly as before — silence still means the write-once path", async () => {
    const home = tempHome();
    const job: SourceIngestJob = {
      label: "linear",
      run: async () => ok({ records: [], warnings: [] }),
      source: "linear",
      window: WINDOW,
    };

    const result = unwrap(await ingestSources({ home, jobs: [job] }))[0]!;

    expect(result.projected).toBe(0);
    expect(result.written).toBe(0);
    expect(readWatermark({ home, source: "linear" })).toBe(WINDOW.until);
  });
});
