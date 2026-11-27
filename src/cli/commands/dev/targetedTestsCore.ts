/**
 * The pure half of `slopweaver dev targeted-tests`: its flags, and the lines it prints before and after it runs.
 * The selection itself is `src/testLanes/targetedTests.ts`; the shell is `./targetedTests.ts`.
 */
import { type Result } from "../../../lib/result.js";
import {
  TARGETED_TESTS_NOT_COVERED,
  type TargetedTestSelection,
  type TargetedTestStep,
} from "../../../testLanes/targetedTests.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";

const FLAGS: FlagSpec = { boolean: ["dry-run"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const DEV_TARGETED_TESTS_FLAG_NAMES: readonly string[] = booleanFlagsOf({ spec: FLAGS })
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `dev targeted-tests` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors (a positional or an unknown flag among them)
 */
export function parseDevTargetedTestsArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/**
 * The plan, printed before anything runs: the base, every selected test with why, each step, and what the run
 * does not cover — on every run, so a green here is never read as the lap's.
 *
 * @param baseSha the merge-base the diff was read against
 * @param changedCount how many paths the diff changed
 * @param selection what was selected
 * @param steps the commands that will run
 * @returns the lines, in print order
 */
export function targetedTestsPlanLines({
  baseSha,
  changedCount,
  selection,
  steps,
}: {
  baseSha: string;
  changedCount: number;
  selection: TargetedTestSelection;
  steps: readonly TargetedTestStep[];
}): readonly string[] {
  const diffReached = selection.tests.filter(({ reasons }) => reasons.some((reason) => reason !== "registry-sweep"));
  const sweepOnly = selection.tests.length - diffReached.length;
  return [
    `dev targeted-tests: base ${baseSha} (merge-base of HEAD and origin/main), ${String(changedCount)} changed path(s)`,
    `selected ${String(selection.tests.length)} unit test file(s): ${String(diffReached.length)} the diff reached, ` +
      `${String(sweepOnly)} more by the fixed registry sweep alone`,
    ...diffReached.map(({ path, reasons }) => `  ${path} — ${reasons.join(", ")}`),
    "steps, in order, each stopping the run when red:",
    ...steps.map(({ label, argv }) => `  ${label}: ${argv.slice(0, 6).join(" ")}${argv.length > 6 ? " …" : ""}`),
    ...targetedTestsNotCoveredLines(),
  ];
}

/**
 * What the verb deliberately does not cover, as printed lines.
 *
 * @returns the heading and one line per omission
 */
export function targetedTestsNotCoveredLines(): readonly string[] {
  return ["not covered here (the lap's):", ...TARGETED_TESTS_NOT_COVERED.map((line) => `  - ${line}`)];
}

/**
 * The verdict line after the steps ran.
 *
 * @param failed the step that went red, or `undefined` when every step passed
 * @param status the failed step's exit status
 * @param ran how many steps ran
 * @param total how many steps were planned
 * @returns the line
 */
export function targetedTestsVerdictLine({
  failed,
  status,
  ran,
  total,
}: {
  failed: TargetedTestStep | undefined;
  status: number;
  ran: number;
  total: number;
}): string {
  if (failed === undefined) {
    return `dev targeted-tests: PASS — ${String(total)} step(s) green; the lap still owns everything listed as not covered`;
  }
  const skipped = total - ran;
  return (
    `dev targeted-tests: FAIL — ${failed.label} exited ${String(status)}` +
    (skipped > 0 ? `; ${String(skipped)} later step(s) not run` : "")
  );
}
