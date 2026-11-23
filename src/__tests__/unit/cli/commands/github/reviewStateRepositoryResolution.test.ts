/**
 * `github review-state` refuses a requested repository GitHub cannot resolve rather than printing `0 of 0 open`.
 *
 * The fleet read is a `search`, and GitHub answers an unresolvable `repo:` qualifier with an empty list and no
 * error, so before this gate `github review-state --repo <a typo>` exited 0 with an empty table
 * (`src/cli/commands/github/reviewStateRepositories.ts`). Every case here runs the real shell over plain fakes.
 */
import { describe, expect, it } from "vitest";

import { parseGithubReviewStateArgs } from "../../../../../cli/commands/github/reviewStateCore.js";
import { readProvenSelection } from "../../../../../cli/commands/github/reviewStateRepositories.js";
import { runGithubReviewState } from "../../../../../cli/commands/github/reviewStateRun.js";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import { harness, pr, RATE_LIMITED } from "./reviewStateRun/harness.js";

const GHOST_LINE =
  "github review-state: GitHub could not resolve repository acme/ghost — it may not exist or this credential " +
  "cannot read it, so its zero open pull requests are not a reading; check the slug";

describe("github review-state over a repository no row came back from", () => {
  it("refuses with exit 1 and no table when GitHub cannot resolve it, reading nothing past the fleet", async () => {
    const h = harness({
      pages: [{ nextCursor: undefined, pullRequests: [], totalCount: 0 }],
      resolutions: new Map([
        ["acme/ghost", err(GithubLiveErrors.notFound({ identity: "acme/ghost", kind: "repository" }))],
      ]),
    });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "acme/ghost"] });

    expect(code).toBe(1);
    expect(h.resolutionAskedFor).toEqual(["acme/ghost"]);
    expect(h.diagnostics).toEqual([GHOST_LINE]);
    expect(h.out).toEqual([]);
    expect(h.downstream).toEqual([]);
  });

  it("prints the empty table and exits 0 when GitHub resolves it — nothing open is then a reading", async () => {
    const h = harness({ pages: [{ nextCursor: undefined, pullRequests: [], totalCount: 0 }] });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "acme/quiet"] });

    expect(code).toBe(0);
    expect(h.resolutionAskedFor).toEqual(["acme/quiet"]);
    expect(h.out.at(-1)).toBe("0 of 0 open · ");
    expect(h.downstream).toEqual(["roster"]);
  });

  it("never asks about a repository a row came back from", async () => {
    const h = harness({
      pages: [{ nextCursor: undefined, pullRequests: [pr({ repoSlug: "acme/widgets" })], totalCount: 1 }],
    });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "ACME/widgets"] });

    expect(code).toBe(0);
    expect(h.resolutionAskedFor).toEqual([]);
    expect(h.out[3]).toBe("1 of 1 open · send-ask 1");
  });

  it("never asks about a repository whose only row `--limit` dropped from the table", async () => {
    const h = harness({
      pages: [
        {
          nextCursor: undefined,
          pullRequests: [pr({ number: 1, repoSlug: "acme/widgets" }), pr({ number: 2, repoSlug: "acme/gadgets" })],
          totalCount: 2,
        },
      ],
      resolutions: new Map([
        ["acme/gadgets", err(GithubLiveErrors.rateLimited({ message: RATE_LIMITED, resetAt: undefined }))],
      ]),
    });

    const code = await runGithubReviewState({
      deps: h.deps,
      rest: ["--repo", "acme/widgets,acme/gadgets", "--limit", "1"],
    });

    expect(code).toBe(0);
    expect(h.resolutionAskedFor).toEqual([]);
    expect(h.diagnostics.at(-1)).toBe("2 pull requests matched and 1 were read — raise --limit to see the rest");
  });

  it("never asks after a `--number` read, whose own success proves the repository, whatever slug it reports", async () => {
    const h = harness({
      pages: [{ nextCursor: undefined, pullRequests: [pr({ number: 1, repoSlug: "acme/renamed" })], totalCount: 1 }],
      resolutions: new Map([
        ["acme/widgets", err(GithubLiveErrors.notFound({ identity: "acme/widgets", kind: "repository" }))],
      ]),
    });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "acme/widgets", "--number", "1"] });

    expect(code).toBe(0);
    expect(h.resolutionAskedFor).toEqual([]);
  });

  it("refuses, carrying the provider's message, when the resolution itself could not be read", async () => {
    const h = harness({
      pages: [{ nextCursor: undefined, pullRequests: [], totalCount: 0 }],
      resolutions: new Map([
        ["acme/quiet", err(GithubLiveErrors.rateLimited({ message: RATE_LIMITED, resetAt: undefined }))],
      ]),
    });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "acme/quiet"] });

    expect(code).toBe(1);
    expect(h.diagnostics).toEqual([
      "github review-state: repository acme/quiet could not be verified, so its zero open pull requests are not a " +
        `reading — ${RATE_LIMITED} (rate limited; GitHub named no reset)`,
    ]);
    expect(h.out).toEqual([]);
  });

  it("asks every empty repository and names only the unresolved one when another repository had rows", async () => {
    const h = harness({
      pages: [{ nextCursor: undefined, pullRequests: [pr({ repoSlug: "acme/widgets" })], totalCount: 1 }],
      resolutions: new Map([
        ["acme/ghost", err(GithubLiveErrors.notFound({ identity: "acme/ghost", kind: "repository" }))],
      ]),
    });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "acme/ghost,acme/widgets,acme/quiet"] });

    expect(code).toBe(1);
    expect(h.resolutionAskedFor).toEqual(["acme/ghost", "acme/quiet"]);
    expect(h.diagnostics).toEqual([GHOST_LINE]);
    expect(h.out).toEqual([]);
  });
});

describe("readProvenSelection", () => {
  it("asks nothing, and keeps the empty read, for a caller that names no refusing verb", async () => {
    const h = harness({
      pages: [{ nextCursor: undefined, pullRequests: [], totalCount: 0 }],
      resolutions: new Map([
        ["acme/ghost", err(GithubLiveErrors.notFound({ identity: "acme/ghost", kind: "repository" }))],
      ]),
    });
    const args = unwrap(parseGithubReviewStateArgs({ rest: ["--repo", "acme/ghost"] }));

    const read = await readProvenSelection({
      api: h.deps.api({ home: undefined }),
      args,
      deps: h.deps,
      verb: undefined,
    });

    expect(unwrap(read)).toEqual({ prs: [], total: 0 });
    expect(h.resolutionAskedFor).toEqual([]);
  });

  it("refuses before the fleet read when no repository was typed and the checkout names none", async () => {
    const h = harness({ pages: [] });
    const args = unwrap(parseGithubReviewStateArgs({ rest: [] }));
    const deps = { ...h.deps, resolveRepo: () => err(["this checkout has no GitHub remote"]) };

    const read = await readProvenSelection({
      api: h.deps.api({ home: undefined }),
      args,
      deps,
      verb: "github review-state",
    });

    expect(unwrapErr(read)).toEqual(["this checkout has no GitHub remote"]);
    expect(h.pageSizes).toEqual([]);
  });
});
