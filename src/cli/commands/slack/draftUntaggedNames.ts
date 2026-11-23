/**
 * The effectful edge of the untagged-name hold (`../../../outbound/slack/untaggedNames.ts`): member bronze read once,
 * the author and a 1:1 DM's other member asked of the recording's own memoised reads, and the pure check run over the
 * one message a draft would park.
 */
import { slackRoster } from "../../../corpus/members/slackPeople.js";
import { logger } from "../../../lib/logger.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";
import type { SlackDripMessagePayload } from "../../../outbound/slack/types.js";
import { taggedIdsOf, untaggedNameFindings, untaggedNameRefusal } from "../../../outbound/slack/untaggedNames.js";
import { voiceProseOf } from "./asMeForm.js";
import { NOTHING_PARKED } from "./draftMedia.js";
import type { ConversationAnswer, SelfIdentity } from "./draftRecordReads.js";
import type { SlackDraftDeps } from "./draftRun.js";

/**
 * Why a message as them cannot park because its prose names a colleague it does not tag — nothing when it may.
 *
 * @param deps the injected world, for member bronze
 * @param home the state home member bronze lives under
 * @param message the one message the draft would park: its validated form's authored prose is read, its wire text's
 *   tags, and every mention the form resolved — the tags the row records, read beside the wire text so a form whose
 *   fallback text drops a tag still counts it
 * @param readInfo `conversations.info`, memoised — a 1:1 DM's other member is never held
 * @param readSelf `auth.test`, memoised — the author is never held
 * @returns the refusal lines, empty when the row may park
 */
export async function untaggedNameHold({
  deps,
  home,
  message,
  readInfo,
  readSelf,
}: {
  deps: Pick<SlackDraftDeps, "loadMembers">;
  home: string;
  message: {
    readonly payload: SlackDripMessagePayload;
    readonly prepared: { readonly plan: { readonly artifact: AsMeArtifact }; readonly resolution: MentionResolution };
  };
  readInfo: () => Promise<ConversationAnswer>;
  readSelf: () => Promise<SelfIdentity>;
}): Promise<readonly string[]> {
  const { payload } = message;
  const { resolution } = message.prepared;
  const artifact = message.prepared.plan.artifact;
  const members = deps.loadMembers({ home });
  for (const warning of members.warnings) {
    logger.warn({ msg: warning });
  }
  const tagged = new Set(taggedIdsOf({ text: payload.text }));
  for (const target of resolution.resolved.values()) {
    tagged.add(target.slackId);
  }
  const found = untaggedNameFindings({
    exempt: new Set(),
    people: slackRoster({ rows: members.rows }),
    prose: voiceProseOf({ artifact }),
    tagged,
  });
  if (found.length === 0) {
    return [];
  }
  // Only a message that names somebody untagged asks who is sending and who a DM is with, so a clean one reads
  // nothing more than it did.
  const exempt = new Set<string>();
  const self = (await readSelf()).userId;
  if (self !== undefined) {
    exempt.add(self);
  }
  const counterpart = (await readInfo()).user;
  if (counterpart !== undefined) {
    exempt.add(counterpart);
  }
  const refusal = untaggedNameRefusal({ findings: found.filter((finding) => !exempt.has(finding.nativeId)) });
  if (refusal.length === 0) {
    return [];
  }
  return [...refusal, NOTHING_PARKED];
}
