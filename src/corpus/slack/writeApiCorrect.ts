/**
 * `chat.update` for `slack correct` — a message's own stored content sent back with one claim struck and a
 * Correction line added (`../../outbound/slack/claimCorrection.ts`). Split out of `./writeApi.ts` under the file-size
 * cap; it is the same seam. `correctMethods` is exported from here only and `./writeApi.ts` imports it; this module
 * imports nothing from that one.
 *
 * It goes through `apiCall` rather than the typed `chat.update` binding, and that is the honest shape rather than a
 * shortcut: the blocks are the ones Slack STORED, read back as `unknown`, and the typed binding would need a cast
 * asserting a block union nobody checked. `apiCall` is the method every typed binding itself calls, so the guarded
 * client's dead-Datadog-host refusal (`./guardedWebClient.ts`) sees these bytes exactly as it sees every other write.
 */
import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { CorrectedMessage } from "../../outbound/slack/claimCorrection.js";
import type { GuardedWebClient } from "./guardedWebClient.js";
import type { PostedMessage, SlackWriteTransport } from "./writeTransport.js";

/**
 * The correction half of the write transport, spread into `./writeApi.ts`'s wiring table the way
 * `./writeApiConversations.ts`'s methods are.
 *
 * @param client the guarded repeatable-call write client
 * @param scopeId the shared-429-block key for this token
 * @returns `correctMessage`, bound to this client
 */
export function correctMethods({
  client,
  scopeId,
}: {
  client: GuardedWebClient;
  scopeId: string;
}): Pick<SlackWriteTransport, "correctMessage"> {
  return {
    correctMessage: ({ posted, corrected, fileIds }) =>
      correctMessageCall({ client, corrected, fileIds, posted, scopeId }),
  };
}

/**
 * The `chat.update` arguments for one correction: the message addressed by its own `ts`, its stored body with the
 * claim struck, and only the optional parts the message actually had. An attached file is re-sent by id, because an
 * update carrying no `file_ids` detaches every file the message held.
 *
 * @param posted the message being corrected
 * @param corrected the body `correctClaim` composed
 * @param fileIds the ids already attached
 * @returns the argument object `chat.update` takes
 */
export function correctionUpdateArgs({
  posted,
  corrected,
  fileIds,
}: {
  posted: PostedMessage;
  corrected: CorrectedMessage;
  fileIds: readonly string[];
}): Record<string, unknown> {
  const { attachments, blocks, metadata, text } = corrected;
  return {
    channel: posted.channel,
    text,
    ts: posted.ts,
    ...(blocks === undefined ? {} : { blocks: [...blocks] }),
    ...(attachments === undefined ? {} : { attachments: [...attachments] }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(fileIds.length > 0 ? { file_ids: [...fileIds] } : {}),
  };
}

/**
 * Send one corrected message back over itself.
 *
 * @param client the guarded repeatable-call write client
 * @param posted the message being corrected
 * @param corrected the body `correctClaim` composed — whichever of blocks and attachments the message had
 * @param fileIds the ids already attached, re-sent so the edit does not detach them
 * @param scopeId the shared-429-block key for this token
 * @returns nothing; throws on a failed write, like every call on this seam
 */
async function correctMessageCall({
  client,
  posted,
  corrected,
  fileIds,
  scopeId,
}: {
  client: GuardedWebClient;
  posted: PostedMessage;
  corrected: CorrectedMessage;
  fileIds: readonly string[];
  scopeId: string;
}): Promise<void> {
  orThrow({
    result: await safeProviderCall({
      execute: () => client.apiCall("chat.update", correctionUpdateArgs({ corrected, fileIds, posted })),
      operation: "slack.chat.update.correction",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
}
