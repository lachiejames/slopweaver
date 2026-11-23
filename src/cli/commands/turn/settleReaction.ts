/**
 * `slopweaver turn settle-reaction` — converge one ask's tagged message to exactly one lifecycle reaction.
 *
 * The BY-HAND correction path, and the reason it has to exist at all: the code path retires the whole lifecycle
 * set on every transition, but that path is only reachable from a turn's own terminal,
 * the sweep's `./abandoned.ts` and `./ignoreIndicators.ts`. An ask that is ALREADY terminal will never run
 * over any of them again, so a message an earlier turn left wearing a contradictory pair — measured,
 * three of them in one thread — could not be corrected through any door at all.
 *
 * It converges through {@link settleLifecycleReaction}, the same seam both live callers use, rather than
 * reaching for `reactions.remove` itself. A second implementation of the convergence is precisely the
 * per-call-site divergence `../../../live/turn/lifecycleReactions.ts` records as the original defect.
 *
 * Scoped to the REACTION and named for it. Settling a working card needs the turn's steps, chrome and
 * turnId, which an operator typing this by hand does not have — and every card in the measured case was
 * already retracted. A verb that claimed to settle "the indicators" while only moving one of them would be
 * the same class of lie.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { throughDoor } from "../../../admit/effects.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { askLifecycleKey, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import type { AskLifecycleEvent } from "../../../live/ask/lifecycleEvents.js";
import { capturedAskFor, readAskLifecycleText } from "../../../live/ask/store.js";
import type { TerminalReaction } from "../../../live/turn/indicators.js";
import { settleLifecycleReaction, turnDoorRequest } from "../../../live/turn/poster.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { str, TURN_SETTLE_REACTION_FLAG_SPEC } from "./core.js";
import { TURN_SETTLE_REACTION_USAGE } from "./usage.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, settle-reaction, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn settle-reaction`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnSettleReactionArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: {
      boolean: [...TURN_SETTLE_REACTION_FLAG_SPEC.boolean],
      string: [...TURN_SETTLE_REACTION_FLAG_SPEC.string],
    },
  });
}

/**
 * Every ending `--to` accepts, in the order the usage line lists them. One array, so the parser and the
 * help text cannot drift apart — a `--to` value the help advertises and the parser rejects is the same
 * class of lie as an indicator that claims it settled.
 */
export const SETTLE_REACTION_ENDINGS: readonly TerminalReaction[] = [
  "completion",
  "stopped",
  "acknowledged",
  "for-a-human",
];

/**
 * Read `--to` as a terminal ending. Pure and total.
 *
 * An unrecognised value is `undefined` rather than a default, because defaulting here would settle a
 * message to an ending the caller never asked for — and the three endings mean different things to whoever
 * reads the thread.
 *
 * `acknowledged` was the third, and adding it is half of closing the gap this verb kept hitting: an
 * operator hand-settling a turn that correctly owed no reply previously had to choose between a tick that
 * overstates and a warning that reads as an error. Both were recorded being chosen under protest —
 * twice — because the vocabulary offered nothing true. `for-a-human` is the fourth, for an ask
 * the bot judged and deliberately left for a person to answer.
 *
 * @param value the raw `--to` value, or `undefined` when the flag was omitted
 * @returns the terminal ending, or `undefined` when the value names none of them
 */
export function terminalReactionFrom({ value }: { value: string | undefined }): TerminalReaction | undefined {
  return SETTLE_REACTION_ENDINGS.find((ending) => ending === value);
}

/** The two endings that each record a JUDGEMENT about whether the asker is owed a reply, and disagree about it. */
const JUDGED_ENDINGS: ReadonlySet<TerminalReaction> = new Set<TerminalReaction>(["acknowledged", "for-a-human"]);

/** Every lifecycle kind that records one of those judgements, intent or terminal, and the ending it settles to. */
const JUDGED_KIND_ENDINGS: ReadonlyMap<AskLifecycleEvent["kind"], TerminalReaction> = new Map<
  AskLifecycleEvent["kind"],
  TerminalReaction
