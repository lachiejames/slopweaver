import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CI_WORKFLOW_PATH } from "../../../devLint/ciOffloadContract.js";
import { RUNNER_FACTS_STEP } from "../../../devLint/ciRunnerFacts.js";
import { FETCH_BASE_RUN, workerRunFindings } from "../../../devLint/ciWorkerRuns.js";
import { repoRootOf } from "../../../lib/gitRepo.js";

/** The real workflow, parsed fresh for each test to break one part of. */
const realWorkflow = (): { jobs: Record<string, { steps: Record<string, unknown>[] }> } =>
  parse(readFileSync(join(repoRootOf({ importMetaUrl: import.meta.url }), CI_WORKFLOW_PATH), "utf8"));

describe("workerRunFindings", () => {
  it("passes the real ci.yml, whose lint job carries the whole coverage-base fetch", () => {
    const workflow = realWorkflow();
    expect(workflow.jobs["lint"]!.steps.map((step) => step["run"])).toContain(`${FETCH_BASE_RUN}\n`);
    expect(workerRunFindings({ workflow })).toEqual([]);
  });

  // `BASH_ENV` built at run time and written to $GITHUB_ENV skips every later step.
  it("refuses any run outside the pinned set, however it spells what it writes", () => {
    const workflow = realWorkflow();
    const steps = workflow.jobs["typecheck"]!.steps;
    workflow.jobs["typecheck"]!.steps = [
      ...steps.slice(0, -1),
      { run: "printf '%s_%s=%s\\n' BASH ENV /tmp/prelude >> \"$GITHUB_ENV\"" },
      ...steps.slice(-1),
    ];
    expect(workerRunFindings({ workflow }).map((finding) => finding.line)).toEqual([
      "`jobs.typecheck` runs `printf '%s_%s=%s\\n' BASH ENV /tmp/prelude >> \"$GITHUB_ENV\"`, which is neither a whole pinned setup step nor one of its own commands with only a name, and could hand the next step an environment",
    ]);
  });

  // A pinned command's text under a custom shell runs whatever the shell says.
  it("refuses a pinned command or setup step carrying any other key", () => {
    const workflow = realWorkflow();
    const steps = workflow.jobs["typecheck"]!.steps;
    workflow.jobs["typecheck"]!.steps = [
      ...steps.slice(0, -1),
      { run: "yarn slopweaver dev build", shell: "bash -c 'echo BASH_ENV=/tmp/p >> $GITHUB_ENV'" },
      { run: "corepack enable", shell: "sh" },
      ...steps.slice(-1),
    ];
    expect(workerRunFindings({ workflow }).map((finding) => finding.line)).toEqual([
      "`jobs.typecheck` runs `yarn slopweaver dev build`, which is neither a whole pinned setup step nor one of its own commands with only a name, and could hand the next step an environment",
      "`jobs.typecheck` runs `corepack enable`, which is neither a whole pinned setup step nor one of its own commands with only a name, and could hand the next step an environment",
    ]);
  });

  it("refuses another worker's command, and a run that is not text", () => {
    const workflow = realWorkflow();
    workflow.jobs["compile"]!.steps = [{ ...RUNNER_FACTS_STEP }, { run: "yarn lint" }, { run: 7 }];
    expect(workerRunFindings({ workflow }).map((finding) => finding.line)).toEqual([
      "`jobs.compile` runs `yarn lint`, which is neither a whole pinned setup step nor one of its own commands with only a name, and could hand the next step an environment",
      "`jobs.compile` runs `7`, which is neither a whole pinned setup step nor one of its own commands with only a name, and could hand the next step an environment",
    ]);
  });
});
