import { describe, expect, it } from "vitest";

import {
  failedStepOf,
  isUnsuccessfulJob,
  parseCheckLogTarget,
  parseJobsPage,
  parseRunFacts,
} from "../../../../live/github/jobLogShape.js";

describe("parseRunFacts", () => {
  it("shapes a run from an Octokit response envelope", () => {
    const facts = parseRunFacts({
      payload: {
        data: {
          conclusion: "failure",
          head_branch: "now-page-291-51",
          head_sha: "abc1234",
          html_url: "https://github.com/lachiejames/slopweaver/actions/runs/35502228255",
          id: 35502228255,
          name: "CI",
        },
      },
    });

    expect(facts).toEqual({
      conclusion: "failure",
      headBranch: "now-page-291-51",
      headSha: "abc1234",
      htmlUrl: "https://github.com/lachiejames/slopweaver/actions/runs/35502228255",
      id: 35502228255,
      name: "CI",
    });
  });

  it("shapes a run handed over already unwrapped, as a test fake supplies one", () => {
    expect(parseRunFacts({ payload: { id: 7 } })?.id).toBe(7);
  });

  it("answers undefined for a payload carrying no numeric run id", () => {
    expect(parseRunFacts({ payload: { data: { id: "35502228255" } } })).toBeUndefined();
  });

  it("carries an absent field as undefined rather than an empty string", () => {
    expect(parseRunFacts({ payload: { id: 7 } })?.conclusion).toBeUndefined();
  });
});

describe("parseJobsPage", () => {
  it("shapes every job and its steps, in GitHub's own order", () => {
    const jobs = parseJobsPage({
      payload: {
        data: {
          jobs: [
            {
              conclusion: "failure",
              html_url: "https://github.com/lachiejames/slopweaver/actions/runs/1/job/2",
              id: 106055916296,
              name: "lint",
              steps: [
                { conclusion: "success", name: "Set up job", number: 1 },
                { conclusion: "failure", name: "Lint", number: 8 },
              ],
            },
            { conclusion: "success", id: 106055916331, name: "integration", steps: [] },
          ],
        },
      },
    });

    expect(jobs.length).toBe(2);
    expect(jobs[0]!.name).toBe("lint");
    expect(jobs[0]!.steps[1]).toEqual({ conclusion: "failure", name: "Lint", number: 8 });
    expect(jobs[1]!.htmlUrl).toBeUndefined();
  });

  it("drops a job with no numeric id rather than inventing one", () => {
    expect(
      parseJobsPage({
        payload: {
          jobs: [
            { id: "x", name: "lint" },
            { id: 3, name: "unit" },
          ],
        },
      }).length,
    ).toBe(1);
  });

  it("drops a step with no number, keeping the job", () => {
    const jobs = parseJobsPage({ payload: { jobs: [{ id: 3, name: "unit", steps: [{ name: "no number" }] }] } });

    expect(jobs[0]!.steps).toEqual([]);
  });

  it("answers an empty list for a payload carrying no jobs array", () => {
    expect(parseJobsPage({ payload: { data: {} } })).toEqual([]);
  });
});

describe("isUnsuccessfulJob", () => {
  it("counts a failure", () => {
    expect(isUnsuccessfulJob({ conclusion: "failure" })).toBe(true);
  });

  it("counts a cancellation, whose log is where the reason for it lives", () => {
    expect(isUnsuccessfulJob({ conclusion: "cancelled" })).toBe(true);
  });

  it("counts a timeout", () => {
    expect(isUnsuccessfulJob({ conclusion: "timed_out" })).toBe(true);
  });

  it("does not count a success", () => {
    expect(isUnsuccessfulJob({ conclusion: "success" })).toBe(false);
  });

  it("does not count a skipped job", () => {
    expect(isUnsuccessfulJob({ conclusion: "skipped" })).toBe(false);
  });

  it("does not count a job that is still running and has no conclusion", () => {
    expect(isUnsuccessfulJob({ conclusion: undefined })).toBe(false);
  });
});

describe("failedStepOf", () => {
  it("names the first step GitHub concluded failure", () => {
    expect(
      failedStepOf({
        steps: [
          { conclusion: "success", name: "Set up job", number: 1 },
          { conclusion: "failure", name: "Lint", number: 8 },
          { conclusion: "failure", name: "Later", number: 9 },
        ],
      }),
    ).toEqual({ conclusion: "failure", name: "Lint", number: 8 });
  });

  it("answers undefined for a cancelled job, which names no failed step at all", () => {
    expect(
      failedStepOf({
        steps: [
          { conclusion: "cancelled", name: "Set up job", number: 1 },
          { conclusion: "cancelled", name: "Lint", number: 8 },
        ],
      }),
    ).toBeUndefined();
  });
});

describe("parseCheckLogTarget", () => {
  it("reads the run and job ids out of an Actions details URL", () => {
    expect(
      parseCheckLogTarget({
        url: "https://github.com/lachiejames/slopweaver/actions/runs/35502228255/job/106055916296",
      }),
    ).toEqual({ jobId: 106055916296, runId: 35502228255 });
  });

  it("answers undefined for a details URL from some other CI system", () => {
    expect(parseCheckLogTarget({ url: "https://buildkite.com/org/pipeline/builds/12" })).toBeUndefined();
  });

  it("answers undefined for a run URL carrying no job", () => {
    expect(
      parseCheckLogTarget({ url: "https://github.com/lachiejames/slopweaver/actions/runs/35502228255" }),
    ).toBeUndefined();
  });

  it("answers undefined when GitHub reported no details URL at all", () => {
    expect(parseCheckLogTarget({ url: undefined })).toBeUndefined();
  });
});
