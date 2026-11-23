/**
 * Every job in `ci.yml` is the `build` aggregator, listed in its `needs`, or a reasoned exclusion. The good fixture's job ids are written out by hand rather than read from the registers under
 * test, so a change to a register cannot silently change what "covered" means here too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { jobCoverageFindings, UNAGGREGATED_JOBS } from "../../../devLint/ciJobCoverage.js";
import { OFFLOAD_JOB, workerJobs } from "../../../devLint/ciOffloadCommands.js";
import { CI_WORKFLOW_PATH } from "../../../devLint/ciOffloadContract.js";
import { repoRootOf } from "../../../lib/gitRepo.js";
import { isRecord } from "../../../lib/parsers.js";

/** The sixteen jobs `ci.yml` declares today: thirteen workers, the aggregator and the two exclusions. */
const GOOD_JOBS = [
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

/** What `build` lists today: the fourteen workers, written out rather than read from the worker register. */
const GOOD_NEEDS = GOOD_JOBS.filter((job) => !["build", "integration", "ci-timing"].includes(job));

/**
 * A jobs-only workflow as the YAML text the gate reads: membership is all this module judges. Every job's map is
 * empty bar `build`, which carries the `needs` it is given (today's workers unless a case says otherwise).
 */
const textOf = ({ jobs, needs = GOOD_NEEDS }: { jobs: readonly string[]; needs?: readonly string[] }): string =>
  stringify({ jobs: Object.fromEntries(jobs.map((job) => [job, job === "build" ? { needs } : {}])) });

/** The finding lines for a jobs-only workflow. */
const linesOf = ({ jobs, needs }: { jobs: readonly string[]; needs?: readonly string[] }): readonly string[] =>
  jobCoverageFindings({ text: textOf(needs === undefined ? { jobs } : { jobs, needs }) }).map((f) => f.line);

/** The `jobs` map of a parsed workflow, throwing when the document has none (the real file always does). */
const jobsOf = ({ workflow }: { workflow: unknown }): Record<string, unknown> => {
  if (!isRecord(workflow) || !isRecord(workflow["jobs"])) {
    throw new Error("ci.yml parsed to a document with no jobs map");
  }
  return workflow["jobs"];
};

const uncovered = ({ job }: { job: string }): string =>
  `\`jobs.${job}\` is outside \`jobs.build.needs\` and on no exclusion list, so it can go red while the required \`build\` check stays green`;

const nonStringKey = ({ key }: { key: string }): string =>
  `a key under \`jobs\` is not a plain job id (${key}), so GitHub's job and this gate's reading of it can differ`;

describe("jobCoverageFindings", () => {
  it("reports nothing when every job is the aggregator, in build.needs, or a reasoned exclusion", () => {
    expect(linesOf({ jobs: GOOD_JOBS })).toEqual([]);
  });

  it("names a job outside build.needs that no register mentions", () => {
    expect(linesOf({ jobs: [...GOOD_JOBS, "e2e"] })).toEqual([uncovered({ job: "e2e" })]);
  });

  it("names every uncovered job, in file order", () => {
    expect(linesOf({ jobs: ["e2e", ...GOOD_JOBS, "docs"] })).toEqual([
      uncovered({ job: "e2e" }),
      uncovered({ job: "docs" }),
    ]);
  });

  it("names an exclusion whose job left the workflow, which would pre-approve a future job of that name", () => {
    const without = GOOD_JOBS.filter((job) => job !== "ci-timing");
    expect(linesOf({ jobs: without })).toEqual([
      "the exclusion for `jobs.ci-timing` names a job that is not in the workflow, so it would pre-approve a future job of that name",
    ]);
  });

  it("names a seventh unit shard present in the file but absent from build.needs", () => {
    expect(linesOf({ jobs: [...GOOD_JOBS, "unit-7"] })).toEqual([uncovered({ job: "unit-7" })]);
  });

  it("names a REGISTERED worker that fell out of build.needs, which the worker register alone would excuse", () => {
    const needs = GOOD_NEEDS.filter((job) => job !== "lint");
    expect(linesOf({ jobs: GOOD_JOBS, needs })).toEqual([uncovered({ job: "lint" })]);
  });

  it("names an exclusion that build.needs also lists, which cannot be both", () => {
    const needs = [...GOOD_NEEDS, "integration"];
    expect(linesOf({ jobs: GOOD_JOBS, needs })).toEqual([
      "`jobs.integration` is on the exclusion list and is also the aggregator or in `jobs.build.needs` — it cannot be both",
    ]);
  });

  it("answers with a finding, never a clean result, when build.needs is not a list", () => {
    const finding =
      "`jobs.build.needs` is missing or is not a list of job ids, so no job can be shown to sit behind it";
    const notAList = { jobs: { build: { needs: "lint" }, integration: {}, ratchet: {} } };
    const missing = { jobs: { build: {}, integration: {}, ratchet: {} } };
    const notIds = { jobs: { build: { needs: [1] }, integration: {}, ratchet: {} } };
    const noBuild = { jobs: { lint: {}, integration: {}, ratchet: {} } };
    expect(
      [notAList, missing, notIds, noBuild].map((workflow) => jobCoverageFindings({ text: stringify(workflow) })),
    ).toEqual([1, 2, 3, 4].map(() => [{ line: finding }]));
  });

  it("answers unevaluated, not covered, for a document with no jobs map or no valid YAML", () => {
    expect([jobCoverageFindings({ text: "on: push" }), jobCoverageFindings({ text: "jobs: [a" })]).toEqual([
      [{ line: "the workflow has no plain `jobs` map to classify", unevaluated: true }],
      [{ line: "the workflow does not parse as YAML, so its jobs cannot be classified", unevaluated: true }],
    ]);
  });
});

describe("jobCoverageFindings over a job key that is not a plain string", () => {
  it("names a numeric key, which parses onto the same property as the string key beside it", () => {
    const text = ["jobs:", "  1: {}", '  "1": {}', "  build:", '    needs: ["1"]'].join("\n");
    expect(jobCoverageFindings({ text }).map((f) => f.line)).toEqual([
      nonStringKey({ key: "1" }),
      nonStringKey({ key: "1" }),
    ]);
  });

  it("names a numeric key in a jobs map reached through a YAML alias", () => {
    const text = ["x-jobs: &all", "  1: {}", '  "1": {}', "  build:", '    needs: ["1"]', "jobs: *all"].join("\n");
    expect(jobCoverageFindings({ text }).map((f) => f.line)).toEqual([
      nonStringKey({ key: "1" }),
      nonStringKey({ key: "1" }),
    ]);
  });

  it("fails closed on a jobs map supplied by an explicit !!merge, which toJS would fold", () => {
    const text = [
      "workflow: &w",
      "  jobs:",
      "    1: {}",
      '    "1": {}',
      "    build:",
      '      needs: ["1"]',
      "!!merge safe: *w",
    ].join("\n");
    expect(jobCoverageFindings({ text })).toEqual([
      { line: "the workflow has no plain `jobs` map to classify", unevaluated: true },
    ]);
  });

  it("names a merge key, which a merge-aware parser reads as another map's jobs", () => {
    const text = ["defaults: &d", "  e2e: {}", "jobs:", "  <<: *d", "  build:", '    needs: ["<<"]'].join("\n");
    expect(jobCoverageFindings({ text }).map((f) => f.line)).toEqual([nonStringKey({ key: "<<" })]);
  });

  it("names a string key that is not shaped like a job id", () => {
    const text = ["jobs:", '  "has space": {}', '  "9lives": {}'].join("\n");
    expect(jobCoverageFindings({ text }).map((f) => f.line)).toEqual([
      nonStringKey({ key: "has space" }),
      nonStringKey({ key: "9lives" }),
    ]);
  });

  it("names a boolean key and a collection key", () => {
    const text = ["jobs:", "  true: {}", "  ? [a, b]", "  : {}", "  lint: {}"].join("\n");
    expect(jobCoverageFindings({ text }).map((f) => f.line)).toEqual([
      nonStringKey({ key: "true" }),
      nonStringKey({ key: "a collection" }),
    ]);
  });

  it("accepts every key quoted, which is still a string", () => {
    const jobs = Object.fromEntries(GOOD_JOBS.map((job) => [job, job === "build" ? { needs: GOOD_NEEDS } : {}]));
    expect(jobCoverageFindings({ text: stringify({ jobs }, { defaultKeyType: "QUOTE_DOUBLE" }) })).toEqual([]);
  });
});

describe("UNAGGREGATED_JOBS, the reasoned exclusion register", () => {
  it("is not empty, so every filter below is a claim about something", () => {
    expect(UNAGGREGATED_JOBS.length).toBeGreaterThan(0);
  });

  it("names a job once and gives each a reason", () => {
    expect(new Set(UNAGGREGATED_JOBS.map((entry) => entry.job)).size).toBe(UNAGGREGATED_JOBS.length);
    expect(UNAGGREGATED_JOBS.filter((entry) => entry.why.trim() === "")).toEqual([]);
  });

  it("never lists the aggregator or a registered worker, which are covered already", () => {
    expect(workerJobs().length).toBeGreaterThan(0);
    expect(UNAGGREGATED_JOBS.filter((entry) => entry.job === OFFLOAD_JOB || workerJobs().includes(entry.job))).toEqual(
      [],
    );
  });
});

describe("this repository's real ci.yml", () => {
  const text = readFileSync(join(repoRootOf({ importMetaUrl: import.meta.url }), CI_WORKFLOW_PATH), "utf8");
  const declared = Object.keys(jobsOf({ workflow: parse(text) }));

  it("declares jobs at all, so the coverage claim below is about something", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it("covers every job it declares, keys each by a plain string, and every exclusion names a job it still declares", () => {
    expect(jobCoverageFindings({ text })).toEqual([]);
  });

  it("declares exactly the jobs the fixture above spells out", () => {
    expect(declared.toSorted()).toEqual(GOOD_JOBS.toSorted());
  });
});
