/**
 * INTEGRATION test: the GitHub OUTBOUND ingest seams against the REAL GitHub API, recorded + replayed via a
 * Polly cassette (see `src/__tests__/setup-polly.ts` + `cassetteScrub.ts`). Unlike the `claude` lane there is
 * NO gateway: `@octokit/rest` v22 issues its HTTP through the undici global `fetch`, which Polly's fetch
 * adapter intercepts in-process directly.
 *
 * Two seams, two HTTP mechanisms:
 *   - discovery — `githubFetchItems` → REST `search/issues` + `repos.get` (distinct paths, method+path match)
 *   - enrichment — `makeFetchGithubActivity` → the GraphQL `/graphql` lane (normalised-body match)
 *
 * Recorded against `octocat/Hello-World` (GitHub's canonical public demo repo — no private data) over a fixed
 * historical window so the recording is small + stable. Run:
 *   yarn test:integration                                                     # replay (default, offline)
 *   POLLY_MODE=record SLOPWEAVER_RECORD_GITHUB_TOKEN=<tok> yarn test:integration   # (re)record
 */
import { describe, expect, it } from "vitest";
import type { Repository } from "../../config.js";
import { makeFetchGithubActivity } from "../../corpus/github/activity.js";
import { githubFetchItems } from "../../corpus/github/fetch.js";
import { makeGithubClient } from "../../corpus/github/githubClient.js";
import { projectGithubRecords } from "../../corpus/github/project.js";
import { unwrap } from "../../lib/result.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/** The token to record with (real GitHub token); in replay a dummy stands in (auth header is redacted). */
function githubToken(): string {
  if (!RECORD) {
    return "dummy-replay-token-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_GITHUB_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_GITHUB_TOKEN to record the GitHub cassette");
  }
  return token;
}

const REPO: Repository = { owner: "octocat", repo: "Hello-World" };
const CONTAINER = "octocat/Hello-World";
// A fixed one-day historical window (7 items at record time) — small + stable across re-records.
const WINDOW = { since: "2024-01-01", until: "2024-01-02" };

describe("github outbound (integration — real GitHub via Polly cassette)", () => {
  it("discovers in-window items via REST and projects them into corpus records", async () => {
    const fetchItems = githubFetchItems({ enrich: false, token: githubToken() });
    const { items } = unwrap(await fetchItems({ repo: REPO, window: WINDOW }));

    // The recorded window returns a fixed set the parser keeps in full.
    expect(items).toHaveLength(7);
    expect(items.every((i) => i.number > 0)).toBe(true);
    expect(items.every((i) => i.title.length > 0)).toBe(true);
    expect(items.every((i) => i.url.startsWith("https://github.com/"))).toBe(true);
    expect(items.every((i) => i.kind === "pr" || i.kind === "issue")).toBe(true);

    // Projection fans each item into at least its atom, all stamped github/container.
    const records = projectGithubRecords({ items, repo: CONTAINER });
    expect(records.length).toBeGreaterThanOrEqual(items.length);
    expect(records.every((r) => r.source === "github")).toBe(true);
    expect(records.every((r) => r.container === CONTAINER)).toBe(true);
    const atoms = records.filter((r) => r.kind === "pr" || r.kind === "issue");
    expect(atoms).toHaveLength(items.length);
  });

  it("enriches one item's activity via the GraphQL lane", async () => {
    const client = makeGithubClient({ token: githubToken() });
    const fetchActivity = makeFetchGithubActivity({ graphql: (query, variables) => client.graphql(query, variables) });

    // One recorded item is an OPEN issue in the recorded window; the activity lane parses its lifecycle state, and an
    // issue carries no reviews/comments in this recording.
    const activity = unwrap(await fetchActivity({ isPr: false, number: 2884, repo: REPO }));
    expect(activity.state).toBe("OPEN");
    expect(activity.updatedAtIso).toBe("2024-01-02T23:53:48Z");
    expect(activity.comments).toHaveLength(0);
    expect(activity.reviews).toHaveLength(0);
  });
});
