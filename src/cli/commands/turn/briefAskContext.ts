/**
 * What `turn brief` reads about the ask's OTHER state before it writes the brief: the same asker's other
 * in-flight asks, whether `witness help` opened this ask rather than a tag, and whether its thread stood the
 * bot down. Each is a read of a durable
 * log under the home, kept here so the verb's own module stays under the file-size ratchet.
 */
import { logger } from "#lib/logger.js";
import { type ActiveAsk, activeAsks } from "../../../live/ask/burst.js";
import { currentlyIgnoredConversations } from "../../../live/ask/ignoredConversationStore.js";
import { currentlyIgnoredAsks } from "../../../live/ask/ignoreStore.js";
import { parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import { unpromptedHelpFor } from "../../../live/witness/help.js";
import { readWitnessJournal } from "../../../live/witness/journalStore.js";
import { threadStandDown } from "../../../live/witness/standDown.js";
import type { BriefTarget } from "./briefTarget.js";

/**
 * The SAME asker's other in-flight asks, read fresh off the lifecycle log — what the brief carries so a
 * follow-up can be JUDGED rather than parked behind the ask it follows. It excludes this ask's own entry, and
 * both ignore registries plus the sweep's own staleness bound apply, so a dead holder is never named to the
 * judge.
 *
 * @param home the resolved state home
 * @param target the brief's target
 * @returns the asker's other live asks, oldest first as the lifecycle folds them
 */
export function otherActiveAsksFor({ home, target }: { home: string; target: BriefTarget }): readonly ActiveAsk[] {
  const events = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events;
  const active = activeAsks({
    events,
    ignored: currentlyIgnoredAsks({ home }),
    ignoredConversations: currentlyIgnoredConversations({ home }),
    nowIso: new Date().toISOString(),
  });
  return active.filter((ask) => ask.userId === target.userId && ask.messageTs !== target.messageTs);
}

/**
 * What the witness journal says about this ask, from ONE read: whether `witness help` opened it (a `helped` row
 * naming its message) and whether somebody in its thread stood the bot down (a `stood-down` row anywhere in the
 * thread).
 *
 * An unreadable journal is said on stderr and reads as a plain tag in a thread that never stood down. That is
 * deliberate for both halves, and the second was weighed: refusing the
 * brief instead was considered, but one corrupt line would then stop EVERY tag in the workspace being answered, while the
 * harm it prevents is answering a steer in a thread whose author tagged the bot to say it.
 *
 * @param home the resolved state home
 * @param target the brief's target
 * @returns the two flags the brief carries
 */
export function witnessAskContextFor({ home, target }: { home: string; target: BriefTarget }): {
  readonly unprompted: boolean;
  readonly stoodDown: boolean;
} {
  const events = readWitnessJournal({ home });
  if (events.isErr()) {
    logger.error({
      msg: `turn brief: could not read the witness journal, so this brief reads as a tag in a thread that never stood the bot down — ${events.error.message}`,
    });
    return { stoodDown: false, unprompted: false };
  }
  const { channel, messageTs, threadTs } = target;
  return {
    stoodDown: threadStandDown({ channel, events: events.value, threadTs }) !== undefined,
    unprompted: unpromptedHelpFor({ channel, events: events.value, messageTs }),
  };
}
