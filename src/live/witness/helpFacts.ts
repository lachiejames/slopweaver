/**
 * The non-journal facts `witness help` judges a message against, derived from already-read state. Pure — the
 * reads are `../../cli/commands/witness/deps.ts`'s, so every rule here is tested without a home.
 *
 * Each fact is the SAME gate a real tag crosses, read the same way: the responder whitelist through
 * `admitResponder` (honouring the open override exactly as the listener does), both ignore registries through
 * `ignoredEntranceVerdict`, the ask lifecycle through `foldAskLifecycle` and `activeAsks`. "As if tagged"
 * means no looser gate than a tag, and no second copy of any of them.
 */
import { activeAsks } from "../ask/burst.js";
import type { IgnoredAsk } from "../ask/ignore.js";
import type { IgnoredConversation } from "../ask/ignoredConversation.js";
import { ignoredEntranceVerdict } from "../ask/ignoredEntrance.js";
import { foldAskLifecycle } from "../ask/lifecycle.js";
import type { AskLifecycleEvent } from "../ask/lifecycleEvents.js";
import { admitResponder, type ResponderWhitelist } from "../listen/whitelist.js";
import { isOwnWatchedThread, type WitnessState } from "../listen/witnessState.js";
import type { WitnessHelpFacts, WitnessHelpRequest } from "./help.js";

/**
 * Derive a help's facts from the state they rest on.
 *
 * @param request the message being helped
 * @param nowIso the instant retention and an unrouted ask's age are judged at
 * @param witnessState the witnessed-thread snapshot
 * @param whitelist the responder whitelist as loaded
 * @param openOverride whether the journalled `responder-allow-open` grant is open — the listener's own override
 * @param ignoredAsks the exact-ask ignore registry
 * @param ignoredConversations the conversation ignore registry
 * @param lifecycleEvents the parsed ask-lifecycle log
 * @returns the facts {@link ./help.ts}'s planner checks
 */
export function helpFactsFrom({
  ignoredAsks,
  ignoredConversations,
  lifecycleEvents,
  nowIso,
  openOverride,
  request,
  whitelist,
  witnessState,
}: {
  ignoredAsks: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
  lifecycleEvents: readonly AskLifecycleEvent[];
  nowIso: string;
  openOverride: boolean;
  request: WitnessHelpRequest;
  whitelist: ResponderWhitelist;
  witnessState: WitnessState;
}): WitnessHelpFacts {
  const { key, userId } = request;
  const decision = admitResponder({ openOverride, userId, whitelist });
  const responder: WitnessHelpFacts["responder"] = decision.admitted
    ? { admitted: true }
    : { admitted: false, why: decision.why };
  const live = activeAsks({ events: lifecycleEvents, ignored: ignoredAsks, ignoredConversations, nowIso }).find(
    (ask) => ask.channel === key.channel && ask.threadTs === key.threadTs,
  );
  return {
    alreadyAnAsk: foldAskLifecycle({ events: lifecycleEvents }).has(JSON.stringify([key.channel, key.messageTs])),
    ignored: ignoredEntranceVerdict({ askIdentity: key, ignoredAsks, ignoredConversations })?.kind,
    ownThread: isOwnWatchedThread({
      channel: key.channel,
      nowMs: Date.parse(nowIso),
      state: witnessState,
      threadTs: key.threadTs,
    }),
    responder,
    threadActiveAsk: live?.messageTs,
  };
}
