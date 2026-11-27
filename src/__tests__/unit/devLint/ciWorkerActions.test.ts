import { describe, expect, it } from "vitest";
import { DEPENDENCY_CACHE_INPUTS } from "../../../devLint/ciDependencyCache.js";
import {
  allowedActions,
  artifactInputs,
  DESKTOP_E2E_JOB,
  UNIT_MERGE_JOB,
  workerActionFindings,
} from "../../../devLint/ciWorkerActions.js";

/** The cached install every job but a cold one opens with, so the cache contract judges nothing here. */
const CACHED_INSTALL = [
  { id: "deps", uses: "actions/cache/restore@v4", with: DEPENDENCY_CACHE_INPUTS },
  { run: "yarn install --immutable" },
];

const SHARDS = ["unit-1", "unit-2", "unit-3", "unit-4", "unit-5", "unit-6"];

/** A workflow with one shard, the merge and one other worker, each using the actions its test names. */
const workflowWith = ({
  merge,
  other,
  shard,
}: {
  merge: { needs: readonly string[]; uses: readonly string[] };
  other: readonly string[];
  shard: readonly string[];
}): unknown => ({
  jobs: {
    lint: { steps: [...CACHED_INSTALL, ...other.map((uses) => ({ uses }))] },
    "unit-1": {
      steps: [...CACHED_INSTALL, ...shard.map((uses) => ({ uses, with: artifactInputs({ job: "unit-1" }) }))],
    },
    [UNIT_MERGE_JOB]: {
      needs: merge.needs,
      steps: [
        ...CACHED_INSTALL,
        ...merge.uses.map((uses) => ({ uses, with: artifactInputs({ job: UNIT_MERGE_JOB }) })),
      ],
    },
  },
});

const WORKERS = ["lint", "unit-1", UNIT_MERGE_JOB];

describe("UNIT_MERGE_JOB", () => {
  it("is the required aggregator itself, so the merge waits for no runner of its own", () => {
    expect(UNIT_MERGE_JOB).toBe("build");
  });
});

describe("allowedActions", () => {
  it("lets a shard upload its report, and nothing else beyond the two every worker needs", () => {
    expect(allowedActions({ job: "unit-4" })).toEqual([
      "actions/checkout",
      "actions/setup-node",
      "actions/cache/restore",
      "actions/cache/save",
      "actions/upload-artifact",
    ]);
  });

  it("lets the merge job download the reports", () => {
    expect(allowedActions({ job: "build" })).toEqual([
      "actions/checkout",
      "actions/setup-node",
      "actions/cache/restore",
      "actions/cache/save",
      "actions/download-artifact",
    ]);
  });

  it("lets the browser lane upload its failure evidence, and download nothing", () => {
    expect(allowedActions({ job: DESKTOP_E2E_JOB })).toEqual([
      "actions/checkout",
      "actions/setup-node",
      "actions/cache/restore",
      "actions/cache/save",
      "actions/upload-artifact",
    ]);
  });

  it("widens nothing for any other worker", () => {
    expect(allowedActions({ job: "lint" })).toEqual([
      "actions/checkout",
      "actions/setup-node",
      "actions/cache/restore",
      "actions/cache/save",
    ]);
  });
});

