/**
 * The aggregator's steps judged alone: the pinned verdict first, then exactly the pinned merge tail. Each case
 * breaks one step of the hand-written good shape in `ciAggregatorFixtures.ts`; the whole-workflow cases, and
 * the real `ci.yml`, are `ciOffloadContract.test.ts`'s.
 */
import { describe, expect, it } from "vitest";
import { verdictStepFindings } from "../../../devLint/ciAggregatorSteps.js";
import { buildTail, VERDICT, verdictStep } from "./ciAggregatorFixtures.js";

const VERDICT_STEP_FINDING =
  'the `build` verdict must be its FIRST step, `run: test "$ALL_SUCCEEDED" = "true"` under `if: ${{ always() }}` ' +
  "and `shell: bash`, with no `continue-on-error` — a step before it could hand it an environment, and a " +
  "`shell:` is a TEMPLATE, so one that never substitutes `{0}` runs no verdict at all";

const TAIL_FINDING =
  "`jobs.build` runs steps after its verdict other than exactly its pinned merge tail (aggregatorTail), so a " +
  "step there could pass the unit merge or the coverage floor without running it";

const ENV_FINDING = `the \`build\` verdict's \`env\` is not exactly ALL_SUCCEEDED: \`${VERDICT}\` — a leg it omits cannot redden it`;

const findings = ({ steps }: { steps: unknown[] }): readonly string[] =>
  verdictStepFindings({ job: { steps } }).map((finding) => finding.line);

/** `build`'s steps with one tail step (counted from the first after the verdict) replaced. */
const withTailStep = ({ at, step }: { at: number; step: Record<string, unknown> }): Record<string, unknown>[] => {
  const tail = buildTail();
  tail[at] = step;
  return [verdictStep(), ...tail];
};

describe("verdictStepFindings — the verdict", () => {
  it("accepts the verdict followed by exactly the pinned tail", () => {
    expect(findings({ steps: [verdictStep(), ...buildTail()] })).toEqual([]);
  });

  it("names a `build` with no steps, whose verdict never runs", () => {
    expect(findings({ steps: [] })).toEqual(["`jobs.build` has no steps, so its verdict never runs"]);
  });

  it("names a verdict that only rejects `failure`, which admits a cancelled or skipped leg", () => {
    const loose = { ...verdictStep(), env: { ALL_SUCCEEDED: "${{ !contains(needs.*.result, 'failure') }}" } };
    expect(findings({ steps: [loose, ...buildTail()] })).toEqual([ENV_FINDING]);
  });

  // A second variable, even one ENV_KEYS allows elsewhere, is not the verdict's.
  it("names a verdict carrying any variable beside ALL_SUCCEEDED", () => {
    const extra = { ...verdictStep(), env: { ALL_SUCCEEDED: VERDICT, MIN_TOTAL_MIB: 1 } };
    expect(findings({ steps: [extra, ...buildTail()] })).toEqual([ENV_FINDING]);
  });

  it("names a verdict run line that was loosened", () => {
    expect(findings({ steps: [{ ...verdictStep(), run: "true" }, ...buildTail()] })).toEqual([VERDICT_STEP_FINDING]);
  });

  // A counterexample against this gate's own property, and the reason `shell` is pinned rather than merely
  // banned: a `shell:` value is a TEMPLATE, so one that never substitutes `{0}` runs the shell and not the
  // script, leaving `run`, `if`, `env` and `needs` untouched and `build` green over a red leg.
  it("names a verdict whose shell never runs the verdict script", () => {
    const shell = { ...verdictStep(), shell: "bash -c 'exit 0' {0}" };
    expect(findings({ steps: [shell, ...buildTail()] })).toEqual([VERDICT_STEP_FINDING]);
  });

  it("refuses a step ahead of the verdict, which could hand it an environment", () => {
    expect(findings({ steps: [{ run: "corepack enable" }, verdictStep(), ...buildTail()] })).toEqual([
      VERDICT_STEP_FINDING,
      TAIL_FINDING,
      ENV_FINDING,
    ]);
  });
});

// The `unit` job this replaced waited for a runner of its own; folding it into `build` must not loosen what a
// green `build` proves, so every step after the verdict is pinned whole.
describe("verdictStepFindings — the merge tail", () => {
  it("refuses a post-verdict step that could pass the merge or the floor without it", () => {
    const merge = 8;
    const floor = 9;
    const variants = [
      { at: floor, step: { if: "${{ always() }}", run: "yarn coverage:ratchet" } },
      { at: merge, step: { "continue-on-error": true, run: "yarn test:unit:merge" } },
      { at: floor, step: { run: "yarn coverage:ratchet", shell: "bash -c 'exit 0' {0}" } },
      { at: merge, step: { run: "yarn test:unit:merge || true" } },
      { at: floor, step: { env: { CI: "true" }, run: "yarn coverage:ratchet" } },
    ];
    expect(variants.map(({ at, step }) => findings({ steps: withTailStep({ at, step }) }))).toEqual(
      variants.map(() => [TAIL_FINDING]),
    );
  });

  it("refuses a step appended after the floor, and the floor dropped from the tail", () => {
    const appended = [verdictStep(), ...buildTail(), { run: "yarn coverage:ratchet" }];
    const dropped = [verdictStep(), ...buildTail().slice(0, -1)];
    expect([appended, dropped].map((steps) => findings({ steps }))).toEqual([[TAIL_FINDING], [TAIL_FINDING]]);
  });

  it("ignores a step's name and an action's ref, which change nothing it does", () => {
    const tail: Record<string, unknown>[] = buildTail().map((step) => ({ ...step, name: "renamed" }));
    tail[1] = { uses: "actions/checkout@v9" };
    expect(findings({ steps: [verdictStep(), ...tail] })).toEqual([]);
  });
});
