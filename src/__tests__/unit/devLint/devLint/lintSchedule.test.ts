import { describe, expect, it } from "vitest";
import { type LintCheck, lintChecks } from "../../../../devLint/devLint.js";
import { lintSchedule } from "../../../../devLint/gateRunner.js";

describe("lintSchedule", () => {
  const gate = ({ name, exclusive }: { name: string; exclusive?: true }): LintCheck => ({
    args: [`${name}.entry.ts`],
    cmd: "tsx",
    name,
    ...(exclusive === undefined ? {} : { exclusive }),
  });
  const none: ReadonlyMap<string, number> = new Map();
  const names = ({ segments }: { segments: ReturnType<typeof lintSchedule> }) =>
    segments.map((s) => s.checks.map((c) => c.name));

  it("puts a run of ordinary gates with no record in one segment, in plan order", () => {
    const segments = lintSchedule({
      checks: [gate({ name: "a" }), gate({ name: "b" }), gate({ name: "c" })],
      priorSeconds: none,
    });

    expect(names({ segments })).toEqual([["a", "b", "c"]]);
    expect(segments.map((s) => s.exclusive)).toEqual([false]);
  });

  // The whole point of the split: `named-object-params` reads most of the runner's memory, so a gate beside
  // it is an OOM. If this ever shares a segment, the lap goes red at random again.
  it("runs an exclusive gate alone and FIRST, wherever the plan lists it, so the pool drains once", () => {
    const segments = lintSchedule({
      checks: [gate({ name: "a" }), gate({ exclusive: true, name: "heavy" }), gate({ name: "b" })],
      priorSeconds: none,
    });

    expect(names({ segments })).toEqual([["heavy"], ["a", "b"]]);
    expect(segments.map((s) => s.exclusive)).toEqual([true, false]);
  });

  it("keeps two exclusive gates apart, in plan order, rather than batching them together", () => {
    const segments = lintSchedule({
      checks: [gate({ name: "a" }), gate({ exclusive: true, name: "one" }), gate({ exclusive: true, name: "two" })],
      priorSeconds: none,
    });

    expect(names({ segments })).toEqual([["one"], ["two"], ["a"]]);
  });

  // The seat lane's narrowed oxlint: still past the bespoke-gate slot, so nothing beside it, and last so the
  // lane can withhold it on what the machine is doing when its turn comes.
  it("runs a runsLast gate alone and LAST, after the pool and after every exclusive gate", () => {
    const last: LintCheck = { ...gate({ name: "oxlint" }), runsLast: true };
    const segments = lintSchedule({
      checks: [last, gate({ name: "a" }), gate({ exclusive: true, name: "heavy" }), gate({ name: "b" })],
      priorSeconds: none,
    });

    expect(names({ segments })).toEqual([["heavy"], ["a", "b"], ["oxlint"]]);
    expect(segments.map((s) => s.exclusive)).toEqual([true, false, true]);
  });

  it("runs a runsLast gate selected alone as its one exclusive segment", () => {
    const last: LintCheck = { ...gate({ name: "oxlint" }), runsLast: true };

    expect(lintSchedule({ checks: [last], priorSeconds: none })).toEqual([{ checks: [last], exclusive: true }]);
  });

  it("dispatches the pool longest-first by each gate's recorded seconds", () => {
    const segments = lintSchedule({
      checks: [gate({ name: "quick" }), gate({ name: "slow" }), gate({ name: "middling" })],
      priorSeconds: new Map([
        ["middling", 12.5],
        ["quick", 0.4],
        ["slow", 61.2],
      ]),
    });

    expect(names({ segments })).toEqual([["slow", "middling", "quick"]]);
  });

  // An unknown cost is the one that can sink the tail, so it starts early rather than last — and two of
  // them must not compare as NaN, which would leave the order to the engine.
  it("dispatches a gate with no record first, and keeps two unrecorded gates in plan order", () => {
    const segments = lintSchedule({
      checks: [gate({ name: "known" }), gate({ name: "new-one" }), gate({ name: "new-two" })],
      priorSeconds: new Map([["known", 300]]),
    });

    expect(names({ segments })).toEqual([["new-one", "new-two", "known"]]);
  });

  it("keeps plan order between gates whose recorded seconds are equal", () => {
    const segments = lintSchedule({
      checks: [gate({ name: "b" }), gate({ name: "a" })],
      priorSeconds: new Map([
        ["a", 3],
        ["b", 3],
      ]),
    });

    expect(names({ segments })).toEqual([["b", "a"]]);
  });

  it("answers an exclusive gate selected alone as one exclusive segment", () => {
    const segments = lintSchedule({ checks: [gate({ exclusive: true, name: "heavy" })], priorSeconds: none });

    expect(segments).toEqual([{ checks: [gate({ exclusive: true, name: "heavy" })], exclusive: true }]);
  });

  it("answers nothing for an empty selection", () => {
    expect(lintSchedule({ checks: [], priorSeconds: none })).toEqual([]);
  });

  // Derived from the real plan rather than from a fixture, so flagging a second gate exclusive cannot make
  // this file silently stale — and the assertion is the PROPERTY, not a count that moves with the plan.
  it("schedules every gate of the real plan exactly once, exclusive ones first, never two in one exclusive segment", () => {
    const checks = lintChecks({ cwd: "/repo" });
    const segments = lintSchedule({ checks, priorSeconds: none });

    expect(checks.length).toBeGreaterThan(0);
    expect(segments.flatMap((s) => s.checks).map((c) => c.name)).toEqual([
      ...checks.filter((c) => c.exclusive === true).map((c) => c.name),
      ...checks.filter((c) => c.exclusive !== true).map((c) => c.name),
    ]);
    expect(segments.filter((s) => s.exclusive && s.checks.length !== 1)).toEqual([]);
    expect(segments.at(-1)!.exclusive).toBe(false);
  });
});
