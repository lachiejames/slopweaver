/**
 * The `handover settle` verb as the CLI dispatches it: the settle (`./settleRowRun.ts`), then every relay whose words
 * landed on the row just settled, filed into it (`./relaySettleForWork.ts`).
 *
 * A wrapper rather than a step inside the settle, for two reasons. Settling a relay runs that same settle in process
 * (`./relaySettleAtAct.ts`), so a hook inside it would form an import cycle and recurse on every relay. And a caller
 * running the settle in process with its own `out` (`github landing --register --json`) has no relay half at all: it
 * leaves an answer relay for `handover prune --verdicts` to report. The relay receipts go to stderr, so this verb's
 * stdout is the settle's own.
 *
 * The relays are checked whatever the settle returned, once its argv parses: a settle that wrote the row and then
 * failed its mirror still left the settlement the reader consumes, and one that refused left none, so only a run event
 * already on the ask's journal can file a relay — exactly what `handover prune` would derive.
 */
import { slopweaverHome } from "../../../config.js";
import { defineCommand } from "../../defineCommand.js";
import { parseHandoverSettleArgs } from "./askRowArgs.js";
import { RELAY_RECEIPT_TO_STDERR, settleRelaysForWork } from "./relaySettleForWork.js";
import { settlePlan } from "./settleRowPlan.js";
import { runHandoverSettle } from "./settleRowRun.js";

/** How many argv entries precede the verb's own arguments: `[node, cli, "handover", "settle", …]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Settle a row, then file the relays it answers.
 *
 * @param argv the full process argv
 * @returns the settle's own exit code — the relay half never changes it
 */
export async function runHandoverSettleVerb(argv: readonly string[]): Promise<number> {
  const code = await runHandoverSettle(argv);
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    return code;
  }
  const parsed = parseHandoverSettleArgs({ rest });
  if (parsed.isErr()) {
    return code;
  }
  const { positionals, values } = parsed.value;
  const plan = settlePlan({ positionals, values });
  if ("refusal" in plan) {
    return code;
  }
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const dir = typeof values["dir"] === "string" ? values["dir"] : undefined;
  await settleRelaysForWork({ dir, home, out: RELAY_RECEIPT_TO_STDERR, verb: "handover settle", workSlug: plan.slug });
  return code;
}

export const handoverSettleCommand = defineCommand({ run: runHandoverSettleVerb });
