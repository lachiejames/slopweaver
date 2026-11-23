import { describe, expect, it } from "vitest";

import { noFailedCheckLine, selectCheckLogs } from "../../../../../cli/commands/github/checksLogCore.js";
import type { GithubChecksSnapshot } from "../../../../../live/github/checks.js";
import type { GithubCheck } from "../../../../../live/github/checksDedupe.js";

const ACTIONS_RUN = "https://github.com/lachiejames/slopweaver/actions/runs/35502228255";

/** One check, named and pointed wherever a case needs it. */
function check({
  name,
  state,
  url,
}: {
  name: string;
  state: GithubCheck["state"];
  url: string | undefined;
}): GithubCheck {
  return { kind: "check-run", name, state, url };
}

/** A snapshot carrying exactly the checks a case is about. */
function snapshotOf({
  checks,
  rollupState = "FAILURE",
}: {
  checks: readonly GithubCheck[];
  rollupState?: string;
}): GithubChecksSnapshot {
  return {
    baseRef: "main",
    checks,
    headSha: "abc1234",
    mergeable: undefined,
    residue: [],
    rollupState,
    supersededChecks: [],
    truncated: false,
  };
}

describe("selectCheckLogs", () => {
  it("resolves each failed check to its own run and job, in first-seen order", () => {
    const selection = selectCheckLogs({
      snapshot: snapshotOf({
        checks: [
          check({ name: "lint", state: "failed", url: `${ACTIONS_RUN}/job/106055916296` }),
          check({ name: "unit", state: "failed", url: `${ACTIONS_RUN}/job/106055916301` }),
        ],
      }),
    });

    expect(selection.groups).toEqual([{ jobIds: [106055916296, 106055916301], runId: 35502228255 }]);
    expect(selection.unreadable).toEqual([]);
  });

  it("keeps two runs apart, which is what a re-run leaves on one head", () => {
    const selection = selectCheckLogs({
      snapshot: snapshotOf({
        checks: [
          check({ name: "lint", state: "failed", url: `${ACTIONS_RUN}/job/1` }),
          check({
            name: "typecheck",
            state: "failed",
            url: "https://github.com/lachiejames/slopweaver/actions/runs/99/job/2",
          }),
        ],
      }),
    });

    expect(selection.groups).toEqual([
      { jobIds: [1], runId: 35502228255 },
      { jobIds: [2], runId: 99 },
    ]);
  });

  it("dedupes a job id repeated within one run, so a duplicate costs no second stream", () => {
    const selection = selectCheckLogs({
      snapshot: snapshotOf({
        checks: [
          check({ name: "lint", state: "failed", url: `${ACTIONS_RUN}/job/1` }),
          check({ name: "lint", state: "failed", url: `${ACTIONS_RUN}/job/1` }),
        ],
      }),
    });

    expect(selection.groups).toEqual([{ jobIds: [1], runId: 35502228255 }]);
  });

  it("reads no log for a check that passed, is running or is queued", () => {
    const selection = selectCheckLogs({
      snapshot: snapshotOf({
        checks: [
          check({ name: "lint", state: "passed", url: `${ACTIONS_RUN}/job/1` }),
          check({ name: "unit", state: "running", url: `${ACTIONS_RUN}/job/2` }),
          check({ name: "integration", state: "queued", url: `${ACTIONS_RUN}/job/3` }),
        ],
        rollupState: "PENDING",
      }),
    });

    expect(selection.groups).toEqual([]);
    expect(selection.unreadable).toEqual([]);
  });

  it("names a failed check whose details URL is not an Actions job rather than dropping it", () => {
    const selection = selectCheckLogs({
      snapshot: snapshotOf({
        checks: [
          check({ name: "vercel", state: "failed", url: "https://vercel.com/deployments/x" }),
          check({ name: "legacy-status", state: "failed", url: undefined }),
        ],
      }),
    });

    expect(selection.groups).toEqual([]);
    expect(selection.unreadable).toEqual(["vercel", "legacy-status"]);
  });
});

describe("noFailedCheckLine", () => {
  it("says the head is GREEN rather than leaving an empty read to be read as a break", () => {
    const line = noFailedCheckLine({
      snapshot: snapshotOf({
        checks: [check({ name: "lint", state: "passed", url: `${ACTIONS_RUN}/job/1` })],
        rollupState: "SUCCESS",
      }),
    });

    expect(line).toBe(
      "no failed check on abc1234 — GitHub's rollup reads SUCCESS over 1 check(s), so there is no job log to read",
    );
  });

  it("carries a rollup that disagrees with the checks verbatim, since that disagreement is the finding", () => {
    expect(noFailedCheckLine({ snapshot: snapshotOf({ checks: [], rollupState: "FAILURE" }) })).toContain(
      "rollup reads FAILURE over 0 check(s)",
    );
  });
});
