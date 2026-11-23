/**
 * `slopweaver turn retire-card` — delete ONE orphaned in-thread progress card, named exactly.
 *
 * The by-hand retirement for the card no writer owns: an ask's EARLIER card, which its lifecycle no longer
 * names as current once a second card was posted over it. `../../../live/ask/orphanedCard.ts` carries how a
 * card gets there, and the verdict that decides whether this one is safe to delete. This file is the shell:
 * read the log, fail closed on any line it cannot read, ask the verdict, delete through the door.
 *
 * **The card is the caller's, never `startedRefForAsk`'s.** That lookup answers the ask's CURRENT card — the
 * one card that is not orphaned. So `--working-ts` is required and checked against the log, not read off it.
 *
 * **Deleted, never finalised in place.** An answer reaps every card its ask posted
 * (`../../../live/turn/earlierCards.ts`), and the owner's rule is that a thread keeps nothing irrelevant from
 * the bot once a success stands. The orphan is a duplicate of a card the ask's own ending already settled, so
 * a finalised frame would be a second, stale copy of the same news.
 *
 * **At most once, over a decision taken before the call**, so it takes `deleteMessageOnce`, the transport
 * method `../../../corpus/slack/writeTransport.ts` reserves for exactly that, and reads Slack's `already-gone`
 * as the job already done.
 *
 * **Judged twice, and one residue stated rather than discovered.** The verdict is taken once to build the door
 * request, then taken AGAIN over a fresh read inside the door's effect, so a re-dispatch or a ride appended
 * while the door recorded its decision refuses the delete. No lock spans every lifecycle writer, so an append
 * landing between that second read and the `chat.delete` itself is still not seen. Closing that last window
 * would take every writer joining one protocol, and a lock only this verb took would close nothing.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { throughDoor } from "../../../admit/effects.js";
import { slackBotToken } from "../../../config.js";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import type { DeleteMessageOutcome } from "../../../corpus/slack/writeTransport.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import {
  type AskLifecycleEvent,
  askLifecycleKey,
  foldAskLifecycle,
  parseAskLifecycleLog,
} from "../../../live/ask/lifecycle.js";
import { type OrphanedCard, orphanedCardVerdict } from "../../../live/ask/orphanedCard.js";
import { askLifecyclePath } from "../../../live/ask/store.js";
import { turnDoorRequest } from "../../../live/turn/poster.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { str } from "./core.js";
import { TURN_RETIRE_CARD_FLAG_SPEC, TURN_RETIRE_CARD_USAGE } from "./retireCardUsage.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, retire-card, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, no network, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn retire-card`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnRetireCardArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_RETIRE_CARD_FLAG_SPEC.boolean], string: [...TURN_RETIRE_CARD_FLAG_SPEC.string] },
  });
}

/** The three values the verb cannot run without. */
interface RetireCardInputs {
  readonly channel: string;
  readonly messageTs: string;
  readonly workingTs: string;
}

/**
 * The verb's required inputs, or every flag missing. Pure and total.
 *
 * @param values the parsed flag values
 * @returns the inputs, or the flags whose absence stopped the verb
 */
