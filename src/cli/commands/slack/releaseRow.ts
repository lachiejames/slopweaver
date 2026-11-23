/**
 * The half of a parked draft's release that both identities share: find the row and check everything decided off
 * it alone ({@link resolveDraftRow}), recompute their approval over what would post now
 * ({@link offeredDigestRefusal}), serve only the verified attachment bytes ({@link servedMedia}), and mark the row
 * released once it landed ({@link markDraftReleased}). The as-me order is `./releaseRun.ts`, the bot order
 * `./releaseBotRun.ts`.
 */
import type { VerifiedDraftMedia } from "../../../admit/slackDraftMediaStore.js";
import type { SlackUpload } from "../../../corpus/slack/writeTransport.js";
import { logger } from "../../../lib/logger.js";
import { err, ok } from "../../../lib/result.js";
import { pickOwed } from "../../../outbound/slack/draftComparison.js";
import { SlackDraftErrors } from "../../../outbound/slack/draftErrors.js";
import {
  type ParkedDraftPayload,
  type ParkedSlackDraft,
  type ParkedSlackDraftMedia,
  parkedDraftDigest,
} from "../../../outbound/slack/draftRegister.js";
import { whySaysThreadReply } from "../../../outbound/slack/draftThreadWhy.js";
import { asMeChannelFinding, undeclaredKindNote } from "../../../outbound/slack/findingIdentity.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type SlackDraftReleaseOptions, STDIN_SENTINEL } from "./coreTypes.js";
import { parkedMentions } from "./draftCompose.js";
import { draftReleaseCommand } from "./draftReport.js";
import { type SlackLifecycle, type SlackLifecycleError, SlackLifecycleErrors } from "./lifecycleErrors.js";
import { releaseHeldCuts, spendHeldCuts } from "./releaseCuts.js";
import { heldRowOf, releaseFormProofRefusal, steeredRowRefusal } from "./releaseHeldRow.js";
import type { SlackWriteDeps } from "./run.js";

/**
 * The key a stored attachment rides the drip under. Not a path anything opens — the scoped `readMedia`
 * answers it from memory — but shaped like one so the dry run's `basename` prints the recorded name, and
 * numbered so the same bytes attached twice stay two entries.
 *
 * @returns `draft-media/<n>/<sha256>/<name>`
 */
function draftMediaKey({ index, record }: { index: number; record: ParkedSlackDraftMedia }): string {
  return `draft-media/${String(index + 1)}/${record.sha256}/${record.name}`;
}

/**
 * A row resolved for release under either identity: the row, the form it re-prepares, every other held cut of
 * its message, and each stored attachment's verified bytes keyed as the send names them, in attach order.
 */
export interface ResolvedDraftRow {
  readonly draft: ParkedSlackDraft;
  readonly formJson: string;
  /** Every other held cut of this message, which the release spends once it lands (`draftSpent.ts`). */
  readonly heldCuts: readonly string[];
  readonly media: ReadonlyMap<string, VerifiedDraftMedia>;
}

/**
 * Find the row and check everything decided off the row alone, before any live read: no pick between two drafts is
 * still owed on it, the approval names it, the
 * identity typed is the one it was recorded under, an as-me row is not a channel finding the bot should carry, the
 * verb sends it where it was recorded to go, its form is known, and its stored attachments are intact.
 *
 * @param deps the injected world, for the register and the media store
 * @param options the parsed release
 * @returns the row, its form and its verified media, or the first refusal
 */
