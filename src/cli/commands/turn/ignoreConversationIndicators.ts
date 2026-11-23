/**
 * Settling the live indicators of EVERY already-captured, still-unresolved ask in a conversation the
 * operator has decided to ignore forever — the channel-keyed sibling of `./ignoreIndicators.ts`.
 *
 * `turn ignore` settles exactly one ask because it names exactly one. `turn ignore-conversation` names a
 * whole channel, and any number of asks in it may already be sitting captured, mid-checklist or dispatched
 * at the moment the channel is suppressed — the owner ruling this closes named 21 stale asks in one DM alone.
 * Each of those must be settled through the SAME seam `./ignoreIndicators.ts` uses, quietly: no new message,
 * no drain, exactly the posture `./ignoreIndicators.ts`'s own header describes for one ask, just applied to
 * every unresolved ask this channel currently has. `settleOneAskIndicatorPlan` is the actual Slack write, and
 * this module reuses it rather than duplicating it — this is only the SELECTION half: which asks qualify.
 */

import { slackBotToken } from "../../../config.js";
import { foldAskLifecycle, parseAskLifecycleLog, terminalAskLifecycleEvent } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { ignoredAskIndicatorPlan, settleOneAskIndicatorPlan } from "./ignoreIndicators.js";

/**
 * Settle every indicator every already-captured, unresolved ask in one conversation raised.
 *
 * Best-effort in every direction and never a throw: a channel with no unresolved asks, or a home with no
 * Slack bot token, means there is nothing this can correct and the registry write still stands on its own.
 * What it must never do is fail the verb — the ignore itself has already been recorded by the time this runs.
 *
 * @param channel the conversation being ignored
 * @param home the resolved state home
 * @param reason the operator's own words, shown on each settled card
 * @param report where an indicator that could not be settled is named, one line each
 * @param env the environment to resolve the bot token from — a test asserting "no bot token configured"
 *   injects `{}` here instead of relying on the ambient shell (defaults to `process.env`)
 */
export async function settleIgnoredConversationIndicators({
  channel,
  home,
  reason,
  report,
  env,
}: {
  channel: string;
  home: string;
  reason: string;
  report: (input: { failure: string }) => void;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  const events = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events;
  const folded = foldAskLifecycle({ events });
  const unresolved = [...folded.values()].filter(
    (entry) => entry.channel === channel && terminalAskLifecycleEvent({ event: entry.lastEvent }) === undefined,
  );
  if (unresolved.length === 0) {
    return;
  }
  const botToken = slackBotToken({ home, ...(env !== undefined ? { env } : {}) });
  if (botToken === undefined) {
    report({
      failure: `could not settle ${String(unresolved.length)} already-captured ask(s) — no Slack bot token is configured`,
    });
    return;
  }
  for (const entry of unresolved) {
    const plan = ignoredAskIndicatorPlan({ entry, messageTs: entry.messageTs, reason });
    if (plan.kind === "nothing-raised") {
      continue;
    }
    const failures = await settleOneAskIndicatorPlan({
      botToken,
      entry,
      home,
      operatorId: "turn ignore-conversation",
      plan,
    });
    for (const failure of failures) {
      report({ failure: `${entry.channel}/${entry.messageTs} — ${failure}` });
    }
  }
}