export function retireCardInputs({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}):
  | { readonly kind: "ready"; readonly inputs: RetireCardInputs }
  | { readonly kind: "missing"; readonly flags: readonly string[] } {
  const channel = str({ key: "channel", values });
  const messageTs = str({ key: "message-ts", values });
  const workingTs = str({ key: "working-ts", values });
  if (channel !== undefined && messageTs !== undefined && workingTs !== undefined) {
    return { inputs: { channel, messageTs, workingTs }, kind: "ready" };
  }
  const flags = [
    channel === undefined ? "--channel" : undefined,
    messageTs === undefined ? "--message-ts" : undefined,
    workingTs === undefined ? "--working-ts" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  return { flags, kind: "missing" };
}

/**
 * The line this verb prints for one delete outcome, and its exit code. Pure and total.
 *
 * @param card the orphan the verdict cleared
 * @param channel the card's channel
 * @param outcome what Slack answered
 * @returns the line, which stream it goes to, and the exit code
 */
export function retireCardReport({
  card,
  channel,
  outcome,
}: {
  card: OrphanedCard;
  channel: string;
  outcome: DeleteMessageOutcome;
}): { readonly line: string; readonly stream: "out" | "error"; readonly exit: number } {
  const where = `${channel}/${card.workingTs}`;
  if (outcome.kind === "gone") {
    return { exit: EXIT_OK, line: `retired orphaned card ${where}`, stream: "out" };
  }
  if (outcome.kind === "already-gone") {
    return {
      exit: EXIT_OK,
      line: `orphaned card ${where} was already gone from Slack — nothing to retire`,
      stream: "out",
    };
  }
  return { exit: EXIT_ERROR, line: `turn retire-card: ${where} was not deleted — ${outcome.reason}`, stream: "error" };
}

/**
 * The lifecycle log's events and its unreadable 1-indexed line numbers, streamed a line at a time, failing
 * CLOSED: an absent log is empty (a home that never captured an ask), and any other read error is `undefined`,
 * never read as empty — an empty log would make every refusal below vanish.
 */
function lifecycleEventsOrUnreadable({ home }: { home: string }): ReturnType<typeof parseAskLifecycleLog> | undefined {
  const events: AskLifecycleEvent[] = [];
  const unreadable: number[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index, undecodable }) => {
        // A byte that is not UTF-8 would otherwise be repaired to U+FFFD and could still decode as an event.
        if (undecodable) {
          unreadable.push(index + 1);
          return;
        }
        const parsed = parseAskLifecycleLog({ text: line });
        events.push(...parsed.events);
        if (parsed.unreadable.length > 0) {
          unreadable.push(index + 1);
        }
      },
      path: askLifecyclePath({ home }),
      strictUtf8: true,
    });
  } catch (error: unknown) {
    const absent = error instanceof Error && "code" in error && error.code === "ENOENT";
    return absent ? { events: [], unreadable: [] } : undefined;
  }
  return { events, unreadable };
}

/**
 * Run the retire-card verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export async function runTurnRetireCard(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_RETIRE_CARD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnRetireCardArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: TURN_RETIRE_CARD_USAGE });
    return EXIT_USAGE;
  }
  const read = retireCardInputs({ values: parsed.value.values });
  if (read.kind === "missing") {
    for (const flag of read.flags) {
      logger.error({ msg: `${flag} is required` });
    }
    logger.error({ msg: TURN_RETIRE_CARD_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: str({ key: "home", values: parsed.value.values }) });
  return retire({ home, inputs: read.inputs });
}

/** One judgement of the named card over a fresh read of the log: the orphan, or the exit a refusal earns. */
type CardJudgement =
  | { readonly kind: "orphan"; readonly askIdentity: AskIdentity; readonly card: OrphanedCard }
  | { readonly kind: "refused"; readonly exit: number };

/**
 * Read the log afresh and judge the named card over it, logging any refusal. Every call re-reads, so a second
 * call sees whatever a writer appended since the first.
 *
 * @param home the resolved state home
 * @param inputs the ask and the card the caller named
 * @returns the orphan with its ask, or the exit code the refusal earns
 */