export function resolveDraftRow({
  deps,
  options,
}: {
  deps: Pick<SlackWriteDeps, "doorEnv" | "readDraftLog" | "readDraftMedia">;
  options: SlackDraftReleaseOptions;
}): SlackLifecycle<ResolvedDraftRow> {
  const { approve, draftId } = options.release;
  const held = heldRowOf({ deps, draftId, home: options.home });
  if (held.isErr()) {
    return err(held.error);
  }
  const { items, row } = held.value;
  const { draft } = row;
  const steered = steeredRowRefusal({ deps, home: options.home, items, row });
  if (steered !== undefined) {
    return err(steered);
  }
  if (pickOwed({ item: row })) {
    return err(SlackLifecycleErrors.draftPickOwed({ draftId, pending: row.comparison?.state === "pending" }));
  }
  if (approve !== draft.digest) {
    return err(SlackLifecycleErrors.draftApprovalMismatch({ approve, digest: draft.digest, draftId }));
  }
  const identity = releaseIdentityRefusal({ actor: options.actor, draft });
  if (identity !== undefined) {
    return err(identity);
  }
  const placement = releasePlacementRefusal({ draft, verb: options.verb });
  if (placement !== undefined) {
    return err(placement);
  }
  const formJson = releaseFormOf({ draft, formSource: options.formSource });
  if (formJson.isErr()) {
    return err(formJson.error);
  }
  const unproved = releaseFormProofRefusal({ draft, formJson: formJson.value });
  if (unproved !== undefined) {
    return err(unproved);
  }
  // Verified BEFORE the surface read and before anything is prepared: a blob that is gone or changed costs no
  // live call, and nothing downstream ever reopens the store.
  const { media: recorded = [] } = draft;
  const verified = deps.readDraftMedia({ home: options.home, media: recorded });
  if (verified.isErr()) {
    return err(SlackLifecycleErrors.draftMediaUnavailable({ draftId, reason: verified.error.message }));
  }
  const media = new Map(verified.value.map((entry, index) => [draftMediaKey({ index, record: entry.record }), entry]));
  const heldCuts = releaseHeldCuts({ draft: row, items });
  return ok({ draft, formJson: formJson.value, heldCuts, media });
}

/**
 * Re-read the row at the last moment before the send, after every live gate: a compare and a pick need no lock a
 * release holds, so either may land while the gates run, and a release still carrying the words it resolved would send
 * A under a row that now says B. A release runs it twice: once after its own gates, and again as
 * `sendPreparedDrip`'s `lastCheck`, after the send-only gates that await live reads too. The
 * send call itself is the window left, stated in `docs/console/draft-comparison.md` § limits.
 *
 * A channel steer appended while the gates ran is read here too (`./releaseHeldRow.ts`): their words naming another
 * channel for the row, landing mid-release, stop it exactly as they would have before it started. A drip's messages
 * are one send to this check, never re-read between them: a stop after the first leaves half of it public.
 *
 * @param draft the row as the release resolved it, whose digest their yes named
 * @returns the refusal when the row moved underneath the release, else `undefined`
 */
export function rowMovedBeforeSend({
  deps,
  draft,
  home,
}: {
  deps: Pick<SlackWriteDeps, "doorEnv" | "readDraftLog">;
  draft: Pick<ParkedSlackDraft, "digest" | "id">;
  home: string;
}): SlackLifecycleError | undefined {
  const held = heldRowOf({ deps, draftId: draft.id, home });
  if (held.isErr()) {
    return held.error;
  }
  const { items, row } = held.value;
  const steered = steeredRowRefusal({ deps, home, items, row });
  if (steered !== undefined) {
    return steered;
  }
  if (pickOwed({ item: row })) {
    return SlackLifecycleErrors.draftPickOwed({ draftId: draft.id, pending: row.comparison?.state === "pending" });
  }
  if (row.draft.digest !== draft.digest) {
    return SlackLifecycleErrors.draftApprovalMismatch({
      approve: draft.digest,
      digest: row.draft.digest,
      draftId: draft.id,
    });
  }
  return undefined;
}

/**
 * Whether the identity typed may send this row — decided off the ROW, before any live read.
 *
 * Two refusals. The identity typed must be the one the row was recorded under: the digest binds that author, so
 * the other could only ever fail as drift, and naming it here says which command sends it. And an as-me row that
 * is a finding at the top level of a channel, with no recorded reason the bot cannot post there, is re-recorded as
 * the bot's post rather than released under their name.
 *
 * @param actor the identity the release was typed with
 * @param draft the parked row
 * @returns the refusal, or `undefined` when the identity may send it
 */
export function releaseIdentityRefusal({
  actor,
  draft,
}: {
  actor: SlackDraftReleaseOptions["actor"];
  draft: ParkedSlackDraft;
}): SlackLifecycleError | undefined {
  const recorded = draft.actor === "bot" ? "bot" : "me";
  if (actor !== recorded) {
    return SlackLifecycleErrors.draftActorMismatch({
      command: draftReleaseCommand({ item: { draft, id: draft.id } }),
      draftId: draft.id,
      recorded,
    });
  }
  if (!asMeChannelFinding({ draft })) {
    return undefined;
  }
  return SlackLifecycleErrors.draftFindingIdentity({
    draftId: draft.id,
    reasons: [
      `${undeclaredKindNote({ draft })}Owner rule: a finding shared at the top level of a channel after they approve the card posts as ` +
        "the bot — they did not find it and has not verified it. As them only where the bot cannot post, and this " +
        "row records no such reason. Nothing was sent.",
      reRecordAsBotLine({ draft }),
    ],
  });
}

