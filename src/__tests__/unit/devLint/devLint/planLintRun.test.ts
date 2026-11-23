import { describe, expect, it } from "vitest";
import { type LintCheck, lintChecks, planLintRun } from "../../../../devLint/devLint.js";
import { type SeatLintContext } from "../../../../devLint/seatLint.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A three-check plan whose middle entry is the off-repo-state one, so lane and selection can be told apart. */
const PLAN: readonly LintCheck[] = [
  { args: [], cmd: "/bin/a", name: "alpha" },
  { args: [], cmd: "/bin/b", name: "beta", offRepoState: true },
  { args: [], cmd: "/bin/c", name: "gamma" },
];

const BASE = "a".repeat(40);

/** One row of each seat-lane kind: narrowed, kept, exclusive, knip, deferred. */
const SEAT_PLAN: readonly LintCheck[] = [
  { args: ["--type-aware", "."], cmd: "/bin/oxlint", env: { GOMAXPROCS: "4" }, exclusive: true, name: "oxlint" },
  { args: [], cmd: "/bin/n", exclusive: true, name: "named-object-params" },
  { args: [], cmd: "/bin/k", name: "knip" },
  { args: [], cmd: "/bin/p", name: "prettier" },
  { args: [], cmd: "/bin/h", name: "host-wording" },
];

const SEAT: SeatLintContext = {
  baseSha: BASE,
  changedOxlintFiles: ["src/a.ts"],
  fetch: { ageMs: 60_000, source: "FETCH_HEAD" },
};

