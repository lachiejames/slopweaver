/**
 * ONE QUEUE CARD PER HELD SLACK DRAFT. Without this, the Queue drew a `post:` card asking "Claude's draft or
 * Codex's?" beside an ask asking "Send the held reply under Seth's message …?", both drawing the same draft for the
 * same thread, so approving one left the other a duplicate. Each register built its own card, and nothing asked
 * whether another card already drew the draft.
 *
 * So, after every card is built and gated and before the ranking:
 *
 * - **An ask or hand card that draws a held draft OWNS it**, and that draft's own `post:` card is absorbed: gone from
 *   the list, its key and its re-cut aliases answering to the owner, so a link naming the post opens the one card. The
 *   owner wins because it carries the problem, the stakes and the owner's ruling, and answering it wakes the run that sends the
 *   draft and settles itself; kept the other way round, the ask resurfaced the moment the post was sent. A yes landed
 *   on the owner already binds the draft (`src/cli/commands/slack/draftApprovalGate.ts`).
 * - **The variant choice rides the owner.** Its panel draws Codex's draft beside the original
 *   (`../components/console/NamedDrafts.tsx`), and an ask's `what` opens on the choice, naming the original by who
 *   wrote it, since the ask's own letters are its options. A hand card's text is checked against its step
 *   (`./handCard.ts`), so it carries the choice in its drawn drafts alone.
 * - **Only an owner of ONE held draft absorbs.** The voice carries one draft, or one A and B, per card
 *   (`./queueVoice.ts`, `./talkVoiceRecord.ts`), so an owner of two would take both post cards' words and picks out of
 *   the voice's reach. An owner of several still owns them for the gate below, and each draft
 *   keeps its own post card.
 * - **The owner is team-facing**, as the post it absorbed was, unless it is a check-in.
 * - **The gate**: a second card that would draw a held draft another card already owns is REFUSED, naming the draft
 *   and the owning card, so `./queueWithholding.ts` holds it off the Queue and `queue refusals` names it to the chair.
 *   A refused card claims nothing, so a draft only it named keeps its own post card.
 *
 * Only a HELD draft counts: a sent or dropped one is a record, not a decision, and two cards may both say what became
 * of it. A card a gate already refused owns nothing, so it never takes the post card that would otherwise draw.
 *
 * Pure: rows in, rows out.
 */

import type { ParkedDraft } from "../components/live/readSlackDrafts";
import type { QueueCardForm } from "./briefingCardForm";
import { choiceSentences } from "./postCard";
import { postChoiceOf } from "./postHead";
import { foldedText, type QueueCard } from "./queueCard";
import type { QueueRow } from "./queueRows";
import { heldDraftsNamed } from "./slackDraftIds";

/**
 * The held drafts a row draws as a decision: an ask's or hand's named drafts still parked, counted as the voice counts
 * them ({@link heldDraftsNamed}).
 *
 * @returns the drafts, first named first, or none for any other row
 */
function heldDraftsOf({ row }: { row: QueueRow }): readonly ParkedDraft[] {
  if (row.record.kind !== "ask" && row.record.kind !== "hand") {
    return [];
  }
  return heldDraftsNamed({ named: row.record.drafts });
}

/**
 * The row, refused with the gate's sentence. Refused only once: a card another gate refused keeps that refusal.
 *
 * @param collisions each held draft id the row would draw twice, with the key of the card that owns it
 * @returns the refused row
 */
function refusedTwice({
  row,
  collisions,
}: {
  row: QueueRow;
  collisions: readonly { readonly id: string; readonly owner: string }[];
}): QueueRow {
  const named = collisions.map(({ id, owner }) => `${id} (already on ${owner})`).join(", ");
  const why =
    `This card would draw held Slack draft ${named}, so it is refused rather than asking the owner about one draft on two ` +
    "Queue cards. That is a defect in whatever recorded this card, which should name the draft only where it is asked.";
  const form: QueueCardForm = { kind: "refused", why };
  return { ...row, record: { ...row.record, form } };
}

/**
 * A row's aliases, none when it carries none.
 *
 * @returns the aliases
 */
function aliasesOf({ row }: { row: QueueRow }): readonly string[] {
  if (row.aliases === undefined) {
    return [];
  }
  return row.aliases;
}

/**
 * An ask card's `what`, opened on the choice each absorbed draft still owes — Codex's draft beside it, or Codex's
 * draft not yet arrived. Any other card is returned as it was.
 *
 * @param card the owner's card
 * @param drafts the held drafts it absorbed
 * @returns the card
 */
function withChoice({ card, drafts }: { card: QueueCard; drafts: readonly ParkedDraft[] }): QueueCard {
  if (card.kind !== "briefing") {
    return card;
  }
  const sentences = drafts.flatMap((draft) => {
    let original = "the recording session's draft";
    if (draft.comparison?.composer === "claude-code") {
      original = "Claude's draft";
    }
    return choiceSentences({
      choice: postChoiceOf({ post: draft }),
      codexOwed: draft.comparison?.state === "pending",
      original,
    });
  });
  if (sentences.length === 0) {
    return card;
  }
  let rest = "";
  if (card.what !== undefined) {
    rest = ` ${card.what.whole}`;
  }
  return { ...card, what: foldedText({ text: `${sentences.join(" ")}${rest}` }) };
}

