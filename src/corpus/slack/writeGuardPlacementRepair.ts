/**
 * The two repairs a misplaced post gets — MOVE it when nobody engaged, CROSS-LINK to it when somebody did — and the
 * take-back of the guard's own repost when the move cannot finish. Every Slack write the placement guard makes is
 * here; `./writeGuardPlacement.ts` decides which repair runs and carries the contract, including why the repost
 * goes first and the delete second. It imports the reads and journal rows from `./writeGuardPlacementCore.ts` and
 * nothing from `./writeGuardPlacement.ts`, which imports `move` and `crossLink` from here.
 */
import type { Result } from "../../lib/result.js";
import type { ReadSlackMessage } from "../../outbound/slack/lifecycleGuards.js";
import { engagementAfter, type PlacedMessageRef, type PostingIdentity } from "../../outbound/slack/placement.js";
import { slackPermalink } from "../../outbound/slack/renderCheck.js";
import {
  causeText,
  conversationTsOf,
  finish,
  intend,
  landedRight,
  observedRootOf,
  repairFailed,
  type Settling,
} from "./writeGuardPlacementCore.js";
import type { PostedMessage } from "./writeTransport.js";

/**
 * Take this guard's own repost back — unless a person has already replied to it, which makes it conversation too,
 * or its conversation cannot be read to say. `stands` is true whenever the repost was left in place on purpose.
 */
async function takeBack<A>({
  settling,
  repost,
  read,
  self,
}: {
  settling: Settling<A>;
  repost: PlacedMessageRef;
  read: ReadSlackMessage | undefined;
  self: PostingIdentity | undefined;
}): Promise<{ readonly stands: boolean; readonly residue: string }> {
  const place = await settling.seams.readThread({
    channel: repost.channel,
    threadTs: conversationTsOf({ read, ts: repost.ts }),
  });
  if (place.isErr()) {
    return {
      residue: `; the repost ${repost.ts} stands: its conversation could not be read (${place.error})`,
      stands: true,
    };
  }
  if (engagementAfter({ afterTs: repost.ts, rawMessages: place.value, self }).length > 0) {
    return { residue: `; the repost ${repost.ts} stands: a person has replied to it`, stands: true };
  }
  const undone = await settling.transport
    .deleteMessageOnce({ posted: repost })
    .catch((cause: unknown) => ({ kind: "failed", reason: causeText({ cause }) }) as const);
  return {
    residue: undone.kind === "failed" ? `; the repost ${repost.ts} could not be removed: ${undone.reason}` : "",
    stands: false,
  };
}

/**
 * Post the unengaged misplaced message again where it was addressed, then delete the misplaced one.
 *
 * @returns the repost, settled `moved` — or the message that stands, settled `held` or `repair-failed`
 */
export async function move<A>({
  settling,
  posted,
  read,
  detail,
  self,
}: {
  settling: Settling<A>;
  posted: PlacedMessageRef;
  read: ReadSlackMessage;
  detail: string;
  self: PostingIdentity | undefined;
}): Promise<PostedMessage> {
  const intentFailure = intend({ act: "delete-and-repost", detail, engagement: [], posted, settling });
  if (intentFailure !== undefined) {
    return repairFailed({
      detail: `${detail}; ${intentFailure}`,
      read,
      reason: "intent-journal-unwritable",
      settling,
      standing: posted,
    });
  }
  let reposted: PostedMessage;
  try {
    reposted = await settling.post(settling.args);
  } catch (cause) {
    return repairFailed({
      detail: `${detail}; the repost failed or went unconfirmed, so the misplaced message stands: ${causeText({ cause })}`,
      read,
      reason: "repost-failed",
      settling,
      standing: posted,
    });
  }
  const to: PlacedMessageRef = { channel: reposted.channel, ts: reposted.ts };
  const second = await landedRight({ posted: to, settling });
  if (!second.right) {
    // Both copies are wrong or the repost cannot be seen; the original is the one already judged, so it stays the
    // send's identity and the repost is taken back — it is this guard's own seconds-old message.
    const { residue } = await takeBack({ read: second.read, repost: to, self, settling });
    return repairFailed({
      detail: `${detail}; the repost did not read back right (${second.detail})${residue}`,
      read,
      reason: "second-placement-mismatch",
      settling,
      standing: posted,
    });
  }
  return deleteMisplaced({ detail, posted, read, repostRead: second.read, self, settling, to });
}

/** Everything the second half of a move carries: the misplaced message, and the repost that read back right. */
interface Reposted<A> {
  readonly settling: Settling<A>;
  readonly posted: PlacedMessageRef;
  readonly read: ReadSlackMessage;
  readonly detail: string;
  readonly self: PostingIdentity | undefined;
  readonly to: PlacedMessageRef;
  readonly repostRead: ReadSlackMessage | undefined;
}

/**
 * The repost landed right: re-read the misplaced message's conversation as late as the delete allows, then delete it
 * — or, when a person replied meanwhile or the re-read failed, yield to them instead.
 */
