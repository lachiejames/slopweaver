/**
 * THE HELD DRAFTS ON THE OWNER'S QUEUE, as `slopweaver talk find-card` searches them beside the board.
 *
 * The failure this closes, from a console call: the owner asked for a Linear briefing or a queue card draft. A held DM
 * to a colleague laying out a Linear initiative and its projects was on the owner's Queue as a `post:` card the whole
 * time, and the voice said it could not find the draft card in the Queue and board search, pointing at an unrelated
 * card instead. find-card ranked only board rows: a held draft is a Queue card and no board row, so it could never be
 * named. The nearest thing it did name was the closed row that raised the draft, whose summary carried a stale
 * `post:` key, and `read_card` on that key returned the unrelated card. The owner called it a P0 bug: the voice must
 * be able to find what it is asked for.
 *
 * So every draft the Queue draws as a `post:` card is searched by what it is about: its `why`, the message itself,
 * who it tags and where it goes, and the summary of the board row that raised it. It is the Queue's own criterion —
 * held, and not sent back for its missing proof (`site/components/live/readSlackDrafts.ts` `isParked`, from
 * `draftProofVerdict` as `slack draft list --json` publishes it) — so a released, dropped or no-proof draft is never
 * named as on the owner's Queue.
 */
import { type DraftMediaOf, draftProofVerdict } from "../outbound/slack/draftProof.js";
import type { SlackDraftItem } from "../outbound/slack/draftRegister.js";
import { draftBodyLines } from "../outbound/slack/draftText.js";
import { type CardText, findCards, type RowWordMemo } from "./cardFind.js";

/** The path-shaped key a draft is ranked under, so it can never collide with a board doc's file. */
const DRAFT_PATH_PREFIX = "slack-draft:";

/** A held draft the Queue draws, as find-card names it. */
export interface QueueDraft {
  /** The Queue card key that opens it — what `open_card` takes. */
  readonly key: `post:${string}`;
  readonly id: string;
  /** What the draft is for, as its recorder wrote it. */
  readonly why: string;
  /**
   * The message's own words, whitespace folded, so a draft matched on its body is judged by that body too — a `why`
   * can go stale under a recut while the words the owner asked for sit below it.
   */
  readonly says: string;
  /** Where it would go, in words: `#channel`, a thread in `#channel`, or a direct message. */
  readonly to: string;
  /** Whose name it goes out under. */
  readonly as: "you" | "the bot";
}

/** A held draft the search matched, with the words it matched. */
export interface PlacedDraft extends QueueDraft {
  readonly matched: readonly string[];
}

/**
 * Whether a folded draft is a card on the owner's Queue: held, and not sent back unseen for a finding's or a first message's
 * missing proof.
 *
 * @param item the folded register row
 * @param mediaOf what each attachment under it is, for the first-message proof
 * @returns true when the Queue draws it as a `post:` card
 */
export function onOwnerQueue({ item, mediaOf }: { item: SlackDraftItem; mediaOf: DraftMediaOf }): boolean {
  return (
    item.state === "held" && draftProofVerdict({ draft: item.draft, media: mediaOf({ item }) }).missing.length === 0
  );
}

/**
 * Every held draft on the owner's Queue, as the topic search reads it and as a line names it.
 *
 * @param items the draft register, folded
 * @param mediaOf what each attachment under a row is, so a row is on the Queue exactly when the list says so
 * @param rowSummaries every board doc's summary by slug, so a draft is also found by the row that raised it — never
 *   by the slug itself, which is a filename and no topic
 * @returns each draft's search text (keyed by a path no board doc can carry) and how it is named
 */
export function queueDraftsOf({
  items,
  mediaOf,
  rowSummaries,
}: {
  items: readonly SlackDraftItem[];
  mediaOf: DraftMediaOf;
  rowSummaries: ReadonlyMap<string, readonly string[]>;
}): readonly { readonly text: CardText; readonly draft: QueueDraft }[] {
  return items
    .filter((item) => onOwnerQueue({ item, mediaOf }))
    .map((item) => {
      const { draft } = item;
      const to = destinationOf({ item });
      // A row that left the board (archived, swept) raised it all the same; the draft is then found by its own words.
      let raisedBy: readonly string[] = [];
      const onBoard = draft.row === undefined ? undefined : rowSummaries.get(draft.row);
      if (onBoard !== undefined) {
        raisedBy = onBoard;
      }
      const body = draftBodyLines({ payload: draft.payload });
      const texts = [draft.why, ...body, ...draft.mentions.map((mention) => mention.key), to, ...raisedBy];
      const key = draftKey({ id: item.id });
      const as = draft.actor === "bot" ? "the bot" : "you";
      const says = body.join(" ").replace(/\s+/g, " ").trim();
      return {
        draft: { as, id: item.id, key, says, to, why: draft.why },
        text: { askedIso: draft.tsIso, path: draftPath({ id: item.id }), slug: key, texts },
      };
    });
}

/**
 * The search key a draft is ranked under — a path no board doc can carry, so a found draft is told apart from a row.
 *
 * @param id the draft's register id
 * @returns the key
 */
export function draftPath({ id }: { id: string }): string {
  return `${DRAFT_PATH_PREFIX}${id}`;
}

/**
 * The held drafts the owner's words match, best first. A draft is ranked in a corpus of the board's rows and the drafts
 * together, so a word's rarity is the board's and the Queue's alike, but in a pass of its own: the rows keep the
 * ranking they had without the drafts, so a draft never moves a row out of the live or closed pool composed (a draft
 * carrying one of two words made the other rarer and reordered rows at the pool edge).
 *
 * @param queued every held draft on the owner's Queue with the text it is searched on, from `queueDraftsOf`
 * @param rows every board row the topic search reads
 * @param words what the owner said, and any other ways of saying it
 * @param counted the memo the board's own ranking already filled, so no row is counted twice
 * @returns the drafts that matched, with the words each matched
 */
export function draftsFound({
  counted,
  queued,
  rows,
  words,
}: {
  counted?: RowWordMemo | undefined;
  queued: ReturnType<typeof queueDraftsOf>;
  rows: readonly CardText[];
  words: readonly string[];
}): readonly PlacedDraft[] {
  if (queued.length === 0) {
    return [];
  }
  const draftByPath = new Map(queued.map((one) => [one.text.path, one.draft]));
  return findCards({ counted, rows: [...rows, ...queued.map((one) => one.text)], words })
    .found.filter((card) => draftByPath.has(card.path))
    .map((card): PlacedDraft => ({ ...draftByPath.get(card.path)!, matched: card.matched }));
}

/** The Queue card key that opens a draft — `site/lib/parkedPostRows.ts` keys a held post `post:<id>`. */
function draftKey({ id }: { id: string }): `post:${string}` {
  return `post:${id}`;
}

/** Where a draft would go, in words the owner can hear. */
function destinationOf({ item }: { item: SlackDraftItem }): string {
  const { draft } = item;
  // A DM's recorded name is its own id, so a direct message is said as one before any name.
  let place = draft.channel;
  if (draft.channel.startsWith("D")) {
    place = "a direct message";
  } else if (draft.channelName !== undefined) {
    place = `#${draft.channelName}`;
  }
  if (draft.shape === "thread") {
    return `a thread reply in ${place}`;
  }
  return place;
}