/**
 * Which drawn ask or hand row first claims each held draft, and which later rows collide with a claim.
 *
 * Kept by POSITION, never by key: two board rows sharing a slug share a key (`./queueRows.ts` keeps both), and a
 * key-keyed refusal of the second refused the first with it. And claimed by register ENTRY, never
 * id: two entries may share one, and each is its own draft to draw.
 *
 * @param rows every row, in the order `rowsOf` built them
 * @returns `absorbs`, each held draft whose post card its owner absorbs, with the owner's position — only an owner of
 *   exactly one held draft — and `refused`, each colliding row's position with the drafts it collided on
 */
function claimsOf({ rows }: { rows: readonly QueueRow[] }): {
  readonly absorbs: Absorbs;
  readonly refused: ReadonlyMap<number, readonly { readonly id: string; readonly owner: string }[]>;
} {
  const owners = new Map<ParkedDraft, string>();
  const absorbs = new Map<ParkedDraft, number>();
  const refused = new Map<number, readonly { readonly id: string; readonly owner: string }[]>();
  // The very register entries a drawn post card draws.
  const postDrawn = new Set<ParkedDraft>(
    rows.flatMap((row) => (row.record.kind === "post" && row.record.form.kind === "drawn" ? [row.record.post] : [])),
  );
  rows.forEach((row, index) => {
    if (row.record.form.kind !== "drawn") {
      return;
    }
    const held = heldDraftsOf({ row });
    const collisions = held.flatMap((draft) => {
      const owner = owners.get(draft);
      return owner === undefined ? [] : [{ id: draft.id, owner }];
    });
    // A held draft only this card would draw — unclaimed, its own post card refused or absent — keeps the card drawn,
    // collision and all: a duplicate the owner can see beats a draft nobody draws.
    const orphans = held.filter((draft) => !owners.has(draft) && !postDrawn.has(draft));
    if (collisions.length > 0 && orphans.length > 0) {
      for (const draft of orphans) {
        owners.set(draft, row.key);
      }
      return;
    }
    if (collisions.length > 0) {
      refused.set(index, collisions);
      return;
    }
    for (const draft of held) {
      owners.set(draft, row.key);
    }
    // `.at`, so an absent entry reads as absent under either tsconfig, `site/` having no `noUncheckedIndexedAccess`.
    const only = held.at(0);
    if (held.length === 1 && only !== undefined) {
      absorbs.set(only, index);
    }
  });
  return { absorbs, refused };
}

/** Each held register entry an owner absorbs the post card of, with the owner's position. */
type Absorbs = ReadonlyMap<ParkedDraft, number>;

/**
 * The position of the owner that absorbs a post row: the one holding that very register entry — the same parsed draft,
 * not one equal to it by id or digest — so a second entry sharing the id, whatever else it shares, keeps its own card.
 *
 * @returns the owner's position, or `undefined` for any row no owner absorbs
 */
function absorberOf({ absorbs, row }: { absorbs: Absorbs; row: QueueRow }): number | undefined {
  if (row.record.kind !== "post") {
    return undefined;
  }
  return absorbs.get(row.record.post);
}

/**
 * The Queue's rows with each held Slack draft on ONE card: its post card absorbed into the ask or hand card that asks
 * the owner to send it, and any further card naming it refused.
 *
 * @param rows every row `rowsOf` built, gated, in the order it built them — hands, then asks, then the rest
 * @returns the rows, in the same order, less every absorbed post card
 */
export function oneCardPerHeldSlackDraft({ rows }: { rows: readonly QueueRow[] }): readonly QueueRow[] {
  const { absorbs, refused } = claimsOf({ rows });
  // The keys each owner takes over from the post cards it absorbed, by its position: the post's own key, then its
  // re-cut aliases.
  const taken = new Map<number, string[]>();
  for (const row of rows) {
    const owner = absorberOf({ absorbs, row });
    if (owner === undefined) {
      continue;
    }
    let keys = taken.get(owner);
    if (keys === undefined) {
      keys = [];
      taken.set(owner, keys);
    }
    keys.push(row.key, ...aliasesOf({ row }));
  }
  const out: QueueRow[] = [];
  rows.forEach((row, index) => {
    if (absorberOf({ absorbs, row }) !== undefined) {
      return;
    }
    const collisions = refused.get(index);
    if (collisions !== undefined) {
      out.push(refusedTwice({ collisions, row }));
      return;
    }
    const keys = taken.get(index);
    if (keys === undefined) {
      out.push(row);
      return;
    }
    const aliases = [...new Set([...aliasesOf({ row }), ...keys])];
    let card = row.card;
    if (row.record.kind === "ask") {
      card = withChoice({ card, drafts: heldDraftsOf({ row }) });
    }
    const tier = row.tier === "check-in" ? row.tier : "team-blocked";
    out.push({ ...row, aliases, card, tier });
  });
  return out;
}
