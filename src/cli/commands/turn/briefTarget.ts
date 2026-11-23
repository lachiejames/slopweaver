/**
 * The target a `turn brief` is about, and every refusal it meets before anything is written: a missing flag, a
 * responder the whitelist does not admit, a permanently ignored ask or conversation, and, in a high-stakes channel,
 * a thread Slack does not confirm (`./briefHighStakes.ts`). Each refusal stops the verb before routing, a brief
 * write or a Slack post.
 */
import { slackBotToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { currentlyIgnoredConversations } from "../../../live/ask/ignoredConversationStore.js";
import { ignoredEntranceVerdict } from "../../../live/ask/ignoredEntrance.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import { capturedAskFor } from "../../../live/ask/store.js";
import type { MentionSurface } from "../../../live/listen/mention.js";
import { responderHatchOpenNow } from "../../../live/listen/responderHatch.js";
import { admitResponder, type ResponderWhitelist } from "../../../live/listen/whitelist.js";
import { loadResponderWhitelist } from "../../../live/listen/whitelistStore.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import { liveHighStakesDeps } from "../slack/highStakesRead.js";
import { turnBriefHighStakesRefusals } from "./briefHighStakes.js";
import { MENTION_SURFACES, str, TURN_BRIEF_USAGE } from "./core.js";

/** The addressing message this brief is about, as the flags describe it. */
export interface BriefTarget extends AskIdentity {
  readonly text: string;
  readonly userId: string;
  readonly surface: MentionSurface;
}

/**
 * `--text`, or the question the ledger already holds for this ask when the flag was not passed.
 *
 * Its own function rather than a coalesce because `no-silent-fallback` is the house rule and this
 * substitution is the whole behaviour: a session re-routing an ask the sweep called over should not have to
 * retype a sentence the listener already wrote down at capture.
 */
function resolvedBriefText({
  recordedText,
  values,
}: {
  recordedText: string | undefined;
  values: Readonly<Record<string, string | boolean>>;
}): string | undefined {
  const flagText = str({ key: "text", values });
  if (flagText !== undefined) {
    return flagText;
  }
  return recordedText;
}

/**
 * Build the target from flags, reporting every missing one at once.
 *
 * `--surface` is validated rather than coerced, for the reason it always was: a typo silently becoming
 * `channel` would skip the thread title and leave an operator staring at an unnamed container wondering
 * whether the code shipped.
 *
 * `--user` is put through the SAME responder whitelist the live socket gate applies, because this function
 * builds a target from raw flags — a hand-typed or `listen recover`-replayed command reaches it without
 * ever passing through the socket, so a second entrance that skipped the check would not be a gate at all.
 * The check runs AFTER every missing-flag error, so a genuinely malformed invocation is still reported as
 * usage rather than as a refusal that has nothing to do with the identity.
 *
 * `--text` falls back to `recordedText` — the question the listener wrote onto this ask's own `captured`
 * event — for the same reason `--turn-id`/`--working-ts` fall back to the ledger in `resolvedStarted`:
 * the fact is already durably recorded, and requiring a session to re-supply it is what makes a re-route
 * command something to assemble by hand rather than something to run. It is what lets
 * `./dispatchSweep.ts`'s never-dispatched line print a command that works. The flag still WINS when both
 * exist — an edited message re-briefed with new text is a real case, and the ledger's copy is the older one.
 *
 * @param values the parsed flag values
 * @param recordedText this ask's question as the ask-lifecycle log recorded it, when it has one
 * @param responderAllowOpen whether the journalled `responder-allow-open` grant is open — the caller's job
 *   to read, so this function stays pure
 * @param responderWhitelist the loaded gate every `--user` is admitted or refused against
 * @returns the target; the names of every missing/invalid flag; or the refusal naming why the identity was
 *   not admitted
 */
export function briefTargetFromFlags({
  values,
  recordedText,
  responderAllowOpen,
  responderWhitelist,
}: {
  values: Readonly<Record<string, string | boolean>>;
  recordedText?: string | undefined;
  responderAllowOpen: boolean;
  responderWhitelist: ResponderWhitelist;
}): { readonly target: BriefTarget } | { readonly missing: readonly string[] } | { readonly refused: string } {
  const channel = str({ key: "channel", values });
  const messageTs = str({ key: "message-ts", values });
  const threadTs = str({ key: "thread-ts", values });
  const text = resolvedBriefText({ recordedText, values });
  const userId = str({ key: "user", values });
  const rawSurface = str({ key: "surface", values });
  // An absent `--surface` is a channel mention by design; an invalid one is refused below.
  const surface = rawSurface === undefined ? "channel" : MENTION_SURFACES.find((known) => known === rawSurface);
  const missing = [
    channel === undefined ? "--channel" : undefined,
    messageTs === undefined ? "--message-ts" : undefined,
    threadTs === undefined ? "--thread-ts" : undefined,
    text === undefined ? "--text" : undefined,
    userId === undefined ? "--user" : undefined,
    surface === undefined
      ? `--surface must be one of ${MENTION_SURFACES.join("|")}, but got \`${rawSurface}\``
      : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  if (
    channel === undefined ||
    messageTs === undefined ||
    threadTs === undefined ||
    text === undefined ||
    userId === undefined ||
    surface === undefined ||
    missing.length > 0
  ) {
    return { missing };
  }
  const decision = admitResponder({ openOverride: responderAllowOpen, userId, whitelist: responderWhitelist });
  if (!decision.admitted) {
    return { refused: decision.why };
  }
  return { target: { channel, messageTs, surface, text, threadTs, userId } };
}

/**
 * The question this ask's own `captured` ledger row recorded, as a spreadable override for
 * {@link briefTargetFromFlags} — empty whenever there is nothing to recover or nothing to recover it for.
 *
 * Spreadable rather than `string | undefined` because `exactOptionalPropertyTypes` is on: an explicit
 * `recordedText: undefined` is a different thing from an absent one, and only the absent one is honest here.
 */
function recordedTextFor({ home, values }: { home: string; values: Readonly<Record<string, string | boolean>> }): {
  readonly recordedText?: string;
} {
  const channel = str({ key: "channel", values });
  const messageTs = str({ key: "message-ts", values });
  if (channel === undefined || messageTs === undefined || str({ key: "text", values }) !== undefined) {
    // Nothing to look up, or the caller supplied the question itself. Both are the ordinary case, and a
    // whole-log fold is not worth paying for either of them.
    return {};
  }
  const recorded = capturedAskFor({ channel, home, messageTs })?.text;
  if (recorded === undefined) {
    return {};
  }
  logger.info({
    msg:
      "turn brief: recovered the question from the ask-lifecycle log — --text was not passed for " +
      `${channel}/${messageTs}`,
  });
  return { recordedText: recorded };
}

/**
 * The admitted target for one brief, or the exact exit code a refusal already reported — folds the
 * flag-build, responder, permanent-ignore and high-stakes checks into one flat step so the verb stays a
 * simple sequence of refusals rather than re-growing the same nested complexity those checks had there.
 *
 * @param home the resolved state home
 * @param values the parsed flag values
 * @returns the admitted target, or the exit code a refusal already logged
 */
export async function admittedTargetOrRefusal({
  home,
  values,
}: {
  home: string;
  values: Readonly<Record<string, string | boolean>>;
}): Promise<BriefTarget | { readonly code: number }> {
  const built = briefTargetFromFlags({
    responderAllowOpen: responderHatchOpenNow({ home }),
    responderWhitelist: loadResponderWhitelist({ home }),
    values,
    ...recordedTextFor({ home, values }),
  });
  if ("refused" in built) {
    // No usage line: the invocation was well-formed and reports an expected denial, not a mistake. No
    // routing, retrieval, brief write or Slack call happens — the manual/replayed entrance stops here.
    logger.error({ msg: `turn brief: responder refused: ${built.refused}` });
    return { code: EXIT_EXPECTED_EMPTY };
  }
  if (!("target" in built)) {
    for (const problem of built.missing) {
      logger.error({ msg: problem.startsWith("--surface must") ? problem : `${problem} is required` });
    }
    if (built.missing.includes("--text")) {
      // Said out loud, because the fallback that would normally cover this one is silent when it fires.
      logger.error({
        msg:
          "turn brief: --text could not be recovered either — this ask has no `captured` ledger row, or it " +
          "was captured before that row recorded the question. Pass the message text.",
      });
    }
    logger.error({ msg: TURN_BRIEF_USAGE });
    return { code: EXIT_USAGE };
  }
  const ignoredVerdict = ignoredEntranceVerdict({
    askIdentity: built.target,
    ignoredAsks: currentlyIgnoredAsks({ home }),
    ignoredConversations: currentlyIgnoredConversations({ home }),
  });
  if (ignoredVerdict !== undefined) {
    // Same code as a responder refusal, for the same reason: a well-formed invocation reporting an
    // expected denial, not a mistake — no routing, brief write or Slack call happens past this point.
    logger.error({
      msg:
        ignoredVerdict.kind === "ask"
          ? `turn brief: this exact ask is permanently ignored — ${built.target.channel}/${built.target.messageTs}`
          : `turn brief: this conversation is permanently ignored — ${built.target.channel}/${built.target.messageTs}`,
    });
    return { code: EXIT_EXPECTED_EMPTY };
  }
  return confirmedHighStakesThread({ home, target: built.target });
}

/** The target once its thread is confirmed in a high-stakes channel, or the exit code the logged refusal earns. */
async function confirmedHighStakesThread({
  home,
  target,
}: {
  home: string;
  target: BriefTarget;
}): Promise<BriefTarget | { readonly code: number }> {
  const refusals = await turnBriefHighStakesRefusals({
    channel: target.channel,
    deps: liveHighStakesDeps(),
    env: process.env,
    home,
    threadTs: target.threadTs,
    token: slackBotToken({ home }),
  });
  for (const line of refusals) {
    logger.error({ msg: line });
  }
  return refusals.length > 0 ? { code: EXIT_ERROR } : target;
}
