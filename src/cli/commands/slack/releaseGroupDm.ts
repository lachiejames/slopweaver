/**
 * A group-DM row's stamp, re-read at release. Its own module because both releases call it and `./releaseRun.ts`
 * imports `./releaseBotRun.ts`, so the bot release cannot import it from there.
 */
import type { ParkedSlackDraft } from "../../../outbound/slack/draftRegister.js";
import { type SlackLifecycleError, SlackLifecycleErrors } from "./lifecycleErrors.js";
import type { SlackWriteDeps } from "./run.js";

/**
 * Re-read, at release, the one fact a group-DM row skipped its first-message proof on: the conversation IS a group DM.
 * The `groupDm` stamp is what the RECORDING read, and a register line can be written, or revised, by hand, so the stamp
 * lets the row past the proof check (`./releaseHeldRow.ts`) and reaches this read, never past it.
 *
 * @param deps the injected world, for the live `is_mpim` read
 * @param draft the parked row
 * @param token the token the release reads and posts under — the bot's on a bot row, so a group DM it cannot read fails
 * @returns the refusal, or `undefined` when the row is unstamped or the conversation still reads as a group DM
 */
export async function stampedGroupDmRefusal({
  deps,
  draft,
  token,
}: {
  deps: Pick<SlackWriteDeps, "conversationGroupDm">;
  draft: Pick<ParkedSlackDraft, "channel" | "groupDm" | "id">;
  token: string;
}): Promise<SlackLifecycleError | undefined> {
  if (draft.groupDm !== true || (await deps.conversationGroupDm({ channel: draft.channel, token })) === true) {
    return undefined;
  }
  return SlackLifecycleErrors.draftNotFound({
    reason:
      `${draft.id} is stamped a group DM, but ${draft.channel} does not read as one now, so it owes the ` +
      "first-message proof: re-record it with --media <annotated screenshot>",
  });
}
