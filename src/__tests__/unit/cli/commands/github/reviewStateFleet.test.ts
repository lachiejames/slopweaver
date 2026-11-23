import { describe, expect, it } from "vitest";

import type { GithubReviewStateArgs } from "../../../../../cli/commands/github/reviewStateCore.js";
import { type PageDeadline, readSelection } from "../../../../../cli/commands/github/reviewStateFleet.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { GithubReviewStateApi, PrLiveState } from "../../../../../live/github/reviewState.js";

// The fleet cases — halving, the budget on both sides of a request, the per-request cap and the rate limit —
// run through the whole verb in `reviewStateRun.test.ts`, where an empty stdout is part of what they prove.
// These are the selection's own edges, which that file cannot reach without a CLI around them.

/** The invocation, as the parser would hand it over for `--repo o/r`. */
const ARGS: GithubReviewStateArgs = {
  author: undefined,
  checkLimit: 100,
  detail: false,
  fileLimit: 100,
  home: undefined,
  includeDrafts: false,
  json: false,
  limit: 100,
  number: undefined,
  pageSize: 20,
  readBaseDistance: false,
  repos: ["o/r"],
  slackLive: false,
};

/** A pull request carrying only the number these cases read back; nothing here inspects the rest. */
const ONE = { number: 7 } as PrLiveState;

/**
 * A live seam whose every request moves the clock by `requestMs`, the way a slow GitHub would. A page that NEVER
 * answers is abandoned by its deadline instead, which moves the clock by the page's timeout as a real timer would.
 *
 * @returns the seam, the clock it moves, how many fleet requests were made, the timeout each carried and when
 *   each page's timer was armed
 */
function slowApi({ requestMs, fleetAnswers }: { requestMs: number; fleetAnswers: "one-page" | "declined" | "never" }): {
  readonly api: GithubReviewStateApi;
  readonly monotonicMs: () => number;
  readonly pageDeadline: PageDeadline;
  readonly fleetRequests: () => number;
  readonly timeouts: readonly number[];
  readonly armedAtMs: readonly number[];
} {
  let clockMs = 0;
  let requests = 0;
  const timeouts: number[] = [];
  const armedAtMs: number[] = [];
  const api: GithubReviewStateApi = {
    codeowners: () => Promise.resolve(ok(undefined)),
    fleetPage: ({ timeoutMs }) => {
      requests += 1;
      timeouts.push(timeoutMs);
      clockMs += requestMs;
      if (fleetAnswers === "never") {
        return new Promise(() => undefined);
      }
      if (fleetAnswers === "declined") {
        return Promise.resolve(err(GithubLiveErrors.readFailed({ message: "declined" })));
      }
      return Promise.resolve(ok({ nextCursor: undefined, pullRequests: [ONE], totalCount: 1 }));
    },
    pr: () => {
      clockMs += requestMs;
      return Promise.resolve(ok(ONE));
    },
  };
  const pageDeadline: PageDeadline = ({ ms }) => {
    armedAtMs.push(clockMs);
    if (fleetAnswers !== "never") {
      return new Promise(() => undefined);
    }
    clockMs += ms;
    return Promise.resolve();
  };
  return { api, fleetRequests: () => requests, monotonicMs: () => clockMs, pageDeadline, timeouts, armedAtMs };
}

describe("readSelection", () => {
  it("reads the one pull request --number names outside the fleet budget, since it neither pages nor halves", async () => {
    const seam = slowApi({ fleetAnswers: "declined", requestMs: 120_000 });

    const read = await readSelection({
      api: seam.api,
      args: { ...ARGS, number: 7 },
      deps: { monotonicMs: seam.monotonicMs, pageDeadline: seam.pageDeadline, writeDiagnostic: () => undefined },
      query: "is:pr is:open repo:o/r",
    });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read).prs.map((pr) => pr.number)).toEqual([7]);
    expect(unwrap(read).total).toBe(1);
    expect(seam.fleetRequests()).toBe(0);
  });

  it("names every halving it takes on the way to a page of one", async () => {
    const seam = slowApi({ fleetAnswers: "declined", requestMs: 1_000 });
    const problems: string[] = [];

    const read = await readSelection({
      api: seam.api,
      args: ARGS,
      deps: {
        monotonicMs: seam.monotonicMs,
        pageDeadline: seam.pageDeadline,
        writeDiagnostic: (line) => problems.push(line),
      },
      query: "is:pr is:open repo:o/r",
    });

    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("READ_FAILED");
    expect(seam.fleetRequests()).toBe(5);
    expect(problems).toEqual([
      "the fleet read failed at a page of 20 pull requests and is retrying at 10: declined",
      "the fleet read failed at a page of 10 pull requests and is retrying at 5: declined",
      "the fleet read failed at a page of 5 pull requests and is retrying at 2: declined",
      "the fleet read failed at a page of 2 pull requests and is retrying at 1: declined",
      "the fleet read failed at a page of ONE pull request, so no smaller request is left to try: declined",
    ]);
  });

  it("hands each page a WHOLE-millisecond timeout when the monotonic clock reads a fraction", async () => {
    const seam = slowApi({ fleetAnswers: "declined", requestMs: 60_000.5 });

    const read = await readSelection({
      api: seam.api,
      args: ARGS,
      deps: { monotonicMs: seam.monotonicMs, pageDeadline: seam.pageDeadline, writeDiagnostic: () => undefined },
      query: "is:pr is:open repo:o/r",
    });

    expect(unwrapErr(read).code).toBe("FLEET_BUDGET_EXCEEDED");
    expect(seam.timeouts).toEqual([30_000, 29_999]);
  });

  it("abandons a page that never answers at its own timeout, halves, and ends by name at the budget", async () => {
    const seam = slowApi({ fleetAnswers: "never", requestMs: 0 });
    const problems: string[] = [];

    const read = await readSelection({
      api: seam.api,
      args: ARGS,
      deps: {
        monotonicMs: seam.monotonicMs,
        pageDeadline: seam.pageDeadline,
        writeDiagnostic: (line) => problems.push(line),
      },
      query: "is:pr is:open repo:o/r",
    });

    expect(unwrapErr(read).message).toBe(
      "the fleet read stopped after 90s, past its 90s budget, at a page of 5 pull requests before any page answered: the fleet page did not answer within 30000ms",
    );
    expect(seam.timeouts).toEqual([30_000, 30_000, 30_000]);
    expect(problems).toEqual([
      "the fleet read failed at a page of 20 pull requests and is retrying at 10: the fleet page did not answer within 30000ms",
      "the fleet read failed at a page of 10 pull requests and is retrying at 5: the fleet page did not answer within 30000ms",
    ]);
  });

  it("arms each page's timer BEFORE the request starts, so no part of the call runs untimed", async () => {
    const seam = slowApi({ fleetAnswers: "one-page", requestMs: 45_000 });

    const read = await readSelection({
      api: seam.api,
      args: ARGS,
      deps: { monotonicMs: seam.monotonicMs, pageDeadline: seam.pageDeadline, writeDiagnostic: () => undefined },
      query: "is:pr is:open repo:o/r",
    });

    expect(unwrap(read).total).toBe(1);
    expect(seam.armedAtMs).toEqual([0]);
  });
});
