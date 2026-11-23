/**
 * `slopweaver proof yarn-why` — a real, unfaked before/after `yarn why <dependency>` terminal capture for
 * a dependency-fix PR description. See `src/proof/yarnWhy/orchestrate.ts` for the actual flow; this module
 * is the CLI edge: parse, validate, report.
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";

import { slopweaverHome } from "../../../homeDir.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { buildGoldenProof } from "../../../proof/yarnWhy/orchestrate.js";
import { refuseProofOutputInTree } from "../../../proofPath/outputGuardEffects.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { PROOF_YARN_WHY_USAGE, parseProofYarnWhyArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";

/** This verb's four required string flags, once every one of them is confirmed present. */
interface RequiredProofFlags {
  readonly dep: string;
  readonly before: string;
  readonly after: string;
  readonly out: string;
}

/** Read `--dep`/`--before`/`--after`/`--out`, returning either all four values or every missing-flag error. */
function requiredFlags({
  parsed,
}: {
  parsed: ParsedFlags;
}): { values: RequiredProofFlags } | { errors: readonly string[] } {
  const dep = stringFlag({ name: "dep", parsed });
  const before = stringFlag({ name: "before", parsed });
  const after = stringFlag({ name: "after", parsed });
  const out = stringFlag({ name: "out", parsed });

  const errors = [
    ...(dep === undefined ? ["--dep is required"] : []),
    ...(before === undefined ? ["--before is required"] : []),
    ...(after === undefined ? ["--after is required"] : []),
    ...(out === undefined ? ["--out is required"] : []),
  ];
  if (errors.length > 0 || dep === undefined || before === undefined || after === undefined || out === undefined) {
    return { errors };
  }
  return { values: { after, before, dep, out } };
}

/** What `proof yarn-why` reaches outside itself, injected so a refusal is provable without a real capture. */
export interface ProofYarnWhyDeps {
  readonly build: typeof buildGoldenProof;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly log: Pick<Logger, "error" | "out">;
}

/** Why the capture may not start: an output a checkout could carry, or a worktree that is not there. */
function preflightProblems({
  required,
  deps,
}: {
  required: RequiredProofFlags;
  deps: ProofYarnWhyDeps;
}): readonly string[] {
  const { cwd, env, home } = deps;
  const placement = refuseProofOutputInTree({ cwd, env, home, output: required.out });
  if (placement.isErr()) {
    return placement.error;
  }
  for (const [flag, path] of [
    ["--before", required.before],
    ["--after", required.after],
  ] as const) {
    if (!existsSync(path)) {
      return [`${flag} path does not exist: ${path}`];
    }
  }
  return [];
}

/** The caption one side of the capture carries: its `--*-label` flag, else the worktree directory's own name. */
function worktreeLabel({
  parsed,
  flag,
  worktree,
}: {
  parsed: ParsedFlags;
  flag: "before-label" | "after-label";
  worktree: string;
}): string {
  const named = stringFlag({ name: flag, parsed });
  if (named === undefined) {
    return basename(worktree);
  }
  return named;
}

/** Print each failure under the verb's name and return the failing exit code. */
function failed({ log, messages }: { log: ProofYarnWhyDeps["log"]; messages: readonly string[] }): number {
  messages.forEach((message) => {
    log.error({ msg: `proof yarn-why: ${message}` });
  });
  return EXIT_ERROR;
}

/**
 * Run `proof yarn-why` over its flags: parse, refuse an output a checkout could carry, then capture.
 *
 * @param rest the arguments after the verb
 * @param deps the capture, the invocation's place and the output channels
 * @returns the exit code
 */
export async function runProofYarnWhy({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ProofYarnWhyDeps;
}): Promise<number> {
  const { log } = deps;
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: PROOF_YARN_WHY_USAGE });
    return EXIT_OK;
  }

  const parsed = parseProofYarnWhyArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      log.error({ msg: message });
    });
    log.error({ msg: PROOF_YARN_WHY_USAGE });
    return EXIT_USAGE;
  }

  const required = requiredFlags({ parsed: parsed.value });
  if ("errors" in required) {
    required.errors.forEach((message) => {
      log.error({ msg: message });
    });
    log.error({ msg: PROOF_YARN_WHY_USAGE });
    return EXIT_USAGE;
  }
  const { dep, before, after, out } = required.values;

  const problems = preflightProblems({ deps, required: required.values });
  if (problems.length > 0) {
    return failed({ log, messages: problems });
  }

  const result = await deps.build({
    after: { label: worktreeLabel({ flag: "after-label", parsed: parsed.value, worktree: after }), worktree: after },
    before: {
      label: worktreeLabel({ flag: "before-label", parsed: parsed.value, worktree: before }),
      worktree: before,
    },
    dependency: dep,
    outPath: out,
  });

  if (result.isErr()) {
    return failed({ log, messages: result.error });
  }

  log.out({ line: out });
  return EXIT_OK;
}

export const proofYarnWhyCommand = defineCommand({
  run: (argv) =>
    runProofYarnWhy({
      deps: { build: buildGoldenProof, cwd: process.cwd(), env: process.env, home: slopweaverHome(), log: logger },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
