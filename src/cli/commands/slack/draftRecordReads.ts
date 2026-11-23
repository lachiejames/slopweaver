/**
 * The two Slack reads `slack draft record` asks more than once — `conversations.info` and `auth.test` — each memoised
 * so a gate asking and the recorder asking cost one call between them. Split out of `./draftRecordRun.ts` along
 * that seam: these hold no decision, only the at-most-once contract every caller there relies on.
 */
import type { ConversationSurface } from "../../../outbound/slack/types.js";
import type { SlackDraftDeps } from "./draftRun.js";

/**
 * What one `conversations.info` answers: the surface the gate reads, the name the console prints, a 1:1 DM's
 * other member, and whether it is a group DM, which the first-message proof bar reads off the row.
 */
export type ConversationAnswer = {
  readonly surface: ConversationSurface | undefined;
  readonly name: string | undefined;
  readonly user?: string | undefined;
  readonly groupDm?: true | undefined;
};

/**
 * A `conversations.info` read that happens at most once, however many of its two halves are asked for.
 *
 * The public-channel gate wants the SURFACE and the register wants the NAME, and both come off the same
 * response — so the gate asking and the recorder asking cost one call between them.
 *
 * @param channel the conversation both answers are about
 * @param deps the injected world, for the read itself
 * @param token the user token the read goes out under
 * @returns a reader answering the memoised response
 */
export function conversationInfoOnce({
  channel,
  deps,
  token,
}: {
  channel: string;
  deps: Pick<SlackDraftDeps, "conversationInfo">;
  token: string;
}): () => Promise<ConversationAnswer> {
  let info: ConversationAnswer | undefined;
  return async (): Promise<ConversationAnswer> => {
    if (info !== undefined) {
      return info;
    }
    const read = await deps.conversationInfo({ channel, token });
    info = read;
    return read;
  };
}

/** What `auth.test` answers: the user the digest binds, and the workspace a thread row's permalink is built on. */
export type SelfIdentity = Awaited<ReturnType<SlackDraftDeps["whoAmI"]>>;

/**
 * An `auth.test` read that happens at most once, however many times the recording asks who is sending — so the
 * bot-DM hold asking before the media is stored and the recorder asking at compose cost one call.
 *
 * @param deps the injected world, for the read itself
 * @param token the user token the read goes out under
 * @returns a reader answering the memoised response
 */
export function whoAmIOnce({
  deps,
  token,
}: {
  deps: Pick<SlackDraftDeps, "whoAmI">;
  token: string;
}): () => Promise<SelfIdentity> {
  let self: SelfIdentity | undefined;
  return async (): Promise<SelfIdentity> => {
    if (self !== undefined) {
      return self;
    }
    const read = await deps.whoAmI({ token });
    self = read;
    return read;
  };
}
