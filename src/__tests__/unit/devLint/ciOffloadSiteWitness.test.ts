/**
 * The console site's Nextra-patch witness and its build, judged on this repository's REAL `ci.yml` with one
 * thing broken at a time. The witness was declared before the build,
 * yet no test asserted what the contract says when the two swap, so an order check could rot unseen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { CI_WORKFLOW_PATH, offloadContractFindings } from "../../../devLint/ciOffloadContract.js";
import { jobOf, stepsOf } from "../../../devLint/ciWorkflowRead.js";
import { repoRootOf } from "../../../lib/gitRepo.js";

const WITNESS = "yarn test:nextra-patch";

const COLD_STEPS =
  "`jobs.site` does not run exactly its pinned cold steps (COLD_JOB_RUNS), in order and with none of their " +
  "unsafe keys, so it could skip its build or use the root project cold";

const NO_WITNESS =
  "`jobs.site` has no step whose whole `run:` is `yarn test:nextra-patch` under `working-directory: site` — the " +
  "witness that the installed Nextra is the patched one, with no Twoslash transformer for a TypeScript bump to break";

/**
 * This repository's workflow, parsed fresh so each case may break its own copy.
 *
 * @returns the parsed `ci.yml`
 */
const realWorkflow = (): unknown =>
  parse(readFileSync(join(repoRootOf({ importMetaUrl: import.meta.url }), CI_WORKFLOW_PATH), "utf8"));

/**
 * The real workflow with its site job's steps rewritten.
 *
 * @param edit what to do to the site job's step list, in place
 * @returns the findings the contract gives the edited workflow
 */
const judgeSite = ({ edit }: { edit: (steps: Record<string, unknown>[]) => void }): readonly string[] => {
  const workflow = realWorkflow();
  const site = jobOf({ job: "site", workflow })!;
  const steps = [...stepsOf({ job: site })!];
  edit(steps);
  site["steps"] = steps;
  return offloadContractFindings({ text: stringify(workflow) }).map((finding) => finding.line);
};

describe("the site job's Nextra-patch witness, on the real ci.yml", () => {
  it("runs the witness straight before the build, both in the site directory", () => {
    const steps = stepsOf({ job: jobOf({ job: "site", workflow: realWorkflow() })! })!;
    expect(steps.slice(-2).map((step) => [step["run"], step["working-directory"]])).toEqual([
      [WITNESS, "site"],
      ["yarn build", "site"],
    ]);
  });

  it("refuses the build run before the witness, by both gates", () => {
    expect(judgeSite({ edit: (steps) => steps.push(...steps.splice(-2, 1)) })).toEqual([
      COLD_STEPS,
      "`jobs.site` runs `yarn test:nextra-patch` and `yarn build` out of declared order",
    ]);
  });

  it("refuses a site job that dropped its witness, by both gates", () => {
    expect(judgeSite({ edit: (steps) => steps.splice(-2, 1) })).toEqual([COLD_STEPS, NO_WITNESS]);
  });

  // The witness moved out of `site/` tests the root project's Nextra.
  it("refuses the witness run at the root or in another directory, by both gates", () => {
    const moved = [{ run: WITNESS }, { run: WITNESS, "working-directory": "desktop" }];
    expect(moved.map((step) => judgeSite({ edit: (steps) => steps.splice(-2, 1, step) }))).toEqual(
      moved.map(() => [COLD_STEPS, NO_WITNESS]),
    );
  });
});
