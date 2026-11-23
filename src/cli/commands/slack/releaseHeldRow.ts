/**
 * The row a release, a correction or a send-failure journal names, read off the register ({@link heldRowOf}), and the
 * channel steer a release of it owes ({@link steeredRowRefusal}) — the shell around
 * `../../../outbound/slack/draftSteerGate.ts`, asking the journalled `channel-steered-draft` grant for this session only
 * when a steer is unmet. `./releaseRow.ts` runs the steer read as a release resolves its row and again in
 * `rowMovedBeforeSend`, so a steer landing while the gates ran stops the send.
 */
import { hatchOpen } from "../../../hatch/open.js";
import { err, ok } from "../../../lib/result.js";
import { SlackDraftErrors } from "../../../outbound/slack/draftErrors.js";
import { foldSlackDrafts } from "../../../outbound/slack/draftFold.js";
import { parseSlackDraftLog, skippedDraftNote, skippedLinesTouching } from "../../../outbound/slack/draftLog.js";
import { draftProofReleaseRefusal, draftProofVerdict } from "../../../outbound/slack/draftProof.js";
import { type ParkedSlackDraft, type SlackDraftItem, slackDraftById } from "../../../outbound/slack/draftRegister.js";
import { draftAncestorIds, releasedTwinOf } from "../../../outbound/slack/draftSpent.js";
import { channelSteerRefusal, unmetChannelSteer } from "../../../outbound/slack/draftSteerGate.js";
import { findingProofReleaseRefusal, storedFindingProofMissing } from "../../../outbound/slack/findingProof.js";
import { rivalFollowupOf } from "../../../outbound/slack/sharedFindings.js";
import { draftMediaEvidence } from "./draftMediaEvidence.js";
import { type SlackLifecycle, type SlackLifecycleError, SlackLifecycleErrors } from "./lifecycleErrors.js";
import type { SlackWriteDeps } from "./run.js";

/**
 * The held row a release names, with every row folded beside it — refused when a passed-over line may touch it or a
 * row it re-cuts, when it is missing or spent, when another cut of the same message already landed, or when it is a
 * follow-up card whose finding has another card sent or held (`../../../outbound/slack/sharedFindings.ts`), or when
 * it raises a finding, or is a first message in a channel, without its proof (`../../../outbound/slack/draftProof.ts`).
 *
 * @param draftId the row the release names
 * @returns the row and every folded row, or why it cannot be released
 */
export function heldRowOf({
  deps,
  draftId,
  home,
}: {
  deps: Pick<SlackWriteDeps, "readDraftLog">;
  draftId: string;
  home: string;
}): SlackLifecycle<{ row: SlackDraftItem; items: readonly SlackDraftItem[] }> {
  const log = parseSlackDraftLog({ lines: deps.readDraftLog({ home }) });
  // A passed-over line naming this row, or naming none, may be the one that spent it, so it is never sent.
  const unread = skippedDraftNote({ skipped: skippedLinesTouching({ id: draftId, log }) });
  if (unread !== undefined) {
    return err(SlackLifecycleErrors.draftNotFound({ reason: unread }));
  }
  const items = foldSlackDrafts({ events: log.events });
  const found = slackDraftById({ id: draftId, items, mustBeHeld: true });
  if (found.isErr()) {
    return err(SlackLifecycleErrors.draftNotFound({ reason: found.error.message }));
  }
  const twin = releasedTwinOf({ draft: found.value, items });
  if (twin !== undefined) {
    const refused = SlackDraftErrors.releasedTwin({ id: draftId, outcome: twin.outcome!, twinId: twin.id });
    return err(SlackLifecycleErrors.draftNotFound({ reason: refused.message }));
  }
  const rival = rivalFollowupOf({ items, row: found.value });
  if (rival !== undefined) {
    return err(SlackLifecycleErrors.draftNotFound({ reason: rivalCardReason({ draftId, rival, row: found.value }) }));
  }
  // The Queue draws no card for a finding or a first message without its proof, so no release goes round it (Codex
  // r2). Read on every call, the last-moment re-read included: a failed record landing mid-release stops the send.
  const { draft } = found.value;
  const proof = draftProofVerdict({ draft, media: draftMediaEvidence({ home, media: draft.media }) });
  if (proof.missing.length > 0) {
    return err(
      SlackLifecycleErrors.draftNotFound({ reason: draftProofReleaseRefusal({ id: draftId, verdict: proof }) }),
    );
  }
  // A passed-over line naming a row it re-cuts may be the steer that row carried, so it is never sent either. The row's own `recuts` are read as well as the walk, which stops at an ancestor the fold does not hold.
  const ancestors = new Set(draftAncestorIds({ item: found.value, items }));
  const { recuts } = found.value.draft;
  if (recuts !== undefined) {
    for (const id of recuts) {
      ancestors.add(id);
    }
  }
  const lineageUnread = skippedDraftNote({
    skipped: log.skipped.filter((line) => line.id !== undefined && ancestors.has(line.id)),
  });
  if (lineageUnread !== undefined) {
    return err(SlackLifecycleErrors.draftNotFound({ reason: lineageUnread }));
  }
  return ok({ items, row: found.value });
}