>([
  ["triage-cleanup-intended", "acknowledged"],
  ["triaged-no-response", "acknowledged"],
  ["handover-cleanup-intended", "for-a-human"],
  ["left-for-a-human", "for-a-human"],
]);

/**
 * The variable letting a hand settle swap one judged ending for the other. A LITERAL, so `escape-hatch` in
 * `yarn lint` sees this module name its own key.
 */
const JUDGED_ENDING_SWAP_HATCH = "SLOPWEAVER_ALLOW_JUDGED_ENDING_SWAP";

/**
 * The judged ending a hand settle would contradict, or `undefined` when it contradicts none. Pure and total.
 *
 * `acknowledged` says nothing is owed and `for-a-human` says a person owes the answer, so settling an ask
 * judged one way to the other ending tells the asker the opposite of what was decided. Every other move —
 * re-asserting the judged ending, or any `completion`/`stopped` correction — is the by-hand repair this verb
 * exists for, and passes.
 *
 * The judgement is read off the ask's whole HISTORY, its latest judged event, never off the current fold: a
 * later re-capture reopens the fold to `captured` while the judgement still stands, and reading the fold
 * there would let the swap through unrefused.
 *
 * @param events every lifecycle event in the log
 * @param askIdentity the ask being settled
 * @param reaction the ending the caller asked for
 * @returns the ending the ask was judged to, when the request swaps it for the other judged ending
 */
export function judgedEndingContradicted({
  events,
  askIdentity,
  reaction,
}: {
  events: readonly AskLifecycleEvent[];
  askIdentity: AskIdentity;
  reaction: TerminalReaction;
}): TerminalReaction | undefined {
  if (!JUDGED_ENDINGS.has(reaction)) {
    return undefined;
  }
  const key = askLifecycleKey({ askIdentity });
  const judgedEvent = events.findLast(
    (event) => JUDGED_KIND_ENDINGS.has(event.kind) && askLifecycleKey({ askIdentity: event }) === key,
  );
  if (judgedEvent === undefined) {
    return undefined;
  }
  const judged = JUDGED_KIND_ENDINGS.get(judgedEvent.kind)!;
  return judged === reaction ? undefined : judged;
}

/**
 * The three values the verb cannot run without, or the flags whose absence stopped it. Pure and total.
 *
 * Extracted so the required-flag reading is one testable decision rather than a branch pile inside the
 * runner — and so `--to` naming neither ending is refused with the same voice as an omitted flag, which is
 * what it is: an invocation that never said which ending to settle to.
 *
 * @param values the parsed flag values
 * @returns the resolved inputs, or every flag that was missing or unreadable
 */
