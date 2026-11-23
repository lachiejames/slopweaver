/**
 * The shell `handover park` runs before cmux: which reads it takes, and the four-line refusal it returns when the
 * wake names the run's own open pull request, or a clock wake would close a seat whose run's own pull request is open.
 * The reads are plain fakes recording their calls — no mock, no network.
 */
import { describe, expect, it } from "vitest";

import { ownLandingRefusal, type ParkOwnLandingDeps } from "../../../../../cli/commands/handover/parkOwnLanding.js";
import type { RowPullRequests } from "../../../../../hand/rowPullRequest.js";
import type { ParkWake } from "../../../../../handover/parkWake.js";
import { toIngestError } from "../../../../../lib/ingestError.js";
import { err, ok } from "../../../../../lib/result.js";
import type { PrHead } from "../../../../../live/github/prHead.js";

const WAKE: ParkWake = { kind: "checks", number: 3454, repo: "acme/widgets" };
const CLOCK: ParkWake = { atIso: "2026-11-09T03:00:00Z", kind: "at" };
const OPEN_PULLS: RowPullRequests = {
  branches: ["fix-relay"],
  kind: "read",
  pulls: [{ number: 3454, state: "OPEN", url: "https://github.com/acme/widgets/pull/3454" }],
  repo: "acme/widgets",
};

/** A checks wake never reads the row's pull requests; a call here fails the case that made it. */
const NEVER_PULLS: ParkOwnLandingDeps["readOwnPullRequests"] = async () => {
  throw new Error("a checks wake read the row's pull requests");
};

/** Fake reads answering fixed facts, and the calls each received. */
function fakeDeps({
  head,
  branch,
  pulls = OPEN_PULLS,
}: {
  head: PrHead;
  branch: string | null;
  pulls?: RowPullRequests;
}): {
  deps: ParkOwnLandingDeps;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      readBranch: ({ cwd }) => {
        calls.push(`branch ${cwd}`);
        return ok(branch);
      },
      readOwnPullRequests: async ({ slug }) => {
        calls.push(`pulls ${slug}`);
        return pulls;
      },
      readPrHead: async ({ repo, number }) => {
        calls.push(`head ${repo}#${String(number)}`);
        return ok(head);
      },
    },
  };
}

/** The clock-park refusal for one fake answer, and the reads it took. */
async function clockPark({
  env = {},
  pulls,
  wake,
}: {
  env?: NodeJS.ProcessEnv;
  pulls: RowPullRequests;
  wake: ParkWake | undefined;
}): Promise<{ lines: readonly string[]; calls: string[] }> {
  const { deps, calls } = fakeDeps({ branch: "fix-relay", head: { headRefName: "fix-relay", state: "OPEN" }, pulls });
  const lines = await ownLandingRefusal({
    deps,
    env,
    recordedBranch: "fix-relay",
    runTree: "/w/tree",
    seatTree: "/w/tree",
    slug: "fix-relay",
    wake,
  });
  return { calls, lines };
}