async function deleteMisplaced<A>(moving: Reposted<A>): Promise<PostedMessage> {
  const { settling, posted, detail, self, to, repostRead } = moving;
  // A person may have replied while the repost went out, so the misplaced message's conversation is read once more,
  // as late as the delete allows. Slack has no conditional delete: what remains is the gap between this read and the
  // delete call itself, against the repost's two round trips this closes.
  const late = (
    await settling.seams.readThread({
      channel: posted.channel,
      threadTs: conversationTsOf({ read: moving.read, ts: posted.ts }),
    })
  ).map((rawMessages) => engagementAfter({ afterTs: posted.ts, rawMessages, self }));
  if (late.isErr() || late.value.length > 0) {
    return yieldToLateReply({ late, moving });
  }
  const deleted = await settling.transport
    .deleteMessageOnce({ posted })
    .catch((cause: unknown) => ({ kind: "failed", reason: causeText({ cause }) }) as const);
  if (deleted.kind === "failed") {
    return repairFailed({
      detail: `${detail}; reposted at ${to.ts}, but the misplaced ${posted.ts} could not be deleted: ${deleted.reason}`,
      read: repostRead,
      reason: "delete-failed",
      settling,
      standing: to,
    });
  }
  return finish({ final: to, outcome: { detail, from: posted, kind: "moved", to }, read: repostRead, settling });
}

/**
 * A person replied to the misplaced message mid-move, or its conversation could not be re-read: the repost is this
 * guard's own seconds-old message, so it is taken back and the misplaced one stands.
 */
async function yieldToLateReply<A>({
  moving,
  late,
}: {
  moving: Reposted<A>;
  late: Result<readonly string[], string>;
}): Promise<PostedMessage> {
  const { settling, posted, read, detail } = moving;
  const { residue, stands } = await takeBack({
    read: moving.repostRead,
    repost: moving.to,
    self: moving.self,
    settling,
  });
  if (late.isErr()) {
    return repairFailed({
      detail: `${detail}; the conversation could not be re-read before the delete (${late.error})${residue}`,
      read,
      reason: "engagement-unreadable",
      settling,
      standing: posted,
    });
  }
  if (stands) {
    // Both copies have people talking under them: neither is this guard's to remove, so both stand, reported.
    return repairFailed({
      detail: `${detail}; a person replied to the misplaced message while it was being moved${residue}`,
      read,
      reason: "repost-engaged",
      settling,
      standing: posted,
    });
  }
  return crossLink({ detail: `${detail}${residue}`, engagement: late.value, posted, read, settling });
}

/** Post the one cross-link, at the address the misplaced message was meant for. A transport throw escapes. */
async function postLink<A>({
  settling,
  posted,
  read,
  workspaceUrl,
}: {
  settling: Settling<A>;
  posted: PlacedMessageRef;
  read: ReadSlackMessage;
  workspaceUrl: string;
}): Promise<PostedMessage> {
  const permalink = slackPermalink({
    channel: posted.channel,
    threadTs: observedRootOf({ read }),
    ts: posted.ts,
    workspaceUrl,
  });
  return settling.transport.postDripMessage({
    channel: settling.intended.channel,
    payload: {
      form: "plain",
      text: `This landed in the wrong place and the conversation has carried on there: ${permalink}`,
      unfurl_links: false,
      unfurl_media: false,
    },
    threadTs: settling.intended.threadTs,
  });
}

/**
 * Leave an engaged misplaced message standing and link to it from where it was addressed.
 *
 * @returns the misplaced message, settled `held` — or `repair-failed` when the link could not be made and read back
 */
export async function crossLink<A>({
  settling,
  posted,
  read,
  engagement,
  detail,
}: {
  settling: Settling<A>;
  posted: PlacedMessageRef;
  read: ReadSlackMessage;
  engagement: readonly string[];
  detail: string;
}): Promise<PostedMessage> {
  const intentFailure = intend({ act: "cross-link", detail, engagement, posted, settling });
  if (intentFailure !== undefined) {
    return repairFailed({
      detail: `${detail}; ${intentFailure}`,
      read,
      reason: "intent-journal-unwritable",
      settling,
      standing: posted,
    });
  }
  const failed = ({ why }: { why: string }): PostedMessage =>
    repairFailed({ detail: `${detail}; ${why}`, read, reason: "cross-link-failed", settling, standing: posted });
  let link: PostedMessage;
  try {
    const self = await settling.transport.whoAmI();
    if (self.workspaceUrl === undefined) {
      return failed({ why: "auth.test named no workspace to link from" });
    }
    link = await postLink({ posted, read, settling, workspaceUrl: self.workspaceUrl });
  } catch (cause) {
    return failed({ why: causeText({ cause }) });
  }
  const linked: PlacedMessageRef = { channel: link.channel, ts: link.ts };
  const check = await landedRight({ posted: linked, settling });
  if (!check.right) {
    return failed({ why: `the cross-link ${linked.ts} did not read back where it was addressed (${check.detail})` });
  }
  return finish({
    final: posted,
    outcome: { crossLink: linked, detail, intended: settling.intended, kind: "held", posted },
    read,
    settling,
  });
}
