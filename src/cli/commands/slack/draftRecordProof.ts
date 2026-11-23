/**
 * The proof bar at every verb that makes a row read as it does: `slack draft record` for both identities
 * (`./draftRecordRun.ts`, `./draftRecordBotRun.ts`), and `slack draft revise` and `restore` (`./draftReviseRun.ts`). A
 * row that raises a finding parks only with a file, a link and its impact in people, and a first message in a channel
 * only with an annotated, unobstructed screenshot and a link, judged off the rendered message once its receipts are.
 * What the argv alone decides is judged before any identity read ({@link recordingProof}), a first channel message
 * after one memoised conversation read that says whether it is a group DM ({@link firstMessageGroupDm}); a
 * screenshot's annotation, which only its admitted bytes' records can say, is judged after admission and before a
 * byte is stored (`./draftMedia.ts` `admittedFirstMessageProof`). `slack draft list --json` says on stderr which rows the Queue
 * will not draw. The rules are `../../../outbound/slack/findingProof.ts` and `../../../outbound/slack/firstMessageProof.ts`;
 * this only names the row's inputs. No hatch is read: there is none.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { DraftWords } from "../../../outbound/slack/draftComparison.js";
import { draftProofRefusal, draftProofVerdict } from "../../../outbound/slack/draftProof.js";
import type { ParkedDraftKind, ParkedSlackDraft, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { findingProofRefusal, missingFindingProof } from "../../../outbound/slack/findingProof.js";
import {
  type DraftMediaEvidence,
  firstMessageProofRefusal,
  firstMessageProofVerdict,
  isFirstChannelMessage,
} from "../../../outbound/slack/firstMessageProof.js";
import type { DraftRecordOptions } from "./draftCore.js";
import { NOTHING_PARKED } from "./draftMedia.js";

/** Where a recording lands and what it says, as the first-message rule reads a row. */
export type RecordingDestination = Pick<ParkedSlackDraft, "act" | "channel" | "groupDm" | "shape" | "threadTs"> & {
  readonly payload: unknown;
};

/**
 * The row a recording would park, as the first-message rule reads it: a recording with no thread parks top-level.
 *
 * @param groupDm whether the conversation read answered `is_mpim`, which the row will be stamped with — `undefined`
 *   where it did not say so, and the rule applies
 * @param options the parsed record: its act and where it goes
 * @param payload the rendered message
 * @returns the destination the rule judges
 */
export function recordingDestination({
  groupDm,
  options,
  payload,
}: {
  groupDm: true | undefined;
  options: Pick<DraftRecordOptions, "act" | "channel" | "threadTs">;
  payload: unknown;
}): RecordingDestination {
  const { act, channel, threadTs } = options;
  const shape = threadTs === undefined ? "top-level" : "thread";
  return { act, channel, ...(groupDm === true ? { groupDm } : {}), payload, shape, threadTs };
}

/**
 * The group-DM stamp a first channel message needs before its proof can be judged, read only for one: any other row
 * owes no first-message proof whatever the conversation is, so it costs no `conversations.info` call.
 *
 * @param options the parsed record: its act and where it goes
 * @param payload the rendered message
 * @param readInfo `conversations.info`, memoised
 * @returns `true` when the read answered `is_mpim`, else `undefined`
 */
export async function firstMessageGroupDm({
  options,
  payload,
  readInfo,
}: {
  options: Pick<DraftRecordOptions, "act" | "channel" | "threadTs">;
  payload: unknown;
  readInfo: () => Promise<{ readonly groupDm?: true | undefined }>;
}): Promise<true | undefined> {
  if (!isFirstChannelMessage({ draft: recordingDestination({ groupDm: undefined, options, payload }) })) {
    return undefined;
  }
  return (await readInfo()).groupDm;
}

/**
 * Where a recording lands, stamped off its conversation read when that read is owed ({@link firstMessageGroupDm}).
 *
 * @param options the parsed record: its act and where it goes
 * @param payload the rendered message
 * @param readInfo `conversations.info`, memoised — asked only for a first channel message
 * @returns the destination the media admission judges
 */
