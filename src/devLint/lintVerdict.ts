/**
 * What a `dev lint` run SAYS once its gates have settled: each gate's summary line, the composed exit code, and
 * the closing lines that state how much of the bar the run actually was. Pure, and split from `./devLint.ts`,
 * which plans and spawns, along that seam: everything here reads finished results and returns text or a code.
 */
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../cli/exitCodes.js";
import type { LintCheckResult, LintLane } from "./devLint.js";
import { secondsLabel } from "./gateRunner.js";

/**
 * One gate's line in the closing summary: its verdict, how long it took, and whether it was killed or withheld.
 *
 * The timing is not decoration — it is what makes `GATE_TIMEOUT_MS` (`./gateRunner.ts`) re-measurable from an
 * ordinary lap instead of from a bespoke instrumentation run.
 *
 * @param result the gate's outcome
 * @returns the summary line, without its trailing newline
 * @internal — `runDevLint` and this module's test.
 */
export function lintSummaryLine({ result }: { result: LintCheckResult }): string {
  if (result.withheld !== undefined) {
    return `  – ${result.name} — NOT RUN, withheld: ${result.withheld}`;
  }
  const time = result.elapsedMs === undefined ? "" : ` (${secondsLabel({ ms: result.elapsedMs })})`;
  const hung = result.hung === true ? " — HUNG, killed at the ceiling" : "";
  return `  ${result.ok ? "✓" : "✗"} ${result.name}${time}${hung}`;
}

/**
 * Compose the final verdict: `ok` iff every PLANNED check reported and passed. Pure.
 *
 * Fail closed: `every` is true of an empty list, so a lap that ran nothing — or lost a
 * gate's outcome between spawn and summary — would otherwise read PASS. Each planned gate must report
 * EXACTLY once by name: a count alone lets a duplicated green outcome stand in for a missing one.
 *
 * A WITHHELD gate is never a pass: when every gate that ran passed and the only gap is a withheld one, the
 * exit is `EXIT_DEFERRED` — not yet, run it again unchanged — rather than a 0 a caller would read as green
 * or a 1 it would go hunting a finding for.
 *
 * @param results the per-check outcomes
 * @param planned the name of every check this lap set out to run
 * @returns the overall pass/fail + the process exit code (0 all-clear, 4 all that ran passed but a gate was
 *   withheld, 1 any failure)
 */
export function composeLint({
  results,
  planned,
}: {
  results: readonly LintCheckResult[];
  planned: readonly string[];
}): {
  readonly ok: boolean;
  readonly exit: number;
} {
  const complete =
    planned.length > 0 &&
    results.length === planned.length &&
    planned.every((name) => results.filter((r) => r.name === name).length === 1);
  const ranClean = results.every((r) => r.ok || r.withheld !== undefined);
  const withheld = results.some((r) => r.withheld !== undefined);
  if (complete && ranClean && !withheld) {
    return { exit: EXIT_OK, ok: true };
  }
  if (complete && ranClean) {
    return { exit: EXIT_DEFERRED, ok: false };
  }
  return { exit: EXIT_ERROR, ok: false };
}

/**
 * The line an `--only` run prints above its verdict, naming how much of the bar it actually was.
 *
 * Same reason {@link laneVerdictLine} names what a lane skipped: a bare `PASS` from a run that spawned one
 * gate out of forty reads as the whole bar, and this flag exists precisely so sessions run narrow laps. The
 * count is DERIVED from the plan rather than written here, so registering a gate updates this line by itself.
 *
 * @param ran the gates this run actually spawned, in plan order
 * @param total how many gates the whole plan holds
 * @returns the scope line, without its trailing newline
 * @internal — `runDevLint` and this module's test.
 */
export function onlyScopeLine({ ran, total }: { ran: readonly string[]; total: number }): string {
  return `dev lint: --only ran ${String(ran.length)} of ${String(total)} gates, NOT the whole bar: ${ran.join(", ")}`;
}

/**
 * The last line of a run: the verdict, and — on the `local` lane — what that verdict does NOT cover.
 *
 * A bare `PASS` from a lane that skipped a check reads as the whole bar, and the whole point of the split is
 * that a green pre-push no longer means what it used to. So the lane says so in the line a caller actually
 * looks at, rather than only in a doc.
 *
 * **A COUNT, not the names**, since the local lane is an opt-in: it excludes 62 of 67 gates,
 * and a line that listed all of them would be a paragraph printed exactly where a caller wants one sentence
 * — so the sentence that used to raise the alarm would be the one nobody reads. Both numbers are derived
 * from the plan, so registering a gate or flagging one `offRepoState` updates this by itself, and it names
 * what to do about the gap rather than only that there is one.
 *
 * **The `seat` lane NAMES what it left out**, PASS or FAIL: its gap is a handful of whole-project gates, each
 * one a thing a seat might wrongly assume it just checked, so the names are the sentence.
 *
 * **A withheld gate turns a PASS into `INCOMPLETE`** and is named in the same line: every gate that ran passed,
 * and that is all the line may claim.
 *
 * @param ok whether every check in the lane that ran passed
 * @param laneScope how much of the whole plan this lane runs
 * @param lane which lane ran, deciding whether its gap is counted or named
 * @param uncovered what a `seat` run did not cover, by name
 * @param withheld the gates this run planned and then refused to spawn, by name
 * @returns the verdict line, without its trailing newline
 */
export function laneVerdictLine({
  ok,
  laneScope,
  lane,
  uncovered,
  withheld,
}: {
  ok: boolean;
  laneScope: { readonly ran: number; readonly total: number };
  lane: LintLane;
  uncovered: readonly string[];
  withheld: readonly string[];
}): string {
  let verdict = ok ? "PASS" : "FAIL";
  if (ok && withheld.length > 0) {
    verdict = `INCOMPLETE (${withheld.join(", ")} NOT run: withheld, the reason is above)`;
  }
  const { ran, total } = laneScope;
  if (lane === "seat") {
    return (
      `dev lint: ${verdict} — the seat lane ran ${String(ran)} of ${String(total)} gates and did NOT cover: ` +
      `${uncovered.join(", ")}. CI, or \`slopweaver github lap\` where hosted Actions are off, runs them.`
    );
  }
  if (ran === total) {
    return `dev lint: ${verdict}`;
  }
  return (
    `dev lint: ${verdict} — this lane ran ${String(ran)} of ${String(total)} gates. ` +
    `The other ${String(total - ran)} are CI's: watch \`build\` with \`slopweaver github checks --wait\`, ` +
    `and read a red leg with \`--log\`.`
  );
}
