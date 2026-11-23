/**
 * `slopweaver proposal destination set|show` — the effectful shell around an install's proposal destination.
 *
 * `set` writes ONE file under the state home and nothing else; `show` reads it. Neither touches a provider:
 * the destination is checked by `proposal publish` when it actually publishes, through that provider's own
 * door, which is the one place a wrong parent can be told from a right one.
 */
import { describeProposalDestination } from "../../../outbound/proposal/destination.js";
import { readProposalDestination, writeProposalDestination } from "../../../outbound/proposal/destinationStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseProposalDestinationArgs } from "./destinationCore.js";
import { proposalErrorLines } from "./errors.js";
import {
  type ProposalPublishDeps,
  productionProposalPublishDeps,
  refuse,
  VERB_ARG_OFFSET,
} from "./publishRunShared.js";

/**
 * Run `proposal destination`.
 *
 * `show` with nothing set exits `EXIT_EXPECTED_EMPTY` — a status, naming the command that sets one. A file
 * that is there but unreadable or invalid exits `EXIT_ERROR`, and is never reported as unset.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export function runProposalDestination({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: Pick<ProposalPublishDeps, "out" | "err">;
}): number {
  const parsed = parseProposalDestinationArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (args.action === "set") {
    const written = writeProposalDestination({ destination: args.destination, home });
    if (written.isErr()) {
      return refuse({ code: EXIT_ERROR, deps, lines: [written.error.message] });
    }
    if (args.json) {
      deps.out(JSON.stringify({ destination: args.destination, path: written.value }, null, 2));
    } else {
      deps.out(`proposals now publish to ${describeProposalDestination({ destination: args.destination })}`);
    }
    deps.err(`wrote ${written.value}`);
    return EXIT_OK;
  }
  const read = readProposalDestination({ home });
  if (read.isErr()) {
    return refuse({
      code: read.error.code === "DESTINATION_UNSET" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR,
      deps,
      lines: [read.error.message],
    });
  }
  if (args.json) {
    deps.out(JSON.stringify({ destination: read.value }, null, 2));
  } else {
    deps.out(describeProposalDestination({ destination: read.value }));
  }
  return EXIT_OK;
}

/** `slopweaver proposal destination` — set or show where this install publishes a proposal. */
export const proposalDestinationCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalDestination({ argv, deps: productionProposalPublishDeps() }),
});
