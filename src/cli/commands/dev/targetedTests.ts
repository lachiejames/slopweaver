/**
 * `slopweaver dev targeted-tests` — run, once and before a local lap, the unit tests a branch's own diff reaches
 * and each touched nested project's `tsc --noEmit`, so a red a sub-minute run catches is not found twelve minutes
 * into a lap.
 *
 * Effectful shell only: it resolves the seat's base exactly as `dev lint --lane seat` does (its fifteen-minute
 * fetch bound included), reads the test inventory, and spawns each planned step from the repository root. Every
 * selection rule is `src/testLanes/targetedTests.ts`; every printed line is `./targetedTestsCore.ts`. The flow
 * over those effects is {@link runTargetedTestsWith}, which takes each effect as a plain function.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { gitLines } from "../../../devLint/gitAtCommit.js";
import { changedPathsOf, prepareSeatChanges } from "../../../devLint/seatLint.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { readTargetedTestInventory } from "../../../testLanes/targetedTestImports.js";
import {
  deriveTargetedTests,
  type TargetedTestSelection,
  type TargetedTestStep,
  targetedTestSteps,
} from "../../../testLanes/targetedTests.js";
import { spawnInherited } from "../../../testLanes/unitSequence.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseDevTargetedTestsArgs, targetedTestsPlanLines, targetedTestsVerdictLine } from "./targetedTestsCore.js";
import { DEV_TARGETED_TESTS_USAGE } from "./targetedTestsUsage.js";

/** What the verb planned: the base it read, how many paths changed, what they selected and the steps that run it. */
export interface TargetedTestsPlan {
  readonly baseSha: string;
  readonly changedCount: number;
  readonly selection: TargetedTestSelection;
  readonly steps: readonly TargetedTestStep[];
}

/** Why no plan could be made — each a state of the checkout, never a verdict on the code under test. */
export type TargetedTestsPlanError =
  | { readonly code: "NOT_A_CHECKOUT"; readonly message: string }
  | { readonly code: "SEAT_BASE_REFUSED"; readonly message: string }
  | { readonly code: "SELECTION_UNREADABLE"; readonly message: string };

/** The {@link TargetedTestsPlanError} factories. */
export const TargetedTestsPlanErrors = {
  notACheckout: (): TargetedTestsPlanError => ({
    code: "NOT_A_CHECKOUT",
    message: "dev targeted-tests: not inside a git checkout, so there is no diff to target",
  }),
  seatBaseRefused: ({ detail }: { detail: string }): TargetedTestsPlanError => ({
    code: "SEAT_BASE_REFUSED",
    message: `dev targeted-tests: the seat lane's base read refused — ${detail}`,
  }),
  selectionUnreadable: ({ message }: { message: string }): TargetedTestsPlanError => ({
    code: "SELECTION_UNREADABLE",
    message,
  }),
} as const;

/** Every effect the verb's flow performs, each a plain function a test can pass in. */
export interface TargetedTestsDeps {
  /** Read the diff and plan its steps, or say why the state could not be read. */
  readonly plan: () => Result<TargetedTestsPlan, TargetedTestsPlanError>;
  /** Whether a step's program, repo-relative, is installed. */
  readonly programPresent: (program: string) => boolean;
  /** Run one step, its output streamed, and answer its exit status. */
  readonly runStep: (step: TargetedTestStep) => number;
  readonly out: (line: string) => void;
  readonly error: (line: string) => void;
}

/**
 * The verb's flow over its effects: help, the flags, the plan and its printout, the installed-program check, then
 * each step in order, stopping at the first red.
 *
 * @param rest the verb's own arguments, after `dev targeted-tests`
 * @param deps every effect the flow performs
 * @returns 0 when every step passed (or a dry run planned them), 1 on a red step or an unreadable state, 2 on bad flags
 */
