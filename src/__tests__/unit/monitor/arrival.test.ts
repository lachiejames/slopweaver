import { describe, expect, it } from "vitest";

import { foldArrivals } from "../../../monitor/arrival.js";
import type { MonitorSubject } from "../../../monitor/types.js";

function subject({ id }: { id: string }): MonitorSubject {
  return { id, key: id, label: `about ${id}` };
}

const stepIdOf = ({ subject: watched }: { subject: MonitorSubject }): string => `mon-prs-${watched.key}`;

describe("foldArrivals", () => {
  it("treats every subject as an arrival when the register holds nothing", () => {
    const decision = foldArrivals({
      current: [subject({ id: "a" }), subject({ id: "b" })],
      openStepIds: new Set(),
      stepIdOf,
    });
    expect(decision.arrived.map((s) => s.id)).toEqual(["a", "b"]);
    expect(decision.departed).toEqual([]);
  });

  it("reports NOTHING for a subject that is still there, which is the whole rule", () => {
    const decision = foldArrivals({
      current: [subject({ id: "a" })],
      openStepIds: new Set(["mon-prs-a"]),
      stepIdOf,
    });
    expect(decision.arrived).toEqual([]);
    expect(decision.departed).toEqual([]);
  });

  it("settles an open step whose subject has gone", () => {
    const decision = foldArrivals({
      current: [],
      openStepIds: new Set(["mon-prs-a"]),
      stepIdOf,
    });
    expect(decision.arrived).toEqual([]);
    expect(decision.departed).toEqual(["mon-prs-a"]);
  });

  it("arrives and departs in the same pass when the set turns over", () => {
    const decision = foldArrivals({
      current: [subject({ id: "b" })],
      openStepIds: new Set(["mon-prs-a"]),
      stepIdOf,
    });
    expect(decision.arrived.map((s) => s.id)).toEqual(["b"]);
    expect(decision.departed).toEqual(["mon-prs-a"]);
  });

  it("decides nothing at all over an empty world", () => {
    const decision = foldArrivals({ current: [], openStepIds: new Set(), stepIdOf });
    expect(decision.arrived).toEqual([]);
    expect(decision.departed).toEqual([]);
  });

  it("re-arrives a subject the owner settled, because the register is the memory and a settled step is not open", () => {
    const first = foldArrivals({ current: [subject({ id: "a" })], openStepIds: new Set(["mon-prs-a"]), stepIdOf });
    const afterOwnerSettledIt = foldArrivals({ current: [subject({ id: "a" })], openStepIds: new Set(), stepIdOf });
    expect(first.arrived).toEqual([]);
    expect(afterOwnerSettledIt.arrived.map((s) => s.id)).toEqual(["a"]);
  });
});
