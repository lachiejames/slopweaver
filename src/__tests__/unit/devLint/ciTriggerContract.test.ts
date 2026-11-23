/**
 * Two describe blocks, the same shape as `ciOffloadContract.test.ts`: the first exercises the PURE judgement
 * on inline workflow fixtures, the second reads this repository's REAL workflow files — because a gate whose
 * only tests are fixtures proves the matcher works and never that the contract holds here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  declaredActionUnion,
  duplicateJobFindings,
  firesOnPullRequest,
  jobNamesOf,
  onBlockOf,
  pullRequestTypesOf,
  triggerContractFindings,
  unregisteredWorkflowFindings,
  WORKFLOW_JOB_ACTIONS,
} from "../../../devLint/ciTriggerContract.js";
import { readWorkflowFiles } from "../../../devLint/ciWorkflowActions.js";
import { repoRootOf } from "../../../lib/gitRepo.js";

const CI = ".github/workflows/ci.yml";
const PR_GATE = ".github/workflows/pr-body-gate.yml";

const workflowText = ({ types, jobs }: { types: readonly string[]; jobs: readonly string[] }): string =>
  [
    "name: CI",
    "on:",
    "  pull_request:",
    `    types: [${types.join(", ")}]`,
    "jobs:",
    ...jobs.flatMap((job) => [`  ${job}:`, "    steps:", "      - run: echo hi"]),
  ].join("\n");

const CI_TYPES = ["opened", "synchronize", "reopened"];

const CI_JOBS = [
  "lint",
  "typecheck",
  "site",
  "desktop",
  "unit-1",
  "unit-2",
  "unit-3",
  "unit-4",
  "unit-5",
  "unit-6",
  "unit",
  "subprocess",
  "desktop-e2e",
  "compile",
  "build",
  "integration",
  "ci-timing",
];

describe("onBlockOf", () => {
  it("reads the trigger map under the plain `on` key", () => {
    expect(onBlockOf({ workflow: { on: { pull_request: { types: ["opened"] } } } })).toEqual({
      pull_request: { types: ["opened"] },
    });
  });

  it("reads it under `true` too, which is what a YAML 1.1 parser makes of a bare `on:`", () => {
    expect(onBlockOf({ workflow: { true: { pull_request: { types: ["edited"] } } } })).toEqual({
      pull_request: { types: ["edited"] },
    });
  });

  it("returns undefined — never an empty map — when neither key holds one", () => {
    expect(onBlockOf({ workflow: { jobs: {} } })).toBe(undefined);
  });
});

describe("pullRequestTypesOf", () => {
  it("reads the declared types", () => {
    expect(pullRequestTypesOf({ workflow: { on: { pull_request: { types: ["opened", "edited"] } } } })).toEqual([
      "opened",
      "edited",
    ]);
  });

  it("returns undefined when `pull_request` carries no types list, so the caller reports it", () => {
    expect(pullRequestTypesOf({ workflow: { on: { pull_request: null } } })).toBe(undefined);
  });
});

describe("jobNamesOf", () => {
  it("reads the job names in file order", () => {
    expect(jobNamesOf({ workflow: { jobs: { build: {}, integration: {} } } })).toEqual(["build", "integration"]);
  });

  it("returns undefined — never an empty list — when there is no jobs map", () => {
    expect(jobNamesOf({ workflow: { on: {} } })).toBe(undefined);
  });
});

describe("declaredActionUnion", () => {
  it("is ci.yml's three tree-changing actions, sorted", () => {
    expect(declaredActionUnion({ workflow: CI })).toEqual(["opened", "reopened", "synchronize"]);
  });

  it("adds `edited`, `labeled` and `unlabeled` for the body gate, the one job whose subject is the pull request itself", () => {
    expect(declaredActionUnion({ workflow: PR_GATE })).toEqual([
      "edited",
      "labeled",
      "opened",
      "reopened",
      "synchronize",
      "unlabeled",
    ]);
  });

  it("is empty for a path nothing declares", () => {
    expect(declaredActionUnion({ workflow: ".github/workflows/nope.yml" })).toEqual([]);
  });
});

describe("triggerContractFindings", () => {
  it("passes the shape ci.yml actually has", () => {
    const text = workflowText({ jobs: CI_JOBS, types: CI_TYPES });
    expect(triggerContractFindings({ text, workflow: CI })).toEqual([]);
  });

  it("names a type no job needs, which is how `ready_for_review` was found", () => {
    const text = workflowText({ jobs: CI_JOBS, types: [...CI_TYPES, "ready_for_review"] });
    const findings = triggerContractFindings({ text, workflow: CI });
    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toContain("`pull_request.types: ready_for_review`, which none of its jobs needs");
  });

  it("tells the reader NOT to reach for `if:`, because a skipped conclusion reads as passed", () => {
    const text = workflowText({ jobs: CI_JOBS, types: [...CI_TYPES, "edited"] });
    expect(triggerContractFindings({ text, workflow: CI })[0]!.line).toContain(
      "do NOT skip the job with `if:`, whose `skipped` conclusion reads as PASSED",
    );
  });

  it("names a job that declares nothing, which is what a job added later looks like", () => {
    const text = workflowText({ jobs: [...CI_JOBS, "extra"], types: CI_TYPES });
    const findings = triggerContractFindings({ text, workflow: CI });
    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toContain("job `extra` in .github/workflows/ci.yml declares no pull_request actions");
  });

  it("names a declaration whose job has been deleted from the file", () => {
    const text = workflowText({ jobs: CI_JOBS.filter((job) => job !== "integration"), types: CI_TYPES });
    const findings = triggerContractFindings({ text, workflow: CI });
    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toContain("declares `integration`");
  });

  it("names a declared action the file never delivers", () => {
    const text = workflowText({
      jobs: ["dev-gate"],
      types: ["opened", "synchronize", "reopened", "labeled", "unlabeled"],
    });
    const findings = triggerContractFindings({ text, workflow: PR_GATE });
    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toContain("needing `edited` but its `pull_request.types` never delivers it");
  });

  it("reports a file with no types list rather than reading it as clean", () => {
    const text = ["name: CI", "on:", "  push:", "    branches: [main]", "jobs:", "  build:", "    steps: []"].join(
      "\n",
    );
    expect(triggerContractFindings({ text, workflow: CI })).toEqual([
      { line: ".github/workflows/ci.yml declares no `pull_request.types` list — every action would fire it" },
    ]);
  });

  it("reports unparseable YAML as a finding, never as an empty clean result", () => {
    const findings = triggerContractFindings({ text: "name: [unclosed\n", workflow: CI });
    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toContain("does not parse as YAML");
  });
});

describe("duplicateJobFindings", () => {
  it("is empty for the declarations this repository ships", () => {
    expect(duplicateJobFindings()).toEqual([]);
  });
});

describe("the real workflow files", () => {
  const read = ({ workflow }: { workflow: string }): string =>
    readFileSync(join(repoRootOf({ importMetaUrl: import.meta.url }), workflow), "utf8");

  it("declares exactly the two workflows that carry a pull_request trigger", () => {
    expect(WORKFLOW_JOB_ACTIONS.map((entry) => entry.workflow)).toEqual([CI, PR_GATE]);
  });

  it("holds the contract on every declared workflow, as shipped", () => {
    for (const entry of WORKFLOW_JOB_ACTIONS) {
      expect(triggerContractFindings({ text: read({ workflow: entry.workflow }), workflow: entry.workflow })).toEqual(
        [],
      );
    }
  });

  it("keeps `edited` out of ci.yml, which is the 13m32s-per-landing saving itself", () => {
    expect(pullRequestTypesOf({ workflow: parse(read({ workflow: CI })) })).toEqual(CI_TYPES);
  });

  it("keeps `edited`, `labeled` and `unlabeled` IN the body gate, so a body or label fix can still clear a red gate", () => {
    expect(pullRequestTypesOf({ workflow: parse(read({ workflow: PR_GATE })) })).toEqual([
      "opened",
      "synchronize",
      "reopened",
      "edited",
      "labeled",
      "unlabeled",
    ]);
  });

  it("declares each job's actions exactly, so a widening shows up here as a diff", () => {
    expect(WORKFLOW_JOB_ACTIONS.flatMap((entry) => entry.jobs.map((job) => [job.job, job.actions.join("+")]))).toEqual([
      ["lint", "opened+synchronize+reopened"],
      ["typecheck", "opened+synchronize+reopened"],
      ["site", "opened+synchronize+reopened"],
      ["desktop", "opened+synchronize+reopened"],
      ["unit-1", "opened+synchronize+reopened"],
      ["unit-2", "opened+synchronize+reopened"],
      ["unit-3", "opened+synchronize+reopened"],
      ["unit-4", "opened+synchronize+reopened"],
      ["unit-5", "opened+synchronize+reopened"],
      ["unit-6", "opened+synchronize+reopened"],
      ["unit", "opened+synchronize+reopened"],
      ["subprocess", "opened+synchronize+reopened"],
      ["desktop-e2e", "opened+synchronize+reopened"],
      ["compile", "opened+synchronize+reopened"],
      ["build", "opened+synchronize+reopened"],
      ["integration", "opened+synchronize+reopened"],
      ["ci-timing", "opened+synchronize+reopened"],
      ["dev-gate", "opened+synchronize+reopened+edited+labeled+unlabeled"],
    ]);
  });

  it("leaves no job skipped by `if:` on a pull_request action, the shape the split replaced", () => {
    expect(read({ workflow: CI })).not.toContain("github.event.action != 'edited'");
  });

  it("holds no pull-request workflow in the directory that the registry does not name", () => {
    const root = repoRootOf({ importMetaUrl: import.meta.url });
    expect(unregisteredWorkflowFindings({ files: readWorkflowFiles({ root }) })).toEqual([]);
  });
});

describe("unregisteredWorkflowFindings — a pull-request workflow the registry never named", () => {
  it("names an unregistered workflow that fires on pull_request", () => {
    const text = workflowText({ jobs: ["extra"], types: ["opened"] });
    expect(unregisteredWorkflowFindings({ files: [{ path: ".github/workflows/new.yml", text }] })).toEqual([
      {
        line:
          ".github/workflows/new.yml fires on pull_request but has no WORKFLOW_JOB_ACTIONS entry, so none of its jobs " +
          "was judged — add it in src/devLint/ciTriggerContract.ts with each job's actions and why",
      },
    ]);
  });

  it("ignores an unregistered workflow that never fires on pull_request", () => {
    const text = "on:\n  push:\njobs:\n  nightly:\n    runs-on: ubuntu-latest\n";
    expect(unregisteredWorkflowFindings({ files: [{ path: ".github/workflows/nightly.yml", text }] })).toEqual([]);
  });

  it("skips a workflow the registry already names, which the per-file judgement reads", () => {
    expect(unregisteredWorkflowFindings({ files: [{ path: CI, text: "on: [" }] })).toEqual([]);
  });

  it("reports an unregistered workflow that will not parse as unevaluated, never as clean", () => {
    const found = unregisteredWorkflowFindings({ files: [{ path: ".github/workflows/bad.yml", text: "on: [" }] });
    expect(found.map((finding) => finding.unevaluated)).toEqual([true]);
  });

  it("reports an empty unregistered workflow as unevaluated rather than skipping it", () => {
    expect(unregisteredWorkflowFindings({ files: [{ path: ".github/workflows/empty.yml", text: "" }] })).toEqual([
      { line: ".github/workflows/empty.yml is not a workflow map, so its triggers were never read", unevaluated: true },
    ]);
  });
});

describe("firesOnPullRequest — every spelling GitHub accepts", () => {
  it("reads a bare string, a list and a map key, and nothing else", () => {
    const texts = ["on: pull_request", "on: [push, pull_request]", "on:\n  pull_request:\n", "on: push", "on: [push]"];
    expect(texts.map((text) => firesOnPullRequest({ workflow: parse(text) }))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});