/**
 * The correction every as-me channel-finding refusal ends on: re-record the row as the bot's post, superseding it,
 * so the as-me row is dropped in the same act the bot's cut parks. A bot release would not spend it on its own:
 * a held cut is matched on its author (`../../../outbound/slack/draftSpent.ts`).
 *
 * @param draft the parked row the refusal names
 * @returns the one command that re-records and drops it
 */
export function reRecordAsBotLine({ draft }: { draft: Pick<ParkedSlackDraft, "channel" | "id"> }): string {
  return (
    "Re-record it as the bot's post, which drops this row as it parks: `slopweaver slack draft record --as bot " +
    `--channel ${draft.channel} --form - --why "<…>" --media a,b,c --supersedes ${draft.id}\` with a \`finding\` form.`
  );
}

/**
 * Whether the verb typed can send this row where it was recorded to go — decided off the ROW, before any live
 * read, so a refusal costs nothing.
 *
 * Two drafts whose why said THREAD REPLY were released by `slack post --draft` and landed top-level in a channel under their
 * name: `slack post --draft` refuses a draft
 * whose record names a thread or whose why says thread reply, routing it through `slack reply`. So a thread row
 * sends only by `reply`, a top-level row only by `post`, and a top-level row whose why says thread reply sends
 * by neither: it is re-recorded into its thread.
 *
 * @param draft the parked row
 * @param verb the verb the release was typed with
 * @returns the refusal, or `undefined` when the verb sends the row where it was recorded to go
 */
export function releasePlacementRefusal({
  draft,
  verb,
}: {
  draft: ParkedSlackDraft;
  verb: SlackDraftReleaseOptions["verb"];
}): SlackLifecycleError | undefined {
  if (draft.shape === "top-level" && whySaysThreadReply({ why: draft.why })) {
    return SlackLifecycleErrors.draftWhySaysThread({ draftId: draft.id });
  }
  const wanted = draft.shape === "thread" ? "reply" : "post";
  if (verb === wanted) {
    return undefined;
  }
  return SlackLifecycleErrors.draftVerbMismatch({
    command: draftReleaseCommand({ item: { draft, id: draft.id } }),
    draftId: draft.id,
    shape: draft.shape,
  });
}

/**
 * The form a release re-prepares: `--form` when typed, else the row's own.
 *
 * A row holding the stdin sentinel was recorded before the recorder kept the bytes it read, so its words
 * cannot be re-prepared from the row alone — the refusal says which flag supplies them, and the digest check
 * after preparation still holds any supplied form to exactly the bytes they approved.
 *
 * @param draft the parked row
 * @param formSource the `--form` value as typed, if any
 * @returns the form to prepare, or the refusal naming `--form`
 */
export function releaseFormOf({
  draft,
  formSource,
}: {
  draft: ParkedSlackDraft;
  formSource: string | undefined;
}): SlackLifecycle<string> {
  if (formSource !== undefined) {
    return ok(formSource);
  }
  if (draft.form === STDIN_SENTINEL) {
    return err(SlackLifecycleErrors.draftFormRequired({ draftId: draft.id }));
  }
  return ok(draft.form);
}

/**
 * Refuse a re-rendered message whose bytes, author, mentions, media or thread are not the ones they approved — the
 * digest recomputed over what the send would post now, under the identity `auth.test` names for `token`.
 *
 * @param deps the injected world, for `auth.test`
 * @param draft the parked row
 * @param media the attachment entries the store VERIFIED
 * @param payload the exact bytes the send would post now
 * @param resolution every mention the re-rendered message named, resolved now
 * @param threadTs the thread the send will actually land in, absent for a top-level post
 * @param token the token the release will post under
 * @returns the refusal, or empty when the send is exactly the approved message
 */
export async function offeredDigestRefusal({
  deps,
  draft,
  media,
  payload,
  resolution,
  threadTs,
  token,
}: {
  deps: Pick<SlackWriteDeps, "whoAmI">;
  draft: ParkedSlackDraft;
  media: readonly ParkedSlackDraftMedia[];
  payload: ParkedDraftPayload;
  resolution: MentionResolution;
  threadTs: string | undefined;
  token: string;
}): Promise<readonly string[]> {
  const self = await deps.whoAmI({ token });
  const offered = parkedDraftDigest({
    draft: {
      authorId: self.userId,
      channel: draft.channel,
      groupDm: draft.groupDm,
      media,
      mentions: parkedMentions({ resolution }),
      payload,
      priorAsk: draft.priorAsk,
      threadTs,
    },
  });
  if (offered === draft.digest) {
    return [];
  }
  return [
    `${SlackDraftErrors.digestMismatch({ id: draft.id, offered, recorded: draft.digest }).message} — nothing was sent.`,
  ];
}