describe("ownLandingRefusal", () => {
  it("refuses a park on the run's own open pull request with the four-line refusal naming the hatch", async () => {
    const { deps, calls } = fakeDeps({ branch: "fix-relay", head: { headRefName: "fix-relay", state: "OPEN" } });
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: undefined,
      runTree: "/w/tree",
      seatTree: "/w/tree",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("acme/widgets#3454 is open on fix-relay, this run's own branch");
    expect(lines[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_PARK_OWN_LANDING=1 slopweaver handover park.",
    );
    expect(calls).toEqual(["branch /w/tree", "head acme/widgets#3454", "branch /w/tree"]);
  });

  it("refuses when the worktree switched branch while the head read was in flight", async () => {
    const answers = ["fix-relay", "other"];
    const deps: ParkOwnLandingDeps = {
      readBranch: () => ok(answers.shift()!),
      readPrHead: async () => ok({ headRefName: "fix-relay", state: "OPEN" }),
      readOwnPullRequests: NEVER_PULLS,
    };
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "old",
      runTree: "/w/tree",
      seatTree: "/w/tree",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain("acme/widgets#3454 is open on fix-relay, this run's own branch");
  });

  it("refuses when the two branch reads disagree though neither matches the head", async () => {
    const answers = ["stack-parent", "child"];
    const deps: ParkOwnLandingDeps = {
      readBranch: () => ok(answers.shift()!),
      readPrHead: async () => ok({ headRefName: "fix-relay", state: "OPEN" }),
      readOwnPullRequests: NEVER_PULLS,
    };
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "old",
      runTree: "/w/tree",
      seatTree: "/w/tree",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain(
      "(the worktree changed branch while the head was read, so the branch it had out then is unknown)",
    );
  });

  it("refuses when the head read throws a Proxy whose prototype read itself throws", async () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: (): object => {
          throw new Error("prototype denied");
        },
      },
    );
    const deps: ParkOwnLandingDeps = {
      readBranch: () => ok("fix-relay"),
      readOwnPullRequests: NEVER_PULLS,
      readPrHead: () => {
        throw hostile;
      },
    };
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "fix-relay",
      runTree: undefined,
      seatTree: "/w/seat",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain("(the head read threw: a value whose message would not read)");
  });

  it("lets a park on another branch's open pull request through", async () => {
    const { deps } = fakeDeps({ branch: "child", head: { headRefName: "stack-parent", state: "OPEN" } });
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "child",
      runTree: "/w/tree",
      seatTree: "/w/tree",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines).toEqual([]);
  });

  it("lets the same facts through once the hatch is open, reading nothing", async () => {
    const { deps, calls } = fakeDeps({ branch: "fix-relay", head: { headRefName: "fix-relay", state: "OPEN" } });
    const lines = await ownLandingRefusal({
      deps,
      env: { SLOPWEAVER_ALLOW_PARK_OWN_LANDING: "1" },
      recordedBranch: "fix-relay",
      runTree: "/w/tree",
      seatTree: "/w/tree",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect([lines, calls]).toEqual([[], []]);
  });

  it("refuses a clock park while the run's own pull request is open, reading only the row's pull requests", async () => {
    const { lines, calls } = await clockPark({ pulls: OPEN_PULLS, wake: CLOCK });
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain(
      "a clock park would close this seat, but its run's own pull request is open, and landing it is its work: " +
        "https://github.com/acme/widgets/pull/3454 — keep the seat and run slopweaver github checks",
    );
    expect(lines[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_PARK_OWN_LANDING=1 slopweaver handover park.",
    );
    expect(calls).toEqual(["pulls fix-relay"]);
  });

  it("refuses a clock park when the row's pull requests did not read", async () => {
    const { lines, calls } = await clockPark({ pulls: { kind: "unread", why: "rate limited" }, wake: CLOCK });
    expect(lines[0]).toContain("but its own pull requests did not read — rate limited — keep the seat");
    expect(calls).toEqual(["pulls fix-relay"]);
  });

  it("refuses a clock park when the pull request read throws, rather than reading it as none", async () => {
    const deps: ParkOwnLandingDeps = {
      readBranch: () => ok("fix-relay"),
      readOwnPullRequests: () => {
        throw new Error("socket hang up");
      },
      readPrHead: async () => ok({ headRefName: "fix-relay", state: "OPEN" }),
    };
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "fix-relay",
      runTree: "/w/tree",
      seatTree: "/w/tree",
      slug: "fix-relay",
      wake: CLOCK,
    });
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("its own pull requests did not read — the own pull request read threw: socket hang up");
  });

  it("lets a clock park through when the run's pull requests are only merged or closed", async () => {
    const { lines, calls } = await clockPark({
      pulls: {
        branches: ["fix-relay"],
        kind: "read",
        pulls: [
          { number: 3400, state: "MERGED", url: "https://github.com/acme/widgets/pull/3400" },
          { number: 3401, state: "CLOSED", url: "https://github.com/acme/widgets/pull/3401" },
        ],
        repo: "acme/widgets",
      },
      wake: CLOCK,
    });
    expect([lines, calls]).toEqual([[], ["pulls fix-relay"]]);
  });

  it("lets a clock park through once the hatch is open, reading nothing", async () => {
    const { lines, calls } = await clockPark({
      env: { SLOPWEAVER_ALLOW_PARK_OWN_LANDING: "1" },
      pulls: OPEN_PULLS,
      wake: CLOCK,
    });
    expect([lines, calls]).toEqual([[], []]);
  });

  it("reads nothing for a question-only park", async () => {
    const { lines, calls } = await clockPark({ pulls: OPEN_PULLS, wake: undefined });
    expect([lines, calls]).toEqual([[], []]);
  });

  it("refuses when the head read throws, rather than closing the seat", async () => {
    const deps: ParkOwnLandingDeps = {
      readBranch: () => ok("fix-relay"),
      readOwnPullRequests: NEVER_PULLS,
      readPrHead: async () => {
        throw new Error("socket hang up");
      },
    };
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "fix-relay",
      runTree: undefined,
      seatTree: "/w/seat",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain(
      "acme/widgets#3454 could not be told apart from this run's own landing (the head read threw: socket hang up)",
    );
  });

  it("refuses when the head read throws synchronously, rather than crashing", async () => {
    const deps: ParkOwnLandingDeps = {
      readBranch: () => ok("fix-relay"),
      readOwnPullRequests: NEVER_PULLS,
      readPrHead: () => {
        throw new Error("token unreadable");
      },
    };
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "fix-relay",
      runTree: undefined,
      seatTree: "/w/seat",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain(
      "acme/widgets#3454 could not be told apart from this run's own landing (the head read threw: token unreadable)",
    );
  });

  it("refuses when the head read throws a value whose conversion to a string itself throws", async () => {
    const hostile = {
      [Symbol.toPrimitive]: (): string => {
        throw new Error("cannot stringify");
      },
    };
    const deps: ParkOwnLandingDeps = {
      readBranch: () => ok("fix-relay"),
      readOwnPullRequests: NEVER_PULLS,
      readPrHead: () => {
        throw hostile;
      },
    };
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "fix-relay",
      runTree: undefined,
      seatTree: "/w/seat",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain("(the head read threw: a value that is not an Error)");
  });

  it("refuses when the head read throws an Error whose message getter itself throws", async () => {
    const hostile = new Error("replaced by a throwing getter below");
    Object.defineProperty(hostile, "message", {
      get: (): string => {
        throw new Error("unreadable message");
      },
    });
    const deps: ParkOwnLandingDeps = {
      readBranch: () => ok("fix-relay"),
      readOwnPullRequests: NEVER_PULLS,
      readPrHead: () => {
        throw hostile;
      },
    };
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "fix-relay",
      runTree: undefined,
      seatTree: "/w/seat",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain("(the head read threw: a value whose message would not read)");
  });

  it("refuses when the worktree's branch read fails, though a different branch was recorded", async () => {
    const deps: ParkOwnLandingDeps = {
      readBranch: () =>
        err(toIngestError({ defaultKind: "io", error: new Error("git exited 128"), operation: "codex.currentBranch" })),
      readPrHead: async () => ok({ headRefName: "fix-relay", state: "OPEN" }),
      readOwnPullRequests: NEVER_PULLS,
    };
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "old-branch",
      runTree: "/w/tree",
      seatTree: "/w/tree",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain(
      "acme/widgets#3454 could not be told apart from this run's own landing (the branch at /w/tree did not read: ",
    );
  });

  it("refuses when the run records no worktree, though a different branch was recorded", async () => {
    const { deps, calls } = fakeDeps({ branch: "unused", head: { headRefName: "fix-relay", state: "OPEN" } });
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "old-branch",
      runTree: undefined,
      seatTree: "/w/seat",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(calls).toEqual(["branch /w/seat", "head acme/widgets#3454", "branch /w/seat"]);
    expect(lines[0]).toContain("(this run records no worktree to read its current branch from)");
  });

  it("refuses the open pull request of the worktree the seat moved into, not only the recorded one", async () => {
    const deps: ParkOwnLandingDeps = {
      readBranch: ({ cwd }) => ok(cwd === "/w/new" ? "feature" : "old"),
      readPrHead: async () => ok({ headRefName: "feature", state: "OPEN" }),
      readOwnPullRequests: NEVER_PULLS,
    };
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "old",
      runTree: "/w/old",
      seatTree: "/w/new",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain("acme/widgets#3454 is open on feature, this run's own branch");
  });

  it("refuses when the worktree is detached mid-rebase, though a different branch was recorded", async () => {
    const { deps } = fakeDeps({ branch: null, head: { headRefName: "fix-relay", state: "OPEN" } });
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "old-branch",
      runTree: "/w/tree",
      seatTree: "/w/tree",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain("(/w/tree is detached, as it is mid-rebase, so its branch is unknown)");
  });

  it("still names its own landing when the recorded branch matches though the worktree is detached", async () => {
    const { deps } = fakeDeps({ branch: null, head: { headRefName: "fix-relay", state: "OPEN" } });
    const lines = await ownLandingRefusal({
      deps,
      env: {},
      recordedBranch: "fix-relay",
      runTree: "/w/tree",
      seatTree: "/w/tree",
      slug: "fix-relay",
      wake: WAKE,
    });
    expect(lines[0]).toContain("acme/widgets#3454 is open on fix-relay, this run's own branch");
  });
});
