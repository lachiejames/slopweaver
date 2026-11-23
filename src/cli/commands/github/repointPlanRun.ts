/**
 * `slopweaver github repoint-plan` — the dry-run inventory a repository re-cut needs before its switch: every local
 * place that names the repository and what the switch changes it to. It writes NOTHING; the apply half belongs to
 * the switch, run on the owner's yes, and refuses a plan whose `complete` is false.
 *
 * Exit codes: `0` for a complete plan, `3` (`EXIT_EXPECTED_EMPTY`) for an incomplete one — a legitimate status, the
 * signal that something is still unresolved — and `1` when the push-root register cannot be trusted at all.
 */
import { planRepositoryRepoint } from "../../../checkouts/repointPlan.js";
import {
  productionRepointReadDeps,
  type RepointReadDeps,
  readRepositoryRepointFacts,
} from "../../../checkouts/repointReaders.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseRepointPlanArgs, repointPlanLines } from "./repointPlanCore.js";

const VERB_ARG_OFFSET = 4;

/**
 * Run one `github repoint-plan` invocation.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, noun and verb
 * @param deps the read edges and the output sink
 * @returns the process exit code
 */
export function runGithubRepointPlan({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: { readonly read: RepointReadDeps; readonly out: (input: { line: string }) => void };
}): number {
  const parsed = parseRepointPlanArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of parsed.error.lines) deps.out({ line });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const request = { archiveName: args.archiveName, newCheckout: args.newCheckout, repository: args.repository };
  const facts = readRepositoryRepointFacts({ deps: deps.read, home: resolveHome({ named: args.home }), request });
  if (facts.isErr()) {
    deps.out({ line: `refused: ${facts.error}` });
    return EXIT_ERROR;
  }
  const plan = planRepositoryRepoint({ facts: facts.value, request });
  if (plan.isErr()) {
    deps.out({ line: `refused: ${plan.error.message}` });
    return EXIT_USAGE;
  }
  if (args.json) {
    deps.out({ line: JSON.stringify(plan.value, null, 2) });
  } else {
    for (const line of repointPlanLines({ plan: plan.value })) deps.out({ line });
  }
  return plan.value.complete ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

export const githubRepointPlanCommand = defineCommand({
  run: (argv: readonly string[]) =>
    runGithubRepointPlan({ argv, deps: { out: logger.out, read: productionRepointReadDeps() } }),
});
