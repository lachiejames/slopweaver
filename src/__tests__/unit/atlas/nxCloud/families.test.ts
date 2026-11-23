import { describe, expect, it } from "vitest";

import { atPath, measureNxCloudFamily, NX_CLOUD_FAMILY_SPECS } from "../../../../atlas/nxCloud/families.js";

/** The run-list payload's real shape, measured: a deferred page of runs, tasks inline on each. */
const RUN_PAGE = {
  deferredRunListPage: {
    hasNext: true,
    runs: [
      { branch: "main", status: "success", tasks: [{ status: "cache-hit" }, { status: "success" }] },
      { branch: "main", status: "failed", tasks: [{ status: "failed" }] },
    ],
  },
  options: { limit: 20, offset: 0 },
};

const RUN_SPEC = NX_CLOUD_FAMILY_SPECS.find((spec) => spec.name === "run")!;
const TASK_SPEC = NX_CLOUD_FAMILY_SPECS.find((spec) => spec.name === "task")!;
const CIPE_SPEC = NX_CLOUD_FAMILY_SPECS.find((spec) => spec.name === "ci-pipeline-execution")!;

describe("measureNxCloudFamily", () => {
  it("counts the runs one bounded page returned", () => {
    expect(measureNxCloudFamily({ data: RUN_PAGE, spec: RUN_SPEC }).recordsInWindow).toBe(2);
  });

  it("sums the tasks carried inline across that page, rather than counting the runs again", () => {
    expect(measureNxCloudFamily({ data: RUN_PAGE, spec: TASK_SPEC }).recordsInWindow).toBe(3);
  });

  it("reports no platform total for a family whose payload states none", () => {
    expect(measureNxCloudFamily({ data: RUN_PAGE, spec: RUN_SPEC }).reportedTotal).toBe(null);
  });

  it("reads the platform's own count for the pipeline family", () => {
    const measured = measureNxCloudFamily({ data: { cipe: { count: 4321 } }, spec: CIPE_SPEC });
    expect(measured.reportedTotal).toBe(4321);
  });

  it("reports no window count for a family measured only by the platform's own total", () => {
    expect(measureNxCloudFamily({ data: { cipe: { count: 4321 } }, spec: CIPE_SPEC }).recordsInWindow).toBe(null);
  });

  it("truncates a fractional total rather than storing a float as a count", () => {
    expect(measureNxCloudFamily({ data: { cipe: { count: 12.7 } }, spec: CIPE_SPEC }).reportedTotal).toBe(12);
  });

  it("measures nothing at all from a payload the call could not read", () => {
    expect(measureNxCloudFamily({ data: null, spec: RUN_SPEC })).toEqual({
      recordsInWindow: null,
      reportedTotal: null,
    });
  });

  it("measures nothing when the records path is absent, rather than reporting zero records", () => {
    expect(measureNxCloudFamily({ data: { options: {} }, spec: RUN_SPEC }).recordsInWindow).toBe(null);
  });

  it("counts an empty page as zero, which is a different claim from not having looked", () => {
    const empty = { deferredRunListPage: { hasNext: false, runs: [] } };
    expect(measureNxCloudFamily({ data: empty, spec: RUN_SPEC }).recordsInWindow).toBe(0);
  });

  it("counts a run carrying no tasks array as contributing no tasks", () => {
    const noTasks = { deferredRunListPage: { runs: [{ branch: "main" }] } };
    expect(measureNxCloudFamily({ data: noTasks, spec: TASK_SPEC }).recordsInWindow).toBe(0);
  });
});

describe("NX_CLOUD_FAMILY_SPECS", () => {
  it("declares three families, each naming why it is voluminous", () => {
    expect(NX_CLOUD_FAMILY_SPECS.map((spec) => spec.name)).toEqual(["ci-pipeline-execution", "run", "task"]);
  });

  it("gives every family a window description, so a stored count says what it counted", () => {
    expect(NX_CLOUD_FAMILY_SPECS.every((spec) => spec.windowDescription.length > 0)).toBe(true);
  });
});

describe("atPath", () => {
  it("returns the node itself for an empty path", () => {
    expect(atPath({ path: "", source: { a: 1 } })).toEqual({ a: 1 });
  });

  it("follows a dotted path", () => {
    expect(atPath({ path: "a.b", source: { a: { b: 7 } } })).toBe(7);
  });

  it("answers undefined when the path leaves the object", () => {
    expect(atPath({ path: "a.b.c", source: { a: { b: 7 } } })).toBe(undefined);
  });
});