function judgeCard({ home, inputs }: { home: string; inputs: RetireCardInputs }): CardJudgement {
  const { channel, messageTs, workingTs } = inputs;
  const log = lifecycleEventsOrUnreadable({ home });
  if (log === undefined) {
    logger.error({
      msg: `turn retire-card: the ask lifecycle log at ${askLifecyclePath({ home })} cannot be read, so no card is judged orphaned`,
    });
    return { exit: EXIT_ERROR, kind: "refused" };
  }
  const { events, unreadable } = log;
  if (unreadable.length > 0) {
    // Any skipped line could be the very event that reopened this ask, or another holder's ride of the card.
    logger.error({
      msg:
        `turn retire-card: ask lifecycle log line(s) ${unreadable.join(", ")} cannot be read, and any of them could ` +
        "reopen this ask or name another holder of the card — refusing rather than judging a partial log",
    });
    return { exit: EXIT_ERROR, kind: "refused" };
  }
  // Keyed on (channel, messageTs) alone, so the thread is filled in off the fold when the ask was captured; an
  // uncaptured ask is refused by the verdict before its thread could matter.
  const entry = foldAskLifecycle({ events }).get(
    askLifecycleKey({ askIdentity: { channel, messageTs, threadTs: messageTs } }),
  );
  const askIdentity =
    entry === undefined ? { channel, messageTs, threadTs: messageTs } : askIdentityOf({ source: entry });
  const verdict = orphanedCardVerdict({ askIdentity, events, workingTs });
  if (verdict.isErr()) {
    logger.error({ msg: `turn retire-card: ${verdict.error.code} — ${verdict.error.message}` });
    // Every code says the same thing to a script: the named card is not an orphan, so there is nothing to retire.
    return { exit: EXIT_EXPECTED_EMPTY, kind: "refused" };
  }
  return { askIdentity, card: verdict.value, kind: "orphan" };
}

/** What the door's effect did: Slack's answer to the delete, or a re-judgement that refused before it. */
type RetireAttempt = DeleteMessageOutcome | { readonly kind: "refused-on-recheck"; readonly exit: number };

/**
 * Judge the named card against the log and, only when it is orphaned, delete it through the door — judging it
 * AGAIN inside the door's effect, immediately before the delete, so a writer that appended while the door
 * recorded its decision is seen.
 *
 * @param home the resolved state home
 * @param inputs the ask and the card the caller named
 * @returns the process exit code
 */
async function retire({ home, inputs }: { home: string; inputs: RetireCardInputs }): Promise<number> {
  const { channel, workingTs } = inputs;
  const judged = judgeCard({ home, inputs });
  if (judged.kind === "refused") {
    return judged.exit;
  }
  const botToken = slackBotToken({ home });
  if (botToken === undefined) {
    logger.error({ msg: "turn retire-card: no Slack bot token, so the card cannot be deleted" });
    return EXIT_EXPECTED_EMPTY;
  }
  const transport = makeSlackWriteTransport({ home, token: botToken });
  const outcome = await throughDoor({
    gates: [...DEFAULT_GATES],
    home,
    ledger: doorLedgerPort(),
    perform: async (): Promise<RetireAttempt> => {
      const again = judgeCard({ home, inputs });
      if (again.kind === "refused") {
        return { exit: again.exit, kind: "refused-on-recheck" };
      }
      return transport.deleteMessageOnce({ posted: { channel, ts: again.card.workingTs } });
    },
    request: turnDoorRequest({
      askIdentity: judged.askIdentity,
      home,
      targetTs: workingTs,
      turnId: judged.card.turnId,
      verb: "retire-card",
    }),
  });
  if (outcome.kind === "recording-refused") {
    logger.error({ msg: `turn retire-card: ${channel}/${workingTs} not deleted — ${outcome.error.message}` });
    return EXIT_ERROR;
  }
  if (!outcome.performed) {
    logger.error({ msg: `turn retire-card: the admit door refused to delete ${channel}/${workingTs}` });
    return EXIT_ERROR;
  }
  if (outcome.result.kind === "refused-on-recheck") {
    logger.error({
      msg: `turn retire-card: ${channel}/${workingTs} not deleted — the log changed while the door recorded the decision`,
    });
    return outcome.result.exit;
  }
  const report = retireCardReport({ card: judged.card, channel, outcome: outcome.result });
  if (report.stream === "out") {
    logger.out({ line: report.line });
  } else {
    logger.error({ msg: report.line });
  }
  return report.exit;
}

export const turnRetireCardCommand = defineCommand({ run: runTurnRetireCard });
