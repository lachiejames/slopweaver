/**
 * `slopweaver private-terms answer <proposal-id> --as yes|no --via console|word --by-session <who>` — record the owner's
 * yes or no to ONE waiting proposal, the press on the Queue card that showed the word
 * (`site/lib/actVerbsPrivateTerms.ts`). It writes the answer beside the proposal and nothing else: the terms file
 * changes only on `confirm`, which the fleet runs on a yes and which refuses a proposal answered no
 * (`../../../hygiene/privateTermAnswers.ts`). It prints the proposal id and the answer, never a word.
 */
import { processPidAlive } from "../../../hygiene/privateTermsLock.js";
import { answerPrivateTermsProposal } from "../../../hygiene/privateTermsStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parsePrivateTermsAnswerArgs } from "./answerArgs.js";
import { privateTermsUsage, VERB_ARG_OFFSET } from "./core.js";
import { type PrivateTermsEditDeps, productionPrivateTermsEditDeps } from "./edit.js";
import { printEdgesUnderArgvHomes } from "./printGuard.js";
import { asksHelp, failUsage } from "./runSupport.js";

/**
 * Run `private-terms answer`: keep the owner's answer to one proposal that is still waiting.
 *
 * @param argv the full process argv
 * @param deps the injected edges; `nowIso` stamps the answer
 * @returns the exit code
 */
export function runPrivateTermsAnswer({
  argv,
  deps: given,
}: {
  argv: readonly string[];
  deps: PrivateTermsEditDeps;
}): number {
  const deps = printEdgesUnderArgvHomes({ argv, deps: given });
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (asksHelp({ rest })) {
    deps.out({ line: privateTermsUsage({ verb: "answer" }) });
    return EXIT_OK;
  }
  const parsed = parsePrivateTermsAnswerArgs({ rest });
  if (parsed.isErr()) {
    return failUsage({ deps, problems: parsed.error, verb: "answer" });
  }
  const { answer, bySession, home: named, json, proposalId, via } = parsed.value;
  const home = resolveHome({ named });
  // Only a proposal still waiting can be answered, checked under the lock a confirm takes: one already confirmed,
  // or never made here, is refused before anything is written, so an answer never sits beside nothing.
  const kept = answerPrivateTermsProposal({
    answer: { answer, answeredAtIso: deps.nowIso(), bySession, proposalId, schemaVersion: 1, via },
    home,
    pidAlive: processPidAlive,
  });
  if (kept.isErr()) {
    deps.writeDiagnostic({ line: kept.error.message });
    return kept.error.code === "PROPOSAL_UNUSABLE" ? EXIT_USAGE : EXIT_ERROR;
  }
  if (json) {
    deps.out({ line: JSON.stringify({ answer, proposalId, recorded: true }) });
    return EXIT_OK;
  }
  const next =
    answer === "yes"
      ? `land it with: slopweaver private-terms confirm ${proposalId}`
      : "confirm now refuses it; nothing changes in the terms file";
  deps.out({ line: `recorded: the owner answered ${answer} to ${proposalId} on ${via}; ${next}` });
  return EXIT_OK;
}

export const privateTermsAnswerCommand = defineCommand({
  run: (argv) => runPrivateTermsAnswer({ argv, deps: productionPrivateTermsEditDeps() }),
});
