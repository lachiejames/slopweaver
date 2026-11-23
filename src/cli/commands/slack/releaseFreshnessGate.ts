/**
 * The pre-send re-read both release lanes run once their approval is proven to name these exact bytes and before
 * anything posts: read where the draft is about to land, and stop if a person changed it since the draft's own read.
 * The judgement is `../../../outbound/slack/releaseFreshness.ts`'s; this module is the one live read it needs.
 *
 * Fail closed: a conversation or a posting identity that cannot be read is a release that does not send, because the
 * whole check is that a send never lands somewhere nobody has looked since the words were written.
 */
import { errorMessage } from "../../../lib/errorMessage.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { ParkedSlackDraft } from "../../../outbound/slack/draftRegister.js";
import type { PostingIdentity } from "../../../outbound/slack/placement.js";
import { answersSinceRecording, judgePriorAsk } from "../../../outbound/slack/priorAsk.js";
import {
  conversationChanges,
  evaluateReleaseFreshness,
  type ReleaseFreshnessError,
  ReleaseFreshnessErrors,
  releaseReadFrom,
  releaseWatermark,
} from "../../../outbound/slack/releaseFreshness.js";
import type { SlackWriteDeps } from "./run.js";

/**
 * Re-read the draft's destination and decide whether the release may send.
 *
 * @param deps the injected world, for the conversation read and `auth.test` of the posting token
 * @param draft the parked row being released
 * @param cleared the set `--thread-moved-cleared` named, or `undefined` when it was not passed
 * @param home the state home whose private-terms policy judges the DM a person-addressed row opens first
 * @param token the token the release posts under — the same identity reads what it is about to post into
 * @returns the cleared set to journal on the released event (empty when nothing moved), or why it may not send
 */
export async function releaseFreshness({
  deps,
  draft,
  cleared,
  home,
  token,
}: {
  deps: Pick<SlackWriteDeps, "readReleaseConversation" | "whoAmI">;
  draft: ParkedSlackDraft;
  cleared: readonly string[] | undefined;
  home: string;
  token: string;
}): Promise<Result<readonly string[], ReleaseFreshnessError>> {
  const watermark = releaseWatermark({ draft });
  if (watermark.isErr()) {
    return err(watermark.error);
  }
  // A token whose own `auth.test` fails is one the send is about to use, so it refuses here, before anything is read.
  let self: PostingIdentity;
  try {
    self = await deps.whoAmI({ token });
  } catch (error) {
    return err(
      ReleaseFreshnessErrors.unreadable({ cause: `auth.test: ${errorMessage({ error })}`, draftId: draft.id }),
    );
  }
  const read = await deps.readReleaseConversation({
    channel: draft.channel,
    home,
    oldest: releaseReadFrom({ watermark: watermark.value }),
    threadTs: draft.threadTs,
    token,
  });
  if (read.isErr()) {
    return err(ReleaseFreshnessErrors.unreadable({ cause: read.error, draftId: draft.id }));
  }
  const changes = conversationChanges({ rawMessages: read.value, self, watermark: watermark.value });
  return evaluateReleaseFreshness({ changes, cleared, draftId: draft.id });
}

/**
 * Re-read the earlier ask a re-ask row names and stop the release when somebody answered it after the recording's
 * read. Only a
 * row that declared a prior is read; a row that declared none, or predates the declaration, passes untouched.
 *
 * Run by the approved-words and bot lanes after {@link releaseFreshness}, never by `--thanks-instead`, whose
 * thanks re-asks nothing.
 *
 * @param deps the injected world, for the earlier ask's read and `auth.test` of the posting token
 * @param draft the parked row being released
 * @param token the token the release posts under, which reads the earlier ask as the recording did
 * @returns `true` when the release may send, or why it may not
 */
export async function releasePriorAsk({
  deps,
  draft,
  token,
}: {
  deps: Pick<SlackWriteDeps, "readPriorAsk" | "whoAmI">;
  draft: ParkedSlackDraft;
  token: string;
}): Promise<Result<true, ReleaseFreshnessError>> {
  const { priorAsk } = draft;
  if (priorAsk?.kind !== "prior") {
    return ok(true);
  }
  const unreadable = ({ cause }: { cause: string }): Result<true, ReleaseFreshnessError> =>
    err(
      ReleaseFreshnessErrors.unreadable({
        cause: `the earlier ask ${priorAsk.permalink}: ${cause}`,
        draftId: draft.id,
      }),
    );
  let self: PostingIdentity;
  try {
    self = await deps.whoAmI({ token });
  } catch (error) {
    return unreadable({ cause: `auth.test: ${errorMessage({ error })}` });
  }
  if (self.userId === undefined) {
    return unreadable({ cause: "auth.test named no user, so nothing can say which replies are somebody else's" });
  }
  const read = await deps.readPriorAsk({ permalink: priorAsk.permalink, token });
  if (read.isErr()) {
    return unreadable({ cause: read.error.message });
  }
  const judgement = judgePriorAsk({ read: read.value, selfUserId: self.userId });
  if (judgement.kind !== "read") {
    return unreadable({ cause: `it no longer reads as ours (${judgement.kind})` });
  }
  const since = answersSinceRecording({ judgement, priorAsk });
  if (since.length > 0) {
    return err(
      ReleaseFreshnessErrors.priorAnswered({
        answeredTs: since.map((answer) => answer.ts),
        draftId: draft.id,
        permalink: priorAsk.permalink,
      }),
    );
  }
  return ok(true);
}