describe("planLintRun", () => {
  it("runs the whole plan when the tail is empty, skipping nothing and calling the run whole", () => {
    const run = unwrap(planLintRun({ checks: PLAN, rest: [] }));
    expect(run.running.map((c) => c.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(run.skipped).toEqual([]);
    expect(run.partial).toBe(false);
    expect(run.laneScope).toEqual({ ran: 3, total: 3 });
  });

  it("keeps only the off-repo-state check on the local lane and names the rest as skipped", () => {
    const run = unwrap(planLintRun({ checks: PLAN, rest: ["--lane", "local"] }));
    expect(run.running.map((c) => c.name)).toEqual(["beta"]);
    expect(run.skipped).toEqual(["alpha", "gamma"]);
    expect(run.partial).toBe(false);
    expect(run.laneScope).toEqual({ ran: 1, total: 3 });
  });

  it("runs ONLY the named gate — the whole point of the flag", () => {
    const run = unwrap(planLintRun({ checks: PLAN, rest: ["--only", "gamma"] }));
    expect(run.running.map((c) => c.name)).toEqual(["gamma"]);
    expect(run.skipped).toEqual([]);
    expect(run.partial).toBe(true);
  });

  it("keeps plan order rather than the order --only listed them in", () => {
    const run = unwrap(planLintRun({ checks: PLAN, rest: ["--only", "gamma,alpha"] }));
    expect(run.running.map((c) => c.name)).toEqual(["alpha", "gamma"]);
  });

  it("refuses a name that is not a gate, listing the ones that are", () => {
    const refusal = unwrapErr(planLintRun({ checks: PLAN, rest: ["--only", "delta"] }));
    expect(refusal.code).toBe("BAD_INVOCATION");
    expect(refusal.reasons).toEqual(["dev lint: --only names no such gate: delta", "known gates: alpha, beta, gamma"]);
  });

  it("refuses the whole run when only SOME names are gates, never running the half it recognised", () => {
    const refusal = unwrapErr(planLintRun({ checks: PLAN, rest: ["--only", "alpha,delta"] }));
    expect(refusal.reasons[0]).toBe("dev lint: --only names no such gate: delta");
  });

  it("refuses --only with no value rather than falling back to the whole plan", () => {
    expect(unwrapErr(planLintRun({ checks: PLAN, rest: ["--only"] })).reasons).toEqual([
      "dev lint: --only takes one or more comma-separated gate names, not `(no value)`",
    ]);
  });

  it("refuses an unrecognised lane before it reads --only at all", () => {
    const refusal = unwrapErr(planLintRun({ checks: PLAN, rest: ["--lane", "quick", "--only", "delta"] }));
    expect(refusal.reasons).toEqual(["dev lint: --lane takes `full`, `local` or `seat`, not `quick`"]);
  });

  it("refuses a selection this lane runs none of, rather than passing vacuously on no checks", () => {
    const refusal = unwrapErr(planLintRun({ checks: PLAN, rest: ["--only", "alpha", "--lane", "local"] }));
    // The one plan failure that is POLICY rather than a typo, so it is the one that earns the four lines.
    expect(refusal.code).toBe("EMPTY_SELECTION");
    expect(refusal.reasons).toEqual(["dev lint: --only selected nothing the `local` lane runs: alpha"]);
  });

  it("composes --only with the lane when the selection still leaves something to run", () => {
    const run = unwrap(planLintRun({ checks: PLAN, rest: ["--only", "alpha,beta", "--lane", "local"] }));
    expect(run.running.map((c) => c.name)).toEqual(["beta"]);
    expect(run.skipped).toEqual(["alpha"]);
    expect(run.partial).toBe(true);
  });

  it("reports laneScope over the WHOLE plan even when --only narrowed the run to one gate", () => {
    // The lane line and the `--only` line answer different questions: how much of the bar this LANE is,
    // against what this RUN actually spawned. A laneScope computed over the selection would make a narrow
    // local run claim it had covered the lane.
    const run = unwrap(planLintRun({ checks: PLAN, rest: ["--only", "beta", "--lane", "local"] }));
    expect(run.running.map((c) => c.name)).toEqual(["beta"]);
    expect(run.laneScope).toEqual({ ran: 1, total: 3 });
  });

  it("refuses the seat lane when nothing resolved its base, rather than planning gates with none", () => {
    const refusal = unwrapErr(planLintRun({ checks: PLAN, rest: ["--lane", "seat"] }));
    expect(refusal.code).toBe("BAD_INVOCATION");
    expect(refusal.reasons).toEqual([
      "dev lint: the `seat` lane is planned only once its base is resolved — `runDevLint` resolves it",
    ]);
  });

  it("plans the seat lane without the whole-project gates, narrows oxlint and hands every gate the base", () => {
    const run = unwrap(planLintRun({ checks: SEAT_PLAN, rest: ["--lane", "seat"], seat: SEAT }));
    expect(run.running).toEqual([
      {
        args: ["--type-aware", "--no-error-on-unmatched-pattern", "--", "src/a.ts"],
        cmd: "/bin/oxlint",
        env: { GOMAXPROCS: "4", SLOPWEAVER_COVERAGE_BASE_SHA: BASE },
        name: "oxlint",
        runsLast: true,
      },
      { args: [], cmd: "/bin/h", env: { SLOPWEAVER_COVERAGE_BASE_SHA: BASE }, name: "host-wording" },
    ]);
    expect(run.skipped).toEqual(["named-object-params", "knip", "prettier"]);
    expect(run.laneScope).toEqual({ ran: 2, total: 5 });
    expect(run.uncovered).toEqual(["named-object-params", "knip", "prettier", "whole-tree oxlint", "typecheck"]);
  });

  it("drops oxlint from a seat run when the branch changed nothing it lints, rather than linting the tree", () => {
    const run = unwrap(
      planLintRun({ checks: SEAT_PLAN, rest: ["--lane", "seat"], seat: { ...SEAT, changedOxlintFiles: [] } }),
    );
    expect(run.running.map((c) => c.name)).toEqual(["host-wording"]);
    expect(run.laneScope).toEqual({ ran: 1, total: 5 });
  });

  it("refuses `--only oxlint` on a seat with no eligible files, saying why it is empty", () => {
    const refusal = unwrapErr(
      planLintRun({
        checks: SEAT_PLAN,
        rest: ["--lane", "seat", "--only", "oxlint"],
        seat: { ...SEAT, changedOxlintFiles: [] },
      }),
    );
    expect(refusal.code).toBe("EMPTY_SELECTION");
    expect(refusal.reasons).toEqual([
      "dev lint: --only selected nothing the `seat` lane runs: oxlint",
      "the seat lane narrows oxlint to the changed files, and this branch changed none oxlint lints",
    ]);
  });

  it("leaves every other lane's checks untouched when a seat context is passed anyway", () => {
    const run = unwrap(planLintRun({ checks: SEAT_PLAN, rest: [], seat: SEAT }));
    expect(run.running).toEqual(SEAT_PLAN);
    expect(run.uncovered).toEqual([]);
  });

  it("selects every real gate name the shipped plan carries", () => {
    const checks = lintChecks({ cwd: "/repo" });
    const run = unwrap(planLintRun({ checks, rest: ["--only", "jsdoc-tags,redos-check"] }));
    expect(run.running.map((c) => c.name)).toEqual(["jsdoc-tags", "redos-check"]);
  });
});