describe("workerActionFindings", () => {
  it("reports nothing when each job uses only its own actions and the merge needs every shard", () => {
    const workflow = workflowWith({
      merge: { needs: SHARDS, uses: ["actions/checkout@v7", "actions/download-artifact@v4"] },
      other: ["actions/checkout@v7", "actions/setup-node@v7"],
      shard: ["actions/checkout@v7", "actions/upload-artifact@v4"],
    });
    expect(workerActionFindings({ workers: WORKERS, workflow })).toEqual([]);
  });

  it("refuses an artifact action in a worker that is not part of the unit lane", () => {
    const workflow = workflowWith({
      merge: { needs: SHARDS, uses: [] },
      other: ["actions/download-artifact@v4"],
      shard: [],
    });
    expect(workerActionFindings({ workers: WORKERS, workflow }).map((finding) => finding.line)).toEqual([
      "`jobs.lint` uses `actions/download-artifact@v4`, which is not one of actions/checkout or actions/setup-node or actions/cache/restore or actions/cache/save",
    ]);
  });

  it("refuses a download in a shard, which could hand it another shard's report", () => {
    const workflow = workflowWith({
      merge: { needs: SHARDS, uses: [] },
      other: [],
      shard: ["actions/download-artifact@v4"],
    });
    expect(workerActionFindings({ workers: WORKERS, workflow }).map((finding) => finding.line)).toEqual([
      "`jobs.unit-1` uses `actions/download-artifact@v4`, which is not one of actions/checkout or actions/setup-node or actions/cache/restore or actions/cache/save or actions/upload-artifact",
    ]);
  });

  it("names a shard the merge does not need, so it could read the directory before that report exists", () => {
    const workflow = workflowWith({
      merge: { needs: SHARDS.filter((job) => job !== "unit-5"), uses: [] },
      other: [],
      shard: [],
    });
    expect(workerActionFindings({ workers: WORKERS, workflow }).map((finding) => finding.line)).toEqual([
      "`jobs.build` does not need `unit-5`, so it could merge before that shard's report exists",
    ]);
  });

  // The merge job is the aggregator, which needs every worker under `always()`; `aggregatorFindings` pins
  // that list exactly, so this rule refuses nothing beyond a missing shard.
  it("leaves the merge job's needs beyond its shards to the aggregator's exact pin", () => {
    const workflow = workflowWith({ merge: { needs: [...SHARDS, "lint"], uses: [] }, other: [], shard: [] });
    expect(workerActionFindings({ workers: WORKERS, workflow })).toEqual([]);
  });

  it("refuses any need on another worker, the cache writer's skip among them", () => {
    const base = workflowWith({ merge: { needs: SHARDS, uses: [] }, other: [], shard: [] }) as {
      jobs: Record<string, Record<string, unknown>>;
    };
    const workflow = { jobs: { ...base.jobs, lint: { ...base.jobs["lint"], needs: "integration" } } };
    expect(workerActionFindings({ workers: WORKERS, workflow }).map((finding) => finding.line)).toEqual([
      "`jobs.lint` sets `needs`, so a skipped dependency would skip it, its runner-facts refusal and any cache save with it",
    ]);
  });
});

describe("artifact inputs", () => {
  it("pins a shard's upload to its own report directory under its own name", () => {
    expect(artifactInputs({ job: "unit-3" })).toEqual({
      "if-no-files-found": "error",
      "include-hidden-files": true,
      name: "unit-blob-3",
      path: ".vitest-reports/",
      "retention-days": 1,
    });
  });

  it("pins the merge's download into the report directory", () => {
    expect(artifactInputs({ job: "build" })).toEqual({
      "merge-multiple": true,
      path: ".vitest-reports",
      pattern: "unit-blob-*",
    });
  });

  it("refuses a browser-lane upload of anything but its own report and failure evidence", () => {
    const workflow = {
      jobs: {
        [DESKTOP_E2E_JOB]: {
          steps: [
            ...CACHED_INSTALL,
            { run: "yarn test:e2e" },
            { if: "failure()", uses: "actions/upload-artifact@v4", with: { name: "desktop-e2e-evidence", path: "." } },
          ],
        },
      },
    };
    expect(workerActionFindings({ workers: [DESKTOP_E2E_JOB], workflow }).map((finding) => finding.line)).toEqual([
      `\`jobs.desktop-e2e\` passes its artifact action inputs other than {"if-no-files-found":"ignore","name":"desktop-e2e-evidence","path":"playwright-report/\\ntest-results/playwright/\\n","retention-days":7}, so an artifact could land outside the report directory`,
    ]);
  });

  it("refuses a download whose path could overwrite the scripts the merge and floor run", () => {
    const workflow = {
      jobs: {
        build: {
          needs: SHARDS,
          steps: [
            ...CACHED_INSTALL,
            {
              uses: "actions/download-artifact@v4",
              with: { "merge-multiple": true, path: ".", pattern: "unit-blob-*" },
            },
          ],
        },
      },
    };
    expect(workerActionFindings({ workers: ["build"], workflow }).map((finding) => finding.line)).toEqual([
      `\`jobs.build\` passes its artifact action inputs other than {"merge-multiple":true,"path":".vitest-reports","pattern":"unit-blob-*"}, so an artifact could land outside the report directory`,
    ]);
  });
});
