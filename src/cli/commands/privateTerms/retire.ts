/**
 * `slopweaver private-terms retire <proposal-id>` — remove one waiting proposal WITHOUT applying it: one the owner did
 * not take, or one a later edit left stale so `confirm` refuses it. The private terms file is never written. It takes
 * the same lock `confirm` takes (`../../../hygiene/privateTermsStore.ts`), so the two cannot both succeed on one
 * proposal. `remove` is a different verb: it PROPOSES taking a term row out.
 */
import { processPidAlive } from "../../../hygiene/privateTermsLock.js";
import { retirePrivateTermsProposal } from "../../../hygiene/privateTermsStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parsePrivateTermsTargetArgs, privateTermsUsage, VERB_ARG_OFFSET } from "./core.js";
import { printEdgesUnderArgvHomes } from "./printGuard.js";
import { asksHelp, failUsage, type PrivateTermsCommandDeps, productionPrivateTermsCommandDeps } from "./runSupport.js";

/**
 * Run `private-terms retire <proposal-id>`: remove one waiting proposal without applying it, saying whether it was
 * stale against the file read under the lock. Never a pattern, a meaning, a source or the proposal's text.
 *
 * @param argv the full process argv
 * @param deps the injected print edges
 * @returns the exit code
 */
export function runPrivateTermsRetire({
  argv,
  deps: given,
}: {
  argv: readonly string[];
  deps: PrivateTermsCommandDeps;
}): number {
  const deps = printEdgesUnderArgvHomes({ argv, deps: given });
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (asksHelp({ rest })) {
    deps.out({ line: privateTermsUsage({ verb: "retire" }) });
    return EXIT_OK;
  }
  const parsed = parsePrivateTermsTargetArgs({ rest, verb: "retire" });
  if (parsed.isErr()) {
    return failUsage({ deps, problems: parsed.error, verb: "retire" });
  }
  const { home: named, json, target } = parsed.value;
  const retired = retirePrivateTermsProposal({
    home: resolveHome({ named }),
    pidAlive: processPidAlive,
    proposalId: target,
  });
  if (retired.isErr()) {
    deps.writeDiagnostic({ line: retired.error.message });
    return retired.error.code === "PROPOSAL_UNUSABLE" ? EXIT_USAGE : EXIT_ERROR;
  }
  const { action, proposalId, stale, termId } = retired.value;
  if (json) {
    deps.out({ line: JSON.stringify({ action, proposalId, stale, termId }) });
    return EXIT_OK;
  }
  const state = stale ? "stale" : "still current";
  deps.out({ line: `retired: proposal ${proposalId} to ${action} ${termId} (${state}); the terms file is unchanged` });
  return EXIT_OK;
}

export const privateTermsRetireCommand = defineCommand({
  run: (argv) => runPrivateTermsRetire({ argv, deps: productionPrivateTermsCommandDeps() }),
});
