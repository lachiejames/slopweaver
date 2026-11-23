/**
 * The one helper several `listen recover --scheduled` cycle test files share: the empty read seam. It moved here,
 * unchanged, when `src/__tests__/unit/cli/commands/listen/scheduledRecover.test.ts` was split by behaviour.
 */
import type { SlackApi } from "../../../../../../corpus/slack/fetch.js";

/**
 * A fake read seam serving no channels and no messages by default — a due, empty, complete sweep.
 *
 * @returns a read seam whose history, replies and channel list are all empty
 */
export function emptyApi(): Pick<SlackApi, "history" | "replies" | "listChannels"> {
  return {
    history: async () => ({ messages: [] }),
    listChannels: async () => ({ channels: [] }),
    replies: async () => ({ messages: [] }),
  };
}