/**
 * The finding proof refusal a release owes for the form it will actually send. A `--form` typed at release is not in
 * the digest, so it can declare a possible problem the stored form did not; the row's own media, impact and approved
 * payload are held to it exactly as the stored form was.
 *
 * @param draft the held row
 * @param formJson the form the release prepares, `--form` when typed
 * @returns the refusal, or `undefined` when the form raises no finding or the row brings every piece
 */
export function releaseFormProofRefusal({
  draft,
  formJson,
}: {
  draft: ParkedSlackDraft;
  formJson: string;
}): SlackLifecycleError | undefined {
  const missing = storedFindingProofMissing({ draft: { ...draft, form: formJson } });
  if (missing.length === 0) {
    return undefined;
  }
  return SlackLifecycleErrors.draftNotFound({ reason: findingProofReleaseRefusal({ id: draft.id, missing }) });
}

/**
 * Why a follow-up card may not go while another card for its finding is sent or held, naming the drop that clears it.
 *
 * @param draftId the row the release names
 * @param row that row, carrying the finding it follows up
 * @param rival the other card naming the same finding
 * @returns the refusal reason
 */
function rivalCardReason({
  draftId,
  rival,
  row,
}: {
  draftId: string;
  rival: SlackDraftItem;
  row: SlackDraftItem;
}): string {
  const finding = row.draft.followupOf!;
  if (rival.state === "released") {
    return (
      `${draftId} follows up ${finding}, whose one follow-up card ${rival.id} already went; ` +
      `drop it with \`slopweaver slack draft drop ${draftId} --note "superseded by ${rival.id}"\``
    );
  }
  return (
    `${draftId} follows up ${finding}, and ${rival.id} is a second card for it, held too; one card per finding, so ` +
    `drop the one you do not want (\`slopweaver slack draft drop <id> --note "one card per finding"\`) and release the other`
  );
}

/**
 * The refusal a release of this row owes for an unmet channel steer on its lineage, or `undefined` when it may go.
 *
 * @param deps the injected world, for the environment the grant's session is read from
 * @param home the state home the grant journal lives under
 * @param row the row about to be released
 * @param items every folded row, for its re-cut lineage
 * @returns the refusal, or `undefined`
 */
export function steeredRowRefusal({
  deps,
  home,
  items,
  row,
}: {
  deps: Pick<SlackWriteDeps, "doorEnv">;
  home: string;
  items: readonly SlackDraftItem[];
  row: SlackDraftItem;
}): SlackLifecycleError | undefined {
  if (unmetChannelSteer({ item: row, items }) === undefined) {
    return undefined;
  }
  const open = hatchOpen({ env: deps.doorEnv(), home, id: "channel-steered-draft", nowIso: new Date().toISOString() });
  const lines = channelSteerRefusal({ hatchOpen: open, item: row, items });
  if (lines.length === 0) {
    return undefined;
  }
  return SlackLifecycleErrors.upstreamRefused({ reasons: [...lines, "Nothing was sent."] });
}
