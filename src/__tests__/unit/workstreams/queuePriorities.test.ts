/*
 * The owner's priorities as reconcile reads them — the same set and order the Queue lifts.
 */
import { describe, expect, it } from "vitest";

import { queuePriorities } from "../../../workstreams/queuePriorities.js";
import type { WorkstreamAggregate } from "../../../workstreams/store/types.js";
import { acmeLocal, acmeOutcome, OWN_DETAIL } from "../../workstreamStoreFixtures.js";

const URGENT = { anchor: "transcript:a#c", because: "the owner called it the top one", level: "urgent" };

/**
 * One outcome workstream with detail fields overlaid.
 *
 * @param id its id
 * @param detail the fields to overlay on the valid detail
 * @returns the aggregate
 */
function outcome({ detail, id }: { detail: Readonly<Record<string, unknown>>; id: string }): WorkstreamAggregate {
  return acmeOutcome({ detail: { ...OWN_DETAIL, ...detail }, id });
}

describe("queuePriorities", () => {
  it("names each urgent workstream's board tag, the first-ranked first and an unranked one last", () => {
    const workstreams = [
      outcome({ detail: { priority: URGENT, queueWorkstream: "dependencies" }, id: "acme-deps" }),
      outcome({ detail: { priority: { ...URGENT, rank: 2 }, queueWorkstream: "iso-certification" }, id: "acme-iso" }),
      outcome({ detail: { priority: { ...URGENT, rank: 1 }, queueWorkstream: "onboarding-flow" }, id: "acme-logs" }),
    ];
    expect(queuePriorities({ workstreams })).toEqual(["onboarding-flow", "iso-certification", "dependencies"]);
  });

  it("keeps the order given among the unranked", () => {
    const workstreams = [
      outcome({ detail: { priority: URGENT, queueWorkstream: "onboarding-flow" }, id: "acme-logs" }),
      outcome({ detail: { priority: URGENT, queueWorkstream: "dependencies" }, id: "acme-deps" }),
    ];
    expect(queuePriorities({ workstreams })).toEqual(["onboarding-flow", "dependencies"]);
  });

  it("names none that is not urgent, states no board tag, has ended or carries no priority of its kind", () => {
    const workstreams = [
      outcome({ detail: { queueWorkstream: "dependencies" }, id: "acme-deps" }),
      outcome({ detail: { priority: URGENT }, id: "acme-iso" }),
      outcome({
        detail: {
          ending: { anchor: "talk:x", kind: "abandoned", on: "2026-11-01", reason: "dropped" },
          priority: URGENT,
          queueWorkstream: "x",
        },
        id: "acme-ended",
      }),
      acmeLocal({ id: "acme-local" }),
    ];
    expect(queuePriorities({ workstreams })).toEqual([]);
  });
});
