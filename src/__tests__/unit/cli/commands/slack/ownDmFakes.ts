/**
 * Plain fakes for `verifiedOwnDm` (`src/cli/commands/slack/verifiedOwnDm.ts`), the seam that proves a destination the owner's
 * own bot DM. Each fixture configures `D0PROMPT` as `slackBot.promptChannel`.
 */
import type { VerifyOwnDm } from "../../../../../cli/commands/slack/verifiedOwnDm.js";

/** The prompt channel every fixture configures. */
export const PROMPT_DM = "D0PROMPT";

/**
 * The bot-token read named the owner as `D0PROMPT`'s other member: that channel, and only it, is proven theirs.
 *
 * @returns `D0PROMPT` when asked about it, undefined for any other destination
 */
export const PROMPT_DM_IS_OWNERS: VerifyOwnDm = async ({ channel }) => (channel === PROMPT_DM ? channel : undefined);

/**
 * The read named somebody else, or could not be made: nothing is proven the owner's, so every destination is judged.
 *
 * @returns undefined, whatever the destination
 */
export const NOTHING_PROVEN: VerifyOwnDm = async () => undefined;

/**
 * `answer`, recording every destination it was asked about, so a case proves the caller ASKED rather than passing
 * because it judged everything.
 *
 * @param answer the verdict the read gives
 * @returns the recording seam and the destinations it was asked about
 */
export function recordingOwnDm({ answer }: { answer: VerifyOwnDm }): { asked: string[]; verify: VerifyOwnDm } {
  const asked: string[] = [];
  return {
    asked,
    verify: async (args) => {
      asked.push(args.channel);
      return answer(args);
    },
  };
}
