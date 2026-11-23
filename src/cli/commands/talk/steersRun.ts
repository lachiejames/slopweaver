/**
 * `slopweaver talk steers` — what became of each steer they spoke over a Queue card in the last week: still waiting
 * on the chair, settled by its action, or back on their Queue and why (`src/talk/steeredCards.ts`).
 *
 * The console reads `--json` every 20 seconds to confirm, settle or revert the card it collapsed the moment they
 * steered it (`site/components/console/steered.tsx`), so the argv takes no input and the read is bounded: one
 * exact-slug doc and one journal per relay, and the tick ledger's tail only when a verdict turns on it.
 */
import { autonomyLedgerPort } from "../../../autonomy/port.js";
import { logger } from "../../../lib/logger.js";
import { readSteeredCards } from "../../../talk/steeredCardsRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { talkHomeOf } from "./args.js";
import { parseCardsArgs } from "./cardArgs.js";
import { TALK_STEERS_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "steers", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk steers` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkSteers(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_STEERS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCardsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_STEERS_USAGE });
    return EXIT_USAGE;
  }
  const home = talkHomeOf({ home: parsed.value.home });
  const read = await readSteeredCards({
    handoverDir: resolveHandoverDir({ dir: undefined, home }),
    home,
    ledger: autonomyLedgerPort(),
    nowIso: new Date().toISOString(),
  });
  if (read.isErr()) {
    logger.error({ msg: `talk steers: ${read.error.message}` });
    if (parsed.value.json) {
      logger.out({ line: JSON.stringify({ code: read.error.code, ok: false, why: read.error.message }) });
    }
    return EXIT_ERROR;
  }
  const { observedAtIso, sinceIso, steers, undecodedRelays } = read.value;
  if (parsed.value.json) {
    logger.out({ line: JSON.stringify({ observedAtIso, ok: true, sinceIso, steers, undecodedRelays }) });
    return EXIT_OK;
  }
  if (steers.length === 0) {
    logger.out({ line: "talk steers: no relay named a card in the last week" });
    return EXIT_OK;
  }
  steers.forEach((steer) => {
    const { verdict } = steer;
    let state: string = verdict.kind;
    if (verdict.kind === "reverted") {
      state = `back on the Queue: ${verdict.reason}`;
    } else if (verdict.kind === "settled") {
      state = `settled by ${verdict.action.kind}`;
    } else if (verdict.kind === "unread") {
      state = `unread: ${verdict.why}`;
    }
    logger.out({ line: `${steer.registeredAtIso}  ${steer.cardKey} → ${steer.relaySlug}  ${state}` });
  });
  return EXIT_OK;
}

export const talkSteersCommand = defineCommand({ run: runTalkSteers });