export function settleReactionInputs({ values }: { values: Readonly<Record<string, string | boolean>> }):
  | {
      readonly kind: "ready";
      readonly channel: string;
      readonly messageTs: string;
      readonly reaction: TerminalReaction;
    }
  | { readonly kind: "missing"; readonly flags: readonly string[] } {
  const channel = str({ key: "channel", values });
  const messageTs = str({ key: "message-ts", values });
  const reaction = terminalReactionFrom({ value: str({ key: "to", values }) });
  const flags = [
    channel === undefined ? "--channel" : undefined,
    messageTs === undefined ? "--message-ts" : undefined,
    reaction === undefined ? `--to (${SETTLE_REACTION_ENDINGS.join(", ")})` : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  return channel !== undefined && messageTs !== undefined && reaction !== undefined
    ? { channel, kind: "ready", messageTs, reaction }
    : { flags, kind: "missing" };
}

/**
 * Run the settle-reaction verb.
 *
 * The effect is ROUTED THROUGH THE DOOR, unlike the same convergence called from a turn's own terminal
 * path. That is not an inconsistency: the door's default gate set is empty, so routing means RECORDED in
 * the ledger — worth paying for an operator-initiated external write that exists only to make that write,
 * and deliberately not paid on a live turn's courtesy indicator, which must survive losing it and has no
 * business blocking on a ledger append.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnSettleReaction(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_SETTLE_REACTION_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnSettleReactionArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: TURN_SETTLE_REACTION_USAGE });
    return EXIT_USAGE;
  }
  const inputs = settleReactionInputs({ values: parsed.value.values });
  if (inputs.kind === "missing") {
    for (const flag of inputs.flags) {
      logger.error({ msg: `${flag} is required` });
    }
    logger.error({ msg: TURN_SETTLE_REACTION_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: str({ key: "home", values: parsed.value.values }) });
  return settle({ home, inputs });
}

/**
 * Whether the log's judged ending forbids this settle: it refuses (and says so) unless the swap hatch is open,
 * and an admitted swap is logged as such.
 */
function refusesJudgedEndingSwap({
  askIdentity,
  home,
  reaction,
  subject,
}: {
  askIdentity: AskIdentity;
  home: string;
  reaction: TerminalReaction;
  /** The `channel/ts` the refusal names. */
  subject: string;
}): boolean {
  const { events } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  const judged = judgedEndingContradicted({ askIdentity, events, reaction });
  if (judged === undefined) {
    return false;
  }
  const detail = `${subject} was judged to settle to ${judged}, not ${reaction}`;
  if (process.env[JUDGED_ENDING_SWAP_HATCH] !== "1") {
    logger.error({ msg: hatchRefusal({ detail, hatch: hatchFor({ id: "judged-ending-swap" }) }) });
    return true;
  }
  logger.error({ msg: `turn settle-reaction: admitted past ${JUDGED_ENDING_SWAP_HATCH}=1 — ${detail}` });
  return false;
}

/**
 * Settle one ask's reaction, once every argument is known good.
 *
 * @param home the resolved state home
 * @param inputs the channel, message ts and ending the caller named
 * @returns the process exit code
 */
async function settle({
  home,
  inputs,
}: {
  home: string;
  inputs: { readonly channel: string; readonly messageTs: string; readonly reaction: TerminalReaction };
}): Promise<number> {
  const { channel, messageTs, reaction } = inputs;
  const entry = capturedAskFor({ channel, home, messageTs });
  if (entry === undefined) {
    logger.error({
      msg: `turn settle-reaction: ${channel}/${messageTs} was never captured, so the bot raised no lifecycle reaction on it — refusing rather than inventing one`,
    });
    return EXIT_EXPECTED_EMPTY;
  }
  if (refusesJudgedEndingSwap({ askIdentity: entry, home, reaction, subject: `${channel}/${messageTs}` })) {
    return EXIT_ERROR;
  }
  const botToken = slackBotToken({ home });
  if (botToken === undefined) {
    logger.error({ msg: "turn settle-reaction: no Slack bot token, so the reaction cannot be settled" });
    return EXIT_EXPECTED_EMPTY;
  }
  const turnId = `settle-reaction-${messageTs}`;
  const outcome = await throughDoor({
    gates: [...DEFAULT_GATES],
    home,
    ledger: doorLedgerPort(),
    // The OUTCOME is checked, not just the absence of a throw: `settleLifecycleReaction` never rejects, so a
    // verb that ignored its value would exit 0 over a message it left half-converged — the same "an
    // indicator claims it settled when it did not" lie the convergence itself exists to end.
    perform: () =>
      settleLifecycleReaction({
        askIdentity: entry,
        home,
        reaction,
        transport: makeSlackWriteTransport({ home, token: botToken }),
      }),
    request: turnDoorRequest({ askIdentity: entry, home, targetTs: messageTs, turnId, verb: "settle-reaction" }),
  });
  if (outcome.kind === "recording-refused") {
    // Not the door's verdict: the decision could not be recorded, so the reaction was left as it was.
    logger.error({
      msg: `turn settle-reaction: ${channel}/${messageTs} not settled — ${outcome.error.message}`,
    });
    return EXIT_ERROR;
  }
  if (!outcome.performed) {
    logger.error({ msg: `turn settle-reaction: the admit door refused to settle ${channel}/${messageTs}` });
    return EXIT_ERROR;
  }
  if (outcome.result.isErr()) {
    logger.error({ msg: `turn settle-reaction: ${channel}/${messageTs} — ${outcome.result.error}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `settled ${channel}/${messageTs} to the ${reaction} reaction, alone` });
  return EXIT_OK;
}

export const turnSettleReactionCommand = defineCommand({ run: runTurnSettleReaction });
