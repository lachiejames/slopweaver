/**
 * The queue's rows for the parked-draft register: one per message a session parked to post, under the owner's
 * name or the bot's, that is still waiting on the owner's word. Split from `./queueRows.ts`, which folds every register into one list, so
 * that file stays under the 300-line cap.
 */

import type { BoardRow } from "../components/live/read";
import { isParked, type ParkedDraft } from "../components/live/readSlackDrafts";
import type { LiveState } from "../components/live/useLive";
import { type BriefingCardBasis, briefingCardForm } from "./briefingCardForm";
import { postCard } from "./postCard";
import { postCurrencyFloorIso } from "./postCurrencyFloor";
import { postHeadOf } from "./postHead";
import { postJudgementLine, postLandingMarks } from "./postJudgement";
import { queueProvenanceOf } from "./provenance";
import { belongingRowSource } from "./queueCardSource";
import type { QueueRow } from "./queueRows";
import type { QueueTags } from "./queueTagsInherited";
import { postPlacement } from "./registerPlacementDirect";
import { droppedCutIdsEndingAt } from "./slackDraftIds";
import { draftParentInWords, taggedLabels } from "./slackPeople";
import { waitingTierOf } from "./waitingRank";

/**
 * What a message parked under the owner's name draws from its record: a `what` always — who it tags and that it is unsent
 * are read off the draft itself, beside the recorder's `why` when it states one — and nothing it did not state.
 */
const ONLY_A_WHAT: BriefingCardBasis = { lean: "absent", problem: "absent", stakes: "absent", what: "present" };

/**
 * One row per draft still parked.
 *
 * @param posts the register as the page holds it
 * @param readRows the board's rows, or `undefined` while it is unread, which a card's source says aloud
 * @returns the rows, without tags yet; none until the register has read
 */
export function parkedPostRows({
  posts,
  readRows,
}: {
  posts: LiveState<readonly ParkedDraft[]>;
  readRows: readonly BoardRow[] | undefined;
}): Omit<QueueRow, keyof QueueTags>[] {
  if (posts.phase !== "ready") {
    return [];
  }
  const out: Omit<QueueRow, keyof QueueTags>[] = [];
  for (const post of posts.value) {
    // A held row always carries its release (`readParkedDrafts` refuses one without), so this skips resolved rows.
    const release = post.release;
    if (!isParked({ draft: post }) || release === undefined) {
      continue;
    }
    const { addressed, head } = postHeadOf({ post });
    const card = postCard({
      post: {
        ...head,
        actor: post.actor,
        addressed,
        advisory: post.advisory,
        digest: post.digest,
        id: post.id,
        judgementLine: postJudgementLine({ judgement: post.judgement }),
        mentions: taggedLabels({ mentions: post.mentions, people: post.people }).map((label) => label.text),
        parent:
          post.thread === undefined ? undefined : draftParentInWords({ people: post.people, thread: post.thread }),
        release,
        text: post.fallback,
        why: post.why,
      },
    });
    const recutFrom = droppedCutIdsEndingAt({ id: post.id, items: posts.value });
    const placement = postPlacement({ post });
    out.push({
      ...(recutFrom.length === 0 ? {} : { aliases: recutFrom.map((id) => `post:${id}`) }),
      card,
      hint: `${addressed} ${post.channel} ${post.why} ${post.fallback}`,
      id: post.id,
      key: `post:${post.id}`,
      kind: "post",
      pill: post.actor === "bot" ? "posts as the bot" : "posts as you",
      provenance: queueProvenanceOf({ placement }),
      record: { form: briefingCardForm({ basis: ONLY_A_WHAT, card }), kind: "post", post },
      ...postLandingMarks({ judgement: post.judgement }),
      placement,
      source: belongingRowSource({
        otherwise: { kind: "unrecorded", origin: `a session parked this draft: ${post.why}`, steers: [] },
        rows: readRows,
        slug: post.row,
      }),
      threadUrl: post.thread?.permalink,
      tier: waitingTierOf({ checkIn: false, teamFacing: true }),
      verifiedBy: "the drafts register still holds it",
      currencyFloorIso: postCurrencyFloorIso({ post }),
      verifiedIso: posts.observedAtIso,
      whenIso: post.tsIso,
    });
  }
  return out;
}
