/**
 * The refusals `slopweaver turn answer`'s direct mode owes an ask before it posts anything — facts about the
 * ask that no file the caller hands in can override.
 *
 * Split out of `./loadInputs.ts`, which reads and validates the inputs; this is what it asks the ask-lifecycle
 * log about them: is the ask still waiting on the owner, and is the `--decision` file the one the log
 * dispatched. `./postAnswer.ts` asks the ignore registries the third: is the ask, or its conversation,
 * permanently ignored.
 */
import { isDeepStrictEqual } from "node:util";
import { logger } from "../../../lib/logger.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { currentlyIgnoredConversations } from "../../../live/ask/ignoredConversationStore.js";
import { ignoredEntranceVerdict } from "../../../live/ask/ignoredEntrance.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import {
  askLifecycleKey,
  parseAskLifecycleLog,
  type RecordedRespondDecision,
  terminalAskLifecycleEvent,
} from "../../../live/ask/lifecycle.js";
import { capturedAskFor, readAskLifecycleText } from "../../../live/ask/store.js";
import type { RespondDecision } from "../../../live/turn/tier.js";
import { type TurnCommandError, TurnCommandErrors } from "./errors.js";

/**
 * What the ask-lifecycle log says about the decision a direct-mode `--decision` file should be checked
 * against — `never-dispatched` when the gates before this check should proceed unhindered (a hand-authored
 * fixture that skips `turn dispatch` entirely stays a valid entrance), `current` with the most recent
 * `dispatched` event's own decision, or `resolved-since` when a REAL terminal event (`answered`,
 * `triaged-no-response`, `withheld`) landed after that dispatch — meaning the ask is already done and no
 * decision file, however well it matches, should be allowed to post another answer for it.
 *
 * A named gap, not yet closed here: this binds the DECISION to its generation, never the BRIEF. If the same
 * Slack message is edited (same `messageTs`, new text), re-briefed, and re-dispatched to a decision that
 * happens to be VALUE-IDENTICAL to an earlier, lease-expired generation's decision, a caller could still pass
 * a STALE brief file (the old question) alongside that value-identical decision and have it validate — the
 * answer would then be grounded against the wrong question. Closing it needs the same generation-binding
 * apparatus extended to brief identity (e.g. a content hash recorded on the `dispatched` event), which is
 * real follow-up scope, not a residual accepted the way the lease-collision/forged-log cases above are.
 *
 * A DELIBERATE non-goal, stated so it is not re-litigated: this checks the decision's VALUE against the
 * current generation's, never which FILE PATH the caller happened to read it from. A caller supplying an
 * older file whose parsed content is value-identical to the current generation's decision produces IDENTICAL
 * behaviour to supplying the current file — the same tier, the same needs, the same grounding rules apply
 * either way. Binding to file provenance instead of decision correctness would protect against nothing an
 * answer actually does differently; it is the invariant that matters (is this decision still the real one)
 * that this function enforces, not a stricter one (is this the literal same file) that a value-identical
 * re-judgement would still trip for no behavioural reason.
 */
type DispatchGenerationCheck =
  | { readonly kind: "never-dispatched" }
  | { readonly kind: "current"; readonly decision: RecordedRespondDecision }
  | { readonly kind: "resolved-since" };

/**
 * Classify one ask's dispatch generation from the raw ask-lifecycle log.
 *
 * Scans the raw log directly rather than through `foldAskLifecycle` on purpose: the fold's `lastEvent`
 * advances past a `dispatched` event the moment ANY later event is appended, including `lease-expired` —
 * which is a re-judgement CANDIDATE, not proof the recorded decision stopped being the real one, so it must
 * NOT count as "resolved". A genuinely terminal event (`answered`/`triaged-no-response`/`withheld`) does.
 *
 * This reads the LIFECYCLE LOG's own decision, never the durable `FreshDispatchRecord` — deliberately. The
 * record exists only for the `fresh-visible-session` tier and is written, together with its own matching
 * lifecycle event, by `recordFreshDispatch`'s single call — the log's last `dispatched` event is therefore
 * always at least as fresh as the record, never staler, because nothing writes a record without appending
 * its own lifecycle event at the same time. A record describing a NEWER generation than the log's own last
 * entry would require a second, uncoordinated writer this codebase does not have, for the same reason
 * `currentGenerationDispatchRecord` names its own residual check-then-use window as theoretical rather
 * than real: one visible session drives one ask's dispatch history at a time.
 *
 * @param askIdentity the ask to look up
 * @param home the resolved state home
 * @returns the classification described above
 */