export function runTargetedTestsWith({ rest, deps }: { rest: readonly string[]; deps: TargetedTestsDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out(DEV_TARGETED_TESTS_USAGE);
    return EXIT_OK;
  }
  const parsed = parseDevTargetedTestsArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...parsed.error, DEV_TARGETED_TESTS_USAGE]) {
      deps.error(line);
    }
    return EXIT_USAGE;
  }
  const plan = deps.plan();
  if (plan.isErr()) {
    deps.error(plan.error.message);
    return EXIT_ERROR;
  }
  const { steps } = plan.value;
  for (const line of targetedTestsPlanLines(plan.value)) {
    deps.out(line);
  }
  const missing = steps.map(({ argv }) => argv[0]!).filter((program) => !deps.programPresent(program));
  if (missing.length > 0) {
    deps.error(
      `dev targeted-tests: ${missing.join(", ")} not installed — run \`yarn install\` in that project, then re-run`,
    );
    return EXIT_ERROR;
  }
  if (parsed.value.values["dry-run"] === true) {
    deps.out("dev targeted-tests: --dry-run, so nothing ran");
    return EXIT_OK;
  }
  for (const [index, step] of steps.entries()) {
    const status = deps.runStep(step);
    if (status !== 0) {
      deps.out(targetedTestsVerdictLine({ failed: step, ran: index + 1, status, total: steps.length }));
      return EXIT_ERROR;
    }
  }
  deps.out(targetedTestsVerdictLine({ failed: undefined, ran: steps.length, status: 0, total: steps.length }));
  return EXIT_OK;
}

/**
 * Read the checkout's diff against the seat lane's base and plan its steps.
 *
 * @param root the repository root
 * @returns the plan, or the state that could not be read
 */
function readTargetedTestsPlan({ root }: { root: string }): Result<TargetedTestsPlan, TargetedTestsPlanError> {
  const changes = prepareSeatChanges({ cwd: root, nowMs: Date.now() });
  if (changes.isErr()) {
    return err(TargetedTestsPlanErrors.seatBaseRefused({ detail: changes.error.message }));
  }
  const changedPaths = changedPathsOf({ changes: changes.value });
  const inventory = readTargetedTestInventory({ changedPaths, root });
  if (inventory.isErr()) {
    return err(TargetedTestsPlanErrors.selectionUnreadable({ message: inventory.error.message }));
  }
  const selection = deriveTargetedTests({ changedPaths, ...inventory.value });
  if (selection.isErr()) {
    return err(TargetedTestsPlanErrors.selectionUnreadable({ message: selection.error.message }));
  }
  return ok({
    baseSha: changes.value.baseSha,
    changedCount: changedPaths.length,
    selection: selection.value,
    steps: targetedTestSteps({ selection: selection.value }),
  });
}

/**
 * Run the `dev targeted-tests` verb.
 *
 * @param argv the full process argv
 * @returns what {@link runTargetedTestsWith} returns, over the real checkout
 */
export function runDevTargetedTests(argv: readonly string[]): number {
  // Read only once the flags parse, so a usage refusal stays free of I/O as the manifest declares.
  let root = "";
  return runTargetedTestsWith({
    deps: {
      error: (msg) => {
        logger.error({ msg });
      },
      out: (line) => {
        logger.out({ line });
      },
      plan: () => {
        const top = gitLines({ args: ["rev-parse", "--show-toplevel"], root: process.cwd() });
        if (top?.length !== 1) {
          return err(TargetedTestsPlanErrors.notACheckout());
        }
        root = top[0]!;
        return readTargetedTestsPlan({ root });
      },
      programPresent: (program) => existsSync(join(root, program)),
      runStep: (step) =>
        spawnInherited({
          argv: step.argv,
          cwd: root,
          write: (msg) => {
            logger.error({ msg });
          },
        }),
    },
    rest: argv.slice(4),
  });
}

export const devTargetedTestsCommand = defineCommand({ run: runDevTargetedTests });
