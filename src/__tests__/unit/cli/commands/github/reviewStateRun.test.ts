import { describe, expect, it } from "vitest";

import { parseGithubReviewStateArgs } from "../../../../../cli/commands/github/reviewStateCore.js";
import type { GithubReviewStateDeps } from "../../../../../cli/commands/github/reviewStateRun.js";
import { collectReviewStates, runGithubReviewState } from "../../../../../cli/commands/github/reviewStateRun.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { SlackLiveSearchErrors } from "../../../../../live/slack/searchErrors.js";
import { harness, pr, RATE_LIMITED, SEARCH_NULLED } from "./reviewStateRun/harness.js";

describe("runGithubReviewState", () => {
  it("prints a header, one row per pull request and a tally", async () => {
    const h = harness({ pages: [{ nextCursor: undefined, pullRequests: [pr()], totalCount: 1 }] });
    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });
    expect(code).toBe(0);
    expect(h.out[0]).toContain("PR");
    expect(h.out[1]).toContain("#1");
    expect(h.out[3]).toBe("1 of 1 open · send-ask 1");
  });

  it("falls back to the current checkout's own remote when no --repo is typed", async () => {
    const h = harness({ pages: [{ nextCursor: undefined, pullRequests: [], totalCount: 0 }] });
    await runGithubReviewState({ deps: h.deps, rest: [] });
    expect(h.queries).toEqual(["is:pr is:open sort:updated-desc repo:o/r draft:false"]);
  });

  it("pages until GitHub reports no cursor", async () => {
    const h = harness({
      pages: [
        { nextCursor: "c1", pullRequests: [pr({ number: 1 })], totalCount: 2 },
        { nextCursor: undefined, pullRequests: [pr({ number: 2 })], totalCount: 2 },
      ],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });
    expect(h.queries.length).toBe(2);
    expect(h.out[4]).toBe("2 of 2 open · send-ask 2");
  });

  // On a large repository, one run in twenty-two answered `search: null` at a page of twenty
  // and the whole roster read died on it, twice inside an hour on the vulnfix-topup recipe. The page is the
  // lever the expensive `statusCheckRollup` field leaves, and these three cases are the whole contract of
  // pulling it.
  it("halves the fleet page and retries the same read rather than losing the whole fleet", async () => {
    const h = harness({
      answersAtOrBelow: 10,
      pages: [{ nextCursor: undefined, pullRequests: [pr({ number: 1 }), pr({ number: 2 })], totalCount: 2 }],
    });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });

    expect(code).toBe(0);
    expect(h.pageSizes).toEqual([20, 10]);
    expect(h.out[4]).toBe("2 of 2 open · send-ask 2");
    expect(h.diagnostics).toContain(
      `the fleet read failed at a page of 20 pull requests and is retrying at 10: ${SEARCH_NULLED}`,
    );
  });

  it("keeps the reduced page for the rest of the read rather than re-paying the failure on every page", async () => {
    const h = harness({
      answersAtOrBelow: 5,
      pages: [
        { nextCursor: "c1", pullRequests: [pr({ number: 1 })], totalCount: 2 },
        { nextCursor: undefined, pullRequests: [pr({ number: 2 })], totalCount: 2 },
      ],
    });

    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });

    expect(h.pageSizes).toEqual([20, 10, 5, 5]);
    expect(h.queries.length).toBe(2);
  });

  it("ends the read with the PAGE's own message once a page of one still fails", async () => {
    const h = harness({
      answersAtOrBelow: 0,
      pages: [{ nextCursor: undefined, pullRequests: [pr()], totalCount: 1 }],
    });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });

    expect(code).toBe(1);
    expect(h.pageSizes).toEqual([20, 10, 5, 2, 1]);
    expect(h.out).toEqual([]);
    expect(h.diagnostics).toContain(
      `the fleet read failed at a page of ONE pull request, so no smaller request is left to try: ${SEARCH_NULLED}`,
    );
    expect(h.diagnostics).toContain(SEARCH_NULLED);
  });

  // Tick-close refreshes of the owner's list: 9 of 57 killed at 420s, the captured one on a halving
  // line. These cases are the budget's whole contract — see `reviewStateFleet.ts`'s header for the numbers.
  it("ends the read by name once the budget is spent, and never returns the pages it did read", async () => {
    const h = harness({
      declinedFromRequest: 1,
      fleetRequestMs: 30_000,
      pages: [{ nextCursor: "c1", pullRequests: [pr({ number: 1 })], totalCount: 46 }],
    });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });

    expect(code).toBe(1);
    expect(h.pageSizes).toEqual([20, 20, 10]);
    expect(h.out).toEqual([]);
    expect(h.diagnostics).toContain(
      `the fleet read stopped after 90s, past its 90s budget, at a page of 10 pull requests with 1 of 46 read: ${SEARCH_NULLED}`,
    );
  });

  it("refuses a page that answered at or after the deadline rather than accepting it", async () => {
    const h = harness({
      fleetRequestMs: 95_000,
      pages: [{ nextCursor: undefined, pullRequests: [pr()], totalCount: 1 }],
    });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });

    expect(code).toBe(1);
    expect(h.pageSizes).toEqual([20]);
    expect(h.out).toEqual([]);
    expect(h.diagnostics).toContain(
      "the fleet read stopped after 95s, past its 90s budget, at a page of 20 pull requests before any page answered: no page had failed before the budget ran out",
    );
  });

  it("caps each request at thirty seconds, and the last one at what the budget has left", async () => {
    const h = harness({
      fleetRequestMs: 22_000,
      pages: [
        { nextCursor: "c1", pullRequests: [pr({ number: 1 })], totalCount: 4 },
        { nextCursor: "c2", pullRequests: [pr({ number: 2 })], totalCount: 4 },
        { nextCursor: "c3", pullRequests: [pr({ number: 3 })], totalCount: 4 },
        { nextCursor: undefined, pullRequests: [pr({ number: 4 })], totalCount: 4 },
      ],
    });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });

    expect(code).toBe(0);
    expect(h.timeouts).toEqual([30_000, 30_000, 30_000, 24_000]);
    expect(h.out[6]).toBe("4 of 4 open · send-ask 4");
  });

  it("ends the read on a rate limit rather than halving into the same exhausted quota", async () => {
    const h = harness({ pages: [], rateLimited: true });

    const code = await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });

    expect(code).toBe(1);
    expect(h.pageSizes).toEqual([20]);
    expect(h.diagnostics).toContain(
      `the fleet read hit GitHub's rate limit, which a smaller page cannot help: ${RATE_LIMITED} (rate limited; GitHub named no reset)`,
    );
  });

  it("stops at --limit and says how many it did not read", async () => {
    const h = harness({
      pages: [{ nextCursor: "c1", pullRequests: [pr({ number: 1 }), pr({ number: 2 })], totalCount: 9 }],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r", "--limit", "1"] });
    expect(h.out[3]).toBe("1 of 9 open · send-ask 1");
    expect(h.diagnostics).toContain("9 pull requests matched and 1 were read — raise --limit to see the rest");
  });

  it("names the skipped live leg as residue when --no-slack-live is given", async () => {
    const h = harness({ pages: [{ nextCursor: undefined, pullRequests: [], totalCount: 0 }], slackLive: false });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r", "--no-slack-live"] });
    expect(h.diagnostics).toContain(
      "the live Slack search leg was skipped (--no-slack-live), so nothing posted since the watermark was seen beyond the thread under each channel post of the owner's",
    );
  });

  it("prints how stale the corpus is on EVERY run, since only it can decide a `no`", async () => {
    const h = harness({ pages: [{ nextCursor: undefined, pullRequests: [], totalCount: 0 }] });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });
    expect(h.diagnostics[0]).toBe(
      "only the Slack corpus can decide a `no`, and it reaches 2026-08-29T00:00:00Z — 36h behind this read. " +
        "Anything asked inside that gap reads as `unknown`; `slopweaver refresh --source slack` closes it",
    );
  });

  it("says no row can report `no` at all when Slack has never been ingested", async () => {
    const h = harness({ corpusIngested: false, pages: [{ nextCursor: undefined, pullRequests: [], totalCount: 0 }] });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });
    expect(h.diagnostics[0]).toBe(
      "the Slack corpus has never been ingested, so NO row here can report `no` — run `slopweaver refresh --source slack`",
    );
  });

  it("emits one JSON document carrying the coverage instead of the table", async () => {
    const h = harness({ pages: [{ nextCursor: undefined, pullRequests: [pr()], totalCount: 1 }] });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r", "--json"] });
    const parsed: unknown = JSON.parse(h.out[0]!);
    const document = parsed as { coverage: { corpusThroughIso: string; liveRan: boolean }; tally: string };
    expect(document.coverage.corpusThroughIso).toBe("2026-08-29T00:00:00Z");
    expect(document.coverage.liveRan).toBe(true);
    expect(document.tally).toBe("send-ask 1");
  });

  it("never proposes an ask in a repository whose CODEOWNERS names only the author, which self-merges", async () => {
    const h = harness({
      codeownersContent: "* @author-login\n",
      pages: [{ nextCursor: undefined, pullRequests: [pr({ repoSlug: "o/r" })], totalCount: 1 }],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });
    expect(h.out[3]).toBe("1 of 1 open · self-merges 1");
  });

  // The gap: self-merging used to be "the checkout's own origin", so a run from inside the
  // team's shared repository read every pull request there as self-merges — including two CONFLICTING ones.
  it("does NOT read the checkout's own repository as self-merging when its CODEOWNERS names a team", async () => {
    const h = harness({
      pages: [{ nextCursor: undefined, pullRequests: [pr({ repoSlug: "o/r" })], totalCount: 1 }],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r"] });
    expect(h.out[3]).toBe("1 of 1 open · send-ask 1");
  });

  it("settles mergeability per REPOSITORY, so the same number in two repos cannot overwrite each other", async () => {
    const h = harness({
      pages: [
        {
          nextCursor: undefined,
          pullRequests: [
            pr({ mergeable: "UNKNOWN", number: 7, repoSlug: "acme/bad" }),
            pr({ mergeable: "UNKNOWN", number: 7, repoSlug: "acme/good" }),
          ],
          totalCount: 2,
        },
      ],
      recheck: [
        { kind: "read", value: { headOid: "abc", mergeable: "CONFLICTING" } },
        { kind: "read", value: { headOid: "abc", mergeable: "MERGEABLE" } },
      ],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "acme/bad,acme/good", "--json"] });
    const document = JSON.parse(h.out[0]!) as {
      pullRequests: { repoSlug: string; number: number; conflict: { mergeable: string } }[];
    };
    expect(
      document.pullRequests.map((row) => `${row.repoSlug}#${String(row.number)} ${row.conflict.mergeable}`),
    ).toStrictEqual(["acme/bad#7 CONFLICTING", "acme/good#7 MERGEABLE"]);
  });

  it("keeps two rows for one pull request at DIFFERENT heads apart, so one answer cannot settle both", async () => {
    const h = harness({
      pages: [
        {
          nextCursor: undefined,
          pullRequests: [
            { ...pr({ mergeable: "UNKNOWN", number: 7, repoSlug: "acme/a" }), headOid: "head-one" },
            { ...pr({ mergeable: "UNKNOWN", number: 7, repoSlug: "acme/a" }), headOid: "head-two" },
          ],
          totalCount: 2,
        },
      ],
      recheck: [
        { kind: "read", value: { headOid: "head-two", mergeable: "MERGEABLE" } },
        { kind: "read", value: { headOid: "head-two", mergeable: "MERGEABLE" } },
      ],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "acme/a", "--json"] });
    const document = JSON.parse(h.out[0]!) as { pullRequests: { headOid: string; conflict: { mergeable: string } }[] };
    expect(document.pullRequests.map((row) => `${row.headOid} ${row.conflict.mergeable}`)).toStrictEqual([
      "head-one UNKNOWN",
      "head-two MERGEABLE",
    ]);
  });

  it("re-reads ONLY a truncated head's whole check list, and the row it completes is no longer truncated", async () => {
    const truncated = pr({
      checks: { ...pr().checks, residue: ["more than 100 contexts"], truncated: true },
      checksTruncated: true,
      number: 7,
      repoSlug: "acme/a",
    });
    const h = harness({
      pages: [
        { nextCursor: undefined, pullRequests: [pr({ number: 6, repoSlug: "acme/a" }), truncated], totalCount: 2 },
      ],
      wholeChecks: ok({ ...pr().checks, rollupState: "SUCCESS" }),
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "acme/a", "--json"] });
    const document = JSON.parse(h.out[0]!) as { pullRequests: { number: number; checksTruncated: boolean }[] };
    expect(h.completionAskedFor).toStrictEqual(["acme/a#7 limit 500"]);
    expect(document.pullRequests.map((row) => `${String(row.number)} ${String(row.checksTruncated)}`)).toStrictEqual([
      "6 false",
      "7 false",
    ]);
  });

  it("leaves a truncated head truncated, and says why, when its re-read lands on a different head", async () => {
    const h = harness({
      pages: [
        {
          nextCursor: undefined,
          pullRequests: [
            pr({
              checks: { ...pr().checks, residue: ["more than 100 contexts"], truncated: true },
              checksTruncated: true,
              number: 7,
              repoSlug: "acme/a",
            }),
          ],
          totalCount: 1,
        },
      ],
      wholeChecks: ok({ ...pr().checks, headSha: "moved" }),
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "acme/a", "--json"] });
    const document = JSON.parse(h.out[0]!) as { pullRequests: { checksTruncated: boolean }[] };
    expect(document.pullRequests[0]!.checksTruncated).toBe(true);
    expect(h.diagnostics).toContain(
      "could not complete acme/a#7's checks: the head moved from abc to moved between the fleet read and the re-read, so its CI stays unknown",
    );
  });

  it("drops a re-read answer about a head it did not judge, rather than mixing two commits into one row", async () => {
    const h = harness({
      pages: [
        {
          nextCursor: undefined,
          pullRequests: [pr({ mergeable: "UNKNOWN", number: 7, repoSlug: "acme/a" })],
          totalCount: 1,
        },
      ],
      recheck: [{ kind: "read", value: { headOid: "a-different-head", mergeable: "MERGEABLE" } }],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "acme/a", "--json"] });
    const document = JSON.parse(h.out[0]!) as { pullRequests: { conflict: { mergeable: string } }[] };
    expect(document.pullRequests[0]!.conflict.mergeable).toBe("UNKNOWN");
  });

  it("reports a CONFLICTING pull request as conflicting ahead of self-merging, with the paths measured", async () => {
    const h = harness({
      codeownersContent: "* @author-login\n",
      pages: [
        {
          nextCursor: undefined,
          pullRequests: [
            pr({ mergeable: "CONFLICTING", number: 5, repoSlug: "o/r" }),
            pr({ number: 6, repoSlug: "o/r" }),
          ],
          totalCount: 2,
        },
      ],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r", "--json"] });
    const document = JSON.parse(h.out[0]!) as {
      pullRequests: {
        number: number;
        recommendation: string;
        conflict: { local: { kind: string; paths?: string[]; why?: string } };
      }[];
      tally: string;
    };
    expect(document.tally).toBe("conflicting 1 · self-merges 1");
    expect(document.pullRequests[0]!.recommendation).toBe("conflicting");
    expect(document.pullRequests[0]!.conflict.local).toStrictEqual({
      kind: "measured",
      paths: ["package.json"],
      why: "",
    });
    expect(h.conflictPathsAskedFor).toEqual(["o/r#5"]);
  });

  it("withholds the corpus watermark when the bronze could not be listed, so no row can say never asked", async () => {
    const h = harness({
      corpusUnreadable: true,
      pages: [{ nextCursor: undefined, pullRequests: [pr()], totalCount: 1 }],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r", "--json"] });
    const document = JSON.parse(h.out[0]!) as { coverage: { corpusThroughIso?: string; residue: string[] } };
    expect(document.coverage.corpusThroughIso).toBeUndefined();
    expect(document.coverage.residue).toContain("the Slack bronze at /x could not be listed: EACCES");
  });

  it("reads the live search's SECOND page, where the only ask sits", async () => {
    const ask = {
      channelId: "C1",
      channelName: "dev",
      permalink: "https://x.slack.com/archives/C1/p2",
      text: "<@U9> pls review <https://github.com/o/target/pull/1|#1>",
      ts: "1788000000.000100",
      tsIso: "2026-08-29T10:40:00.000Z",
      userId: "U1",
    };
    const h = harness({
      livePages: [ok({ matches: [], pageCount: 2, total: 101 }), ok({ matches: [ask], pageCount: 2, total: 101 })],
      pages: [{ nextCursor: undefined, pullRequests: [pr()], totalCount: 1 }],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r", "--json"] });
    const document = JSON.parse(h.out[0]!) as { pullRequests: { slack: { asked: string } }[] };
    expect(document.pullRequests.map((row) => row.slack.asked)).toEqual(["yes"]);
  });

  it("names an incomplete live search in the residue when a later page fails", async () => {
    const h = harness({
      livePages: [
        ok({ matches: [], pageCount: 3, total: 250 }),
        err(SlackLiveSearchErrors.callFailed({ cause: undefined, message: "ratelimited" })),
      ],
      pages: [{ nextCursor: undefined, pullRequests: [pr()], totalCount: 1 }],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r", "--json"] });
    const document = JSON.parse(h.out[0]!) as { coverage: { residue: string[] } };
    expect(document.coverage.residue).toContain(
      "live Slack search for https://github.com/o/target/pull/1 is incomplete: slack search could not be read: ratelimited",
    );
  });

  it("refuses a bad flag with the usage text and a usage exit code", async () => {
    const h = harness({ pages: [] });
    const code = await runGithubReviewState({ deps: h.deps, rest: ["--limit", "0"] });
    expect(code).toBe(2);
    expect(h.diagnostics[0]).toBe("--limit must be a positive whole number");
  });

  // MEASURED: the required-context gate was built once per BASE from
  // whichever pull request was seen first on it, so `missing: ["build"]` landed on 18 of 23 open pull
  // requests, each `11/11 passed` with `build` present and green, and
  // `landing`'s `ci-green` test called all 18 unlandable, `tally.ready` 0. These two cases are the witness
  // for each half: the same base, and two heads that must not get the same answer.
  it("judges each head against its base's required set rather than sharing one head's answer", async () => {
    const h = harness({
      pages: [
        {
          nextCursor: undefined,
          pullRequests: [
            pr({
              checks: {
                baseRef: undefined,
                checks: [],
                headSha: "mid-lap",
                mergeable: "MERGEABLE",
                residue: [],
                rollupState: "PENDING",
                supersededChecks: [],
                truncated: false,
              },
              headOid: "mid-lap",
              number: 1,
            }),
            pr({
              checks: {
                baseRef: undefined,
                checks: [{ kind: "check-run", name: "build", state: "passed", url: undefined }],
                headSha: "complete",
                mergeable: "MERGEABLE",
                residue: [],
                rollupState: "SUCCESS",
                supersededChecks: [],
                truncated: false,
              },
              headOid: "complete",
              number: 2,
            }),
          ],
          totalCount: 2,
        },
      ],
      required: ["build"],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r", "--json"] });
    const document = JSON.parse(h.out[0]!) as {
      pullRequests: readonly { number: number; requiredContexts: { missing: readonly string[] } }[];
    };
    const midLap = document.pullRequests.find((row) => row.number === 1)!;
    const complete = document.pullRequests.find((row) => row.number === 2)!;
    expect(midLap.requiredContexts.missing).toEqual(["build"]);
    expect(complete.requiredContexts.missing).toEqual([]);
  });

  // The gate's `mergeable` is the SETTLED field, which is what names CONFLICTING as the cause of a required
  // context that never ran. Both halves are asserted here: each row gets its own answer, and #1's is the one
  // the mergeability re-read settled rather than the `UNKNOWN` the fleet page returned.
  it("carries each head's own SETTLED mergeability on its gate, never another head's", async () => {
    const h = harness({
      pages: [
        {
          nextCursor: undefined,
          pullRequests: [
            pr({ headOid: "clean", mergeable: "UNKNOWN", number: 1 }),
            pr({ headOid: "stuck", mergeable: "CONFLICTING", number: 2 }),
          ],
          totalCount: 2,
        },
      ],
      recheck: [{ kind: "read", value: { headOid: "clean", mergeable: "MERGEABLE" } }],
      required: ["build"],
    });
    await runGithubReviewState({ deps: h.deps, rest: ["--repo", "o/r", "--json"] });
    const document = JSON.parse(h.out[0]!) as {
      pullRequests: readonly { number: number; requiredContexts: { mergeable: string | undefined } }[];
    };
    const clean = document.pullRequests.find((row) => row.number === 1)!;
    const stuck = document.pullRequests.find((row) => row.number === 2)!;
    expect(clean.requiredContexts.mergeable).toBe("MERGEABLE");
    expect(stuck.requiredContexts.mergeable).toBe("CONFLICTING");
  });
});

describe("collectReviewStates", () => {
  // A requested comparison answering fewer pull requests than it was asked about is a broken read, never "not
  // requested": the whole read fails, naming both counts, and no row is assembled from it. Only `github
  // landing` asks for the comparison, so the read is driven here with the flag set as that verb sets it.
  it("fails the read with both counts when the base-distance comparison answers one pull request short", async () => {
    const h = harness({
      pages: [{ nextCursor: undefined, pullRequests: [pr({ number: 1 }), pr({ number: 2 })], totalCount: 2 }],
    });
    const deps: GithubReviewStateDeps = {
      ...h.deps,
      baseDistances:
        () =>
        ({ subjects }) =>
          Promise.resolve(
            subjects
              .slice(1)
              .map(() => ({ kind: "read", value: { aheadBy: 1, behindBy: 3, status: "DIVERGED" } }) as const),
          ),
    };
    const parsed = unwrap(parseGithubReviewStateArgs({ rest: ["--repo", "o/r"] }));
    const read = await collectReviewStates({
      args: { ...parsed, readBaseDistance: true },
      deps,
      repositoryResolutionVerb: undefined,
    });
    expect(unwrapErr(read)).toEqual([
      "the base-distance read answered 1 of 2 pull requests, so no row can be matched to its distance",
    ]);
    expect(h.out).toEqual([]);
  });
});
