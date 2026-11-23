/**
 * The `build` aggregator's verdict line, run through a real `bash` with each value GitHub can hand it.
 *
 * `ci-offload-contract` pins the step's SHAPE — the `always()` conditions and the per-worker `== 'success'`
 * comparisons — but a shape check cannot say what the shell line does with what that expression evaluates to.
 * This does: it reads the `run:` straight out of the shipped `ci.yml`, so a loosened line fails here as well
 * as in the gate. It proves the shell predicate only; GitHub's own expression evaluation is proved by a hosted
 * run, which no test in this repository can stand in for.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { OFFLOAD_JOB } from "../../../devLint/ciOffloadCommands.js";
import { CI_WORKFLOW_PATH } from "../../../devLint/ciOffloadContract.js";
import { jobOf, stepsOf } from "../../../devLint/ciWorkflowRead.js";
import { repoRootOf } from "../../../lib/gitRepo.js";

const workflow: unknown = parse(
  readFileSync(join(repoRootOf({ importMetaUrl: import.meta.url }), CI_WORKFLOW_PATH), "utf8"),
);
const verdictRun = String(stepsOf({ job: jobOf({ job: OFFLOAD_JOB, workflow })! })![0]!["run"]);

const exitFor = ({ value }: { value: string }): number | null =>
  spawnSync("bash", ["-c", verdictRun], { env: { ...process.env, ALL_SUCCEEDED: value }, timeout: 10_000 }).status;

describe("the build verdict, as bash runs it", () => {
  it("passes only when GitHub's expression evaluated to true", () => {
    expect(exitFor({ value: "true" })).toBe(0);
  });

  it("fails when any leg was not a success", () => {
    expect(exitFor({ value: "false" })).toBe(1);
  });

  it("fails on an empty value, which is what a missing need evaluates to", () => {
    expect(exitFor({ value: "" })).toBe(1);
  });

  it("fails on a value that only looks true", () => {
    expect(exitFor({ value: "True" })).toBe(1);
  });
});