/**
 * A `readMedia` that serves ONLY the verified bytes, so the send cannot reopen a path between the check
 * and the upload.
 *
 * @param media the verified attachments, keyed as the drip names them
 * @returns the seam the send reads its attachments through
 */
export function servedMedia({
  media,
}: {
  media: ReadonlyMap<string, VerifiedDraftMedia>;
}): SlackWriteDeps["readMedia"] {
  return async ({ path }) => {
    const entry = media.get(path);
    if (entry === undefined) {
      // Unreachable from a release, whose drip names only these keys; a throw here fails BEFORE the door.
      throw new Error(`${path} is not one of this draft's verified attachments — nothing was sent`);
    }
    return entry.upload satisfies SlackUpload;
  };
}

/**
 * What a release says about its attachments before the send: each one's name, size and hash, verified.
 *
 * @param media the verified attachments, in attach order
 * @returns one line per attachment, or none for a text-only draft
 */
export function releaseMediaLines({ media }: { media: ReadonlyMap<string, VerifiedDraftMedia> }): readonly string[] {
  return [...media.values()].map(
    ({ record }) => `attachment verified: ${record.name} · ${String(record.bytes)} bytes · sha256 ${record.sha256}`,
  );
}

/**
 * Append the row's `released` event for a message that is in Slack at `ts` — the one step both identities'
 * releases end on. A failed append after a landed send exits non-zero and names the drop that resolves it.
 *
 * The release journals its permalink, and then SPENDS every other held cut the register records as the same message —
 * each dropped with a note naming this row, which `draftLiveCut.ts` reads as the successor — so no card or seat can
 * send an older cut after this one landed (`./releaseCuts.ts`).
 *
 * @param deps the injected world, for the append
 * @param draft the released row
 * @param heldCuts the other held cuts of this message, spent once it lands
 * @param home the state home the register lives under
 * @param permalink where the landed message reads, when Slack answered one
 * @param ts the landed message's own Slack timestamp
 * @param threadMovedCleared the messages a person changed since the row's read that the release judged and sent past —
 *   journalled on the event, so a send over a moved conversation is findable afterwards
 * @param thanksInstead the thanks line sent in place of the approved words, journalled so a reader of the register
 *   sees the row closed on thanks rather than on the message they read
 * @returns the exit code the verb ends on
 */
export function markDraftReleased({
  deps,
  draft,
  heldCuts,
  home,
  permalink,
  ts,
  thanksInstead,
  threadMovedCleared,
}: {
  deps: Pick<SlackWriteDeps, "appendDraftEvent">;
  draft: ParkedSlackDraft;
  heldCuts: readonly string[];
  home: string;
  permalink: string | undefined;
  ts: string;
  thanksInstead?: string | undefined;
  threadMovedCleared?: readonly string[] | undefined;
}): number {
  const appended = deps.appendDraftEvent({
    event: {
      channel: draft.channel,
      // A thanks line sends none of the row's words, so it binds no version of them.
      ...(thanksInstead === undefined ? { digest: draft.digest } : {}),
      id: draft.id,
      kind: "released",
      ts,
      tsIso: new Date().toISOString(),
      ...(draft.threadTs === undefined ? {} : { threadTs: draft.threadTs }),
      ...(permalink === undefined ? {} : { permalink }),
      ...(threadMovedCleared === undefined || threadMovedCleared.length === 0
        ? {}
        : { threadMovedClearedTs: threadMovedCleared }),
      ...(thanksInstead === undefined ? {} : { thanksInstead }),
    },
    home,
  });
  if (appended.isErr()) {
    logger.error({
      msg:
        `${appended.error.message} — draft ${draft.id} WAS SENT (${draft.channel} ${ts}) but is still ` +
        `held in the register. Resolve it: slopweaver slack draft drop ${draft.id} --note "sent ${draft.channel} ${ts}"`,
    });
    return EXIT_ERROR;
  }
  logger.info({ msg: `released ${draft.id}: the queue no longer offers it` });
  return spendHeldCuts({ deps, draft, heldCuts, home, ts }) ? EXIT_OK : EXIT_ERROR;
}