export async function readRecordingDestination({
  options,
  payload,
  readInfo,
}: {
  options: Pick<DraftRecordOptions, "act" | "channel" | "threadTs">;
  payload: unknown;
  readInfo: () => Promise<{ readonly groupDm?: true | undefined }>;
}): Promise<RecordingDestination> {
  const groupDm = await firstMessageGroupDm({ options, payload, readInfo });
  return recordingDestination({ groupDm, options, payload });
}

/**
 * Nothing when the row may park on what its argv shows, or every missing piece named in one refusal. A first message's
 * screenshot is counted here only as a file named: whether it IS a picture, and whether its record vouches for its
 * box, wait for the bytes (`./draftMedia.ts` `admittedFirstMessageProof`).
 *
 * @param form the `--form` JSON as recorded, whose `problem` declaration is read
 * @param groupDm whether the conversation read answered `is_mpim` — `undefined` where it did not, and the rule applies
 * @param impactInForm whether the form carries its own counted impact — the bot `finding` card's `blastRadius`
 * @param kind the row's effective kind, as the row will store it
 * @param options the parsed record: its act, its destination, its impact declaration and its files
 * @param payload the rendered message, which the link and the first line are read off
 * @returns ok, or the refusal lines
 */
export function recordingProof({
  form,
  groupDm,
  impactInForm,
  kind,
  options,
  payload,
}: {
  form: string;
  groupDm: true | undefined;
  impactInForm: boolean;
  kind: ParkedDraftKind | undefined;
  options: DraftRecordOptions;
  payload: unknown;
}): Result<void> {
  const finding = missingFindingProof({
    act: options.act,
    form,
    impact: options.impact,
    impactInForm,
    kind,
    media: options.media.length,
    payload,
  });
  const destination = recordingDestination({ groupDm, options, payload });
  const first = firstMessageProofVerdict({ draft: destination, media: [] }).missing;
  const firstNow = options.media.length === 0 ? first : first.filter((piece) => piece === "link");
  if (finding.length === 0 && firstNow.length === 0) {
    return ok(undefined);
  }
  return err([
    ...findingProofRefusal({ missing: finding }),
    ...firstMessageProofRefusal({ missing: firstNow }),
    NOTHING_PARKED,
  ]);
}

/**
 * Why a revision may not be recorded because the row would then lack its proof — empty when it may. A rewrite and a
 * restore make a row read as it does as much as the record: one dropping a finding's link or its first-line count, or
 * a first message's link, would otherwise park it unproved.
 *
 * @param item the held row being revised
 * @param media what each attachment under it is, which a revision keeps
 * @param words the words the revision would make it read as
 * @returns the refusal lines, empty when the revised row brings every piece
 */
export function revisionProofRefusal({
  item,
  media,
  words,
}: {
  item: SlackDraftItem;
  media: readonly DraftMediaEvidence[];
  words: Pick<DraftWords, "form" | "payload">;
}): readonly string[] {
  const { form, payload } = words;
  const verdict = draftProofVerdict({ draft: { ...item.draft, form, payload }, media });
  if (verdict.missing.length === 0) {
    return [];
  }
  const recut = `nothing was recorded: a revision cannot bring a file or an impact, so re-cut ${item.id} with its proof`;
  return [...draftProofRefusal({ verdict }), `${recut}: slack draft record … --supersedes ${item.id}`];
}

/**
 * One stderr line per listed row the Queue will not draw for want of its proof, so `--json` stays parseable and such a
 * row is never silently absent from what they are shown.
 *
 * @param items the listed rows, each carrying `proofMissing` when it lacks a finding's or a first message's proof
 * @returns the warning lines, in list order
 */
export function proofMissingWarnings({
  items,
}: {
  items: readonly { readonly id: string; readonly proofMissing?: readonly string[] | undefined }[];
}): readonly string[] {
  return items.flatMap(({ id, proofMissing }) =>
    proofMissing === undefined ? [] : [`slack draft list: ${id} sent back unseen, no ${proofMissing.join(", ")}`],
  );
}
