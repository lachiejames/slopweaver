/**
 * `slopweaver turn dispatch` — execute the tier a composed {@link RoutingDecision} named.
 *
 * Four shapes, one verb, because they share the same brief/decision/lease machinery. This file is the shell
 * that routes argv to one of them; each shape is implemented in the layer named beside it.
 *
 * - **Initial** (`--brief --decision`): validates the decision against the brief's own routing input,
 *   records it, and either prints what THIS session must do next (`inline`/`read-only-subagent`) or opens a
 *   real, watched cmux workspace (`fresh-visible-session`) and returns immediately — it never blocks the
 *   caller on that workspace's work finishing. Lives in `dispatchInitial.ts`.
 * - **Subagent report** (`--brief --decision --subagent-report`): the second call for a
 *   `read-only-subagent` tier, after this session ran its own native subagent and captured its evidence.
 *   Lives in `dispatchInitial.ts`, beside the call it answers.
 * - **Poll** (`--poll <id>`): re-reads a `fresh-visible-session` dispatch's LIVE workspace screen and
 *   reports its current truth. Never posts, never mutates anything. Lives in `dispatchRead.ts`.
 * - **Sweep** (`--sweep`): reports every currently-`dispatched` ask's state — ready, still working, or past
 *   its lease — never relaunching anything. The visible host decides what happens next. Lives in
 *   `dispatchRead.ts`.
 *
 * `dispatchRead.ts` imports neither the entrance gates nor the acting modes, so the two reporting shapes
 * have no edge to anything that admits a responder, records a decision or opens a workspace.
 */
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuse, str } from "./core.js";
import { parseTurnDispatchArgs, requiredBriefAndDecisionPaths, resolvedHome } from "./dispatchArgs.js";
import { recordDispatchNeverLanded } from "./dispatchFreshRecords.js";
import { runInitial, runSubagentReportMode } from "./dispatchInitial.js";
import { runPoll, runSweepMode } from "./dispatchRead.js";
import { TURN_DISPATCH_USAGE } from "./usage.js";

export { recordDispatchNeverLanded };

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, dispatch, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the dispatch verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnDispatch(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_DISPATCH_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnDispatchArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, errors: [...parsed.error, TURN_DISPATCH_USAGE] });
  }
  const values = parsed.value.values;
  const home = resolvedHome({ values });
  if (values["sweep"] === true) {
    return runSweepMode({ home, values });
  }
  if (values["warn"] !== undefined || values["warn-dispatched"] !== undefined) {
    return refuse({
      code: EXIT_USAGE,
      errors: ["--warn is a form of --sweep, and only of --sweep", TURN_DISPATCH_USAGE],
    });
  }
  const pollId = str({ key: "poll", values });
  if (pollId !== undefined) {
    return runPoll({ dispatchId: pollId, home });
  }
  const paths = requiredBriefAndDecisionPaths({ values });
  if ("errors" in paths) {
    return refuse({ code: EXIT_USAGE, errors: paths.errors });
  }
  const reportPath = str({ key: "subagent-report", values });
  if (reportPath !== undefined) {
    return runSubagentReportMode({ ...paths, home, reportPath });
  }
  return runInitial({ ...paths, home });
}

export const turnDispatchCommand = defineCommand({ run: runTurnDispatch });