function dispatchGenerationCheck({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): DispatchGenerationCheck {
  const { events } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
  const key = askLifecycleKey({ askIdentity });
  let decision: RecordedRespondDecision | undefined;
  let resolvedSince = false;
  for (const event of events) {
    if (askLifecycleKey({ askIdentity: event }) !== key) {
      continue;
    }
    if (event.kind === "dispatched") {
      decision = event.decision;
      resolvedSince = false;
    } else if (terminalAskLifecycleEvent({ event }) !== undefined) {
      resolvedSince = true;
    }
  }
  if (decision === undefined) {
    return { kind: "never-dispatched" };
  }
  return resolvedSince ? { kind: "resolved-since" } : { decision, kind: "current" };
}

/**
 * The refusal for an ask still WAITING ON THE OWNER, or `undefined` when nothing of theirs is outstanding.
 *
 * Sits beside {@link refusalForStaleDecision} because it is the same kind of rule — a fact about this ask
 * that no file the caller hands in can override — and it is deliberately EARLY, ahead of the answer form's
 * own parse: a turn that must not post has no business being told its form is malformed first.
 *
 * It is the mechanical half of the owner's rail: the bot never treats something as done that is not really
 * done, never marks it done as a cheap way to tick it off a list, because the owner returns to it and is
 * embarrassed in public. Answering here would delete the card carrying the
 * hourglass, post a reply, swap the reaction to a tick and write a terminal event — every surface saying
 * done at once, over a step the owner never did.
 *
 * It reads `blockedOnHuman` on the FOLD, which `slopweaver turn unblock` clears, rather than the ask's
 * `state`: a turn that blocked, was unblocked and resumed writes stages afterwards, so a state test would
 * pass an ask still genuinely waiting the moment anything at all happened after the block.
 *
 * @param askIdentity the ask this answer would post for
 * @param home the resolved state home
 * @returns the refusal, naming the way out, or `undefined` when this ask may be answered
 */
export function refusalForBlockedOnHuman({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): TurnCommandError | undefined {
  const blocked = capturedAskFor({
    channel: askIdentity.channel,
    home,
    messageTs: askIdentity.messageTs,
  })?.blockedOnHuman;
  if (blocked === undefined) {
    return undefined;
  }
  return TurnCommandErrors.askBlockedOnHuman({ what: blocked.what });
}

/**
 * The one reason a direct-mode `--decision` file cannot be trusted for this ask, or `undefined` when it can
 * be — split out of `loadDirectInputs` to keep that function's branching under the complexity cap.
 *
 * @param askIdentity the ask this decision would answer
 * @param home the resolved state home
 * @param supplied the decision the caller handed `turn answer`
 * @returns the refusal reason, or `undefined` when the supplied decision is trustworthy
 */
export function refusalForStaleDecision({
  askIdentity,
  home,
  supplied,
}: {
  askIdentity: AskIdentity;
  home: string;
  supplied: RespondDecision;
}): TurnCommandError | undefined {
  const generation = dispatchGenerationCheck({ askIdentity, home });
  if (generation.kind === "resolved-since") {
    return TurnCommandErrors.decisionUntrusted({ why: "resolved-since" });
  }
  if (generation.kind === "current" && !isDeepStrictEqual(generation.decision, supplied)) {
    return TurnCommandErrors.decisionUntrusted({ why: "decision-mismatch" });
  }
  return undefined;
}

/**
 * Whether the ask's exact message or its whole conversation is permanently ignored, logging which when it is.
 *
 * @param askIdentity the ask this answer would post for
 * @param home the resolved state home the ignore registries live under
 * @returns true when the entrance is ignored (and already logged), false when it is open
 */
export function ignoredEntranceRefused({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): boolean {
  const ignoredVerdict = ignoredEntranceVerdict({
    askIdentity,
    ignoredAsks: currentlyIgnoredAsks({ home }),
    ignoredConversations: currentlyIgnoredConversations({ home }),
  });
  if (ignoredVerdict === undefined) {
    return false;
  }
  logger.error({
    msg:
      ignoredVerdict.kind === "ask"
        ? `turn answer: this exact ask is permanently ignored — ${askIdentity.channel}/${askIdentity.messageTs}`
        : `turn answer: this conversation is permanently ignored — ${askIdentity.channel}/${askIdentity.messageTs}`,
  });
  return true;
}
