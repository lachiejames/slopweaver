/*
 * The pure fixtures every all-visible workspace-sweep test file shares: the one recovery window most cases read,
 * a classification context over empty registries, and a tagged message row as `conversations.history` returns it.
 */
import type { IgnoredAsk } from "../../../../../live/ask/ignore.js";
import type { IgnoredConversation } from "../../../../../live/ask/ignoredConversation.js";
import type { ClassificationContext } from "../../../../../live/listen/recoverForegroundMessages.js";
import type { RecoveryWindow } from "../../../../../live/listen/recoverSchedule.js";
import { NO_IGNORED_CONVERSATIONS, NO_IGNORES, NO_LIFECYCLES, NO_TERMINAL } from "../recover/fixtures.js";

/** The recovery window a sweep reads unless a case names its own. */
export const WINDOW: RecoveryWindow = {
  latestExclusiveTs: "1786622400.000000",
  oldestExclusiveTs: "1786320000.000000",
  sinceIso: "2026-08-10T00:00:00.000Z",
  untilIso: "2026-08-13T12:00:00.000Z",
};

/**
 * A classification context that excludes nothing but "not-addressed"/"wrong-place" on its own terms.
 *
 * @returns the context `recoverWorkspace` classifies every read message against
 */
export function classificationFor({
  ignored = NO_IGNORES,
  ignoredConversations = NO_IGNORED_CONVERSATIONS,
}: {
  ignored?: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations?: ReadonlyMap<string, IgnoredConversation>;
} = {}): ClassificationContext {
  return {
    allowedChannels: ["C1", "C2"],
    botUserId: "U_BOT",
    cardEventType: "slopweaver_card_v1",
    ignored,
    ignoredConversations,
    lifecycles: NO_LIFECYCLES,
    since: "2020-01-01T00:00:00.000Z",
    terminalByAsk: NO_TERMINAL,
  };
}

/**
 * A tagged, unanswered message shaped the way `conversations.history` returns it.
 *
 * @param botUser the user id the message's mention names
 * @returns the raw message row, authored by `U_ASKER`
 */
export function tagRow({ ts, botUser = "U_BOT" }: { ts: string; botUser?: string }): Record<string, unknown> {
  return { text: `<@${botUser}> hello`, ts, user: "U_ASKER" };
}
