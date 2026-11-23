/**
 * The one order an aggregate is held in, and the round trip it buys: a put in any order reads back exactly as the
 * aggregate the store was handed.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap } from "../../../../lib/result.js";
import { byCodeUnit, canonicalAggregate } from "../../../../workstreams/store/canonical.js";
import { type WorkstreamRows, workstreamStore } from "../../../../workstreams/store/port.js";
import type { WorkstreamAggregate, WorkstreamLink } from "../../../../workstreams/store/types.js";
import { acmeOutcome, rowsOf } from "../../../workstreamStoreFixtures.js";

/**
 * A `queue_card` link to the given card, its UUID ending in `n`.
 *
 * @returns the link
 */
function card({ n, target }: { n: number; target: string }): WorkstreamLink {
  return { id: `00000000-0000-4000-8000-00000000000${n}`, kind: "queue_card", label: null, milestoneId: null, target };
}

/**
 * The valid outcome aggregate with every child collection written out of canonical order. The automation's target
 * sorts after every card's, so ordering links by target alone (skipping kind) gives a different answer.
 */
const SCRAMBLED: WorkstreamAggregate = acmeOutcome({
  entries: acmeOutcome().entries.toReversed(),
  links: [
    card({ n: 1, target: "z-card" }),
    {
      id: "00000000-0000-4000-8000-000000000009",
      kind: "automation",
      label: null,
      milestoneId: null,
      target: "zz-job",
    },
    card({ n: 2, target: "b-card" }),
  ],
  milestones: acmeOutcome()
    .milestones.toReversed()
    .map((one) => ({ ...one, after: one.after.toReversed() })),
});

describe("canonicalAggregate", () => {
  it("orders milestones and entries by position, after by id, and links by kind then target by code unit", () => {
    const canonical = canonicalAggregate({ aggregate: SCRAMBLED });

    expect(canonical.milestones.map((one) => one.id)).toEqual(["scope", "pilot", "rollout"]);
    expect(canonical.milestones[2]!.after).toEqual(["pilot", "scope"]);
    expect(canonical.entries.map((one) => one.position)).toEqual([0, 1]);
    expect(canonical.links.map((one) => `${one.kind} ${one.target}`)).toEqual([
      "automation zz-job",
      "queue_card b-card",
      "queue_card z-card",
    ]);
  });

  it("compares by code unit, never by locale", () => {
    expect(["b", "a", "B", "a"].toSorted((a, b) => byCodeUnit({ a, b }))).toEqual(["B", "a", "a", "b"]);
  });
});

describe("a put reads back as what the store was handed", () => {
  // That `put` returns the read-back rather than its input is `port.test.ts`, whose read-back differs from the input.
  it("hands the store the canonical aggregate, and the rows written from it decode back to exactly that", async () => {
    const handed: WorkstreamAggregate[] = [];
    const rows: WorkstreamRows = {
      applyBatch: async () => {
        throw new Error("a put never runs a batch");
      },
      close: async () => {},
      deleteWorkstream: async () => ok({ kind: "deleted" }),
      readAll: async () => ok({ edges: [], entries: [], links: [], meta: [], milestones: [], workstreams: [] }),
      writeAggregate: async ({ aggregate }) => {
        handed.push(aggregate);
        return ok({ kind: "written", lockedTargets: [], rows: rowsOf({ aggregate }) });
      },
      writeMeta: async () => ok(undefined),
    };
    const store = workstreamStore({ seams: { connect: async () => ok(rows) } });
    const stored = unwrap(await store.put({ aggregate: SCRAMBLED, expectedRevision: null, home: "/acme/home" }));
    const { createdAtIso, progress, revision, updatedAtIso, ...readBack } = stored;

    expect(handed).toEqual([canonicalAggregate({ aggregate: SCRAMBLED })]);
    expect(readBack).toEqual(handed[0]);
    expect({ createdAtIso, doneCount: progress!.doneCount, revision, updatedAtIso }).toEqual({
      createdAtIso: "2026-11-06T13:31:00.000Z",
      doneCount: 1,
      revision: 1,
      updatedAtIso: "2026-11-06T13:31:00.000Z",
    });
  });
});
