/**
 * What a batch decides from the revisions it read under lock: the whole-register baseline first, then each stated
 * revision in id order, then every link against the ids the batch leaves — and which deleted workstream a survivor
 * still links to.
 */
import { describe, expect, it } from "vitest";

import { planWorkstreamBatch, survivingReferenceOf } from "../../../../workstreams/store/batchPlan.js";
import type { WorkstreamBatchRequest } from "../../../../workstreams/store/judge.js";
import type { WorkstreamAggregate } from "../../../../workstreams/store/types.js";
import { acmeLocal } from "../../../workstreamStoreFixtures.js";

/**
 * A local workstream linking each of `targets`.
 *
 * @returns the aggregate
 */
function linking({ id, targets }: { id: string; targets: readonly string[] }): WorkstreamAggregate {
  return {
    ...acmeLocal({ id }),
    links: targets.map((target, at) => ({
      id: `00000000-0000-4000-8000-00000000000${String(at)}`,
      kind: "workstream" as const,
      label: null,
      milestoneId: null,
      target,
    })),
  };
}

describe("planWorkstreamBatch", () => {
  it("lets two new workstreams link each other, because both are in the register the batch leaves", () => {
    const request: WorkstreamBatchRequest = {
      deletes: [],
      writes: [
        { aggregate: linking({ id: "acme-a", targets: ["acme-b"] }), expectedRevision: null },
        { aggregate: linking({ id: "acme-b", targets: ["acme-a"] }), expectedRevision: null },
      ],
    };

    expect(planWorkstreamBatch({ held: { "acme-old": 3 }, request })).toEqual({
      finalIds: ["acme-a", "acme-b", "acme-old"],
    });
  });

  it("refuses a link to a workstream the same batch deletes, naming every missing target once", () => {
    const request: WorkstreamBatchRequest = {
      deletes: [{ expectedRevision: 3, workstreamId: "acme-old" }],
      writes: [
        {
          aggregate: linking({ id: "acme-a", targets: ["acme-old", "acme-gone", "acme-old"] }),
          expectedRevision: null,
        },
      ],
    };

    expect(planWorkstreamBatch({ held: { "acme-old": 3 }, request })).toEqual({
      refusal: { kind: "missing-targets", missing: ["acme-gone", "acme-old"], workstreamId: "acme-a" },
    });
  });

  it("refuses the first stale revision in id order, a create of a held id among them", () => {
    const request: WorkstreamBatchRequest = {
      deletes: [{ expectedRevision: 1, workstreamId: "acme-z" }],
      writes: [{ aggregate: acmeLocal({ id: "acme-m" }), expectedRevision: null }],
    };

    expect(planWorkstreamBatch({ held: { "acme-m": 1, "acme-z": 2 }, request })).toEqual({
      refusal: { expectedRevision: null, kind: "workstream-conflict", workstreamId: "acme-m" },
    });
  });

  it("refuses a whole-register baseline that misses a workstream added since, before any revision is checked", () => {
    const request: WorkstreamBatchRequest = {
      deletes: [{ expectedRevision: 9, workstreamId: "acme-a" }],
      wholeRegister: { "acme-a": 1 },
      writes: [],
    };

    expect(planWorkstreamBatch({ held: { "acme-a": 1, "acme-b": 1 }, request })).toEqual({
      refusal: { actual: { "acme-a": 1, "acme-b": 1 }, expected: { "acme-a": 1 }, kind: "whole-register-conflict" },
    });
  });

  it("does not read an inherited property as a held revision", () => {
    const request: WorkstreamBatchRequest = {
      deletes: [{ expectedRevision: 1, workstreamId: "constructor" }],
      writes: [],
    };

    expect(planWorkstreamBatch({ held: {}, request })).toEqual({
      refusal: { expectedRevision: 1, kind: "workstream-conflict", workstreamId: "constructor" },
    });
  });
});

describe("survivingReferenceOf", () => {
  it("ignores a link whose owner the batch also deletes, and names every survivor linking the first deleted target", () => {
    const links = [
      { target: "acme-b", workstreamId: "acme-a" },
      { target: "acme-c", workstreamId: "acme-z" },
      { target: "acme-c", workstreamId: "acme-y" },
      { target: "acme-c", workstreamId: "acme-b" },
    ];

    expect(survivingReferenceOf({ deleted: ["acme-a", "acme-b"], links })).toBeUndefined();
    expect(survivingReferenceOf({ deleted: ["acme-c", "acme-b"], links })).toEqual({
      kind: "referenced",
      referencedBy: ["acme-a"],
      workstreamId: "acme-b",
    });
    expect(survivingReferenceOf({ deleted: ["acme-c"], links })).toEqual({
      kind: "referenced",
      referencedBy: ["acme-b", "acme-y", "acme-z"],
      workstreamId: "acme-c",
    });
  });
});
