/**
 * The parked Slack drafts a card names by id — so a card asking "post this now, or hold it" shows the post.
 *
 * A card like this shows the draft Slack message attached, since that lets the owner react at a glance. A shaped ask
 * names its draft in an option ("post draft sd-e8ecf199 to #dev-team now") rather than in a field, because `handover ask` has no draft field; the id is the exact token `slack draft`
 * mints, so matching it whole is a lookup, never a guess at prose.
 *
 * An ask naming a draft id that draws no draft must never happen, for any queue card. So every id a card names resolves to SOMETHING the card draws — the draft, or what became of it. A dropped id
 * whose drop note names its re-cut resolves to the LIVE cut ({@link liveCutOf}), never to the words it replaced.
 *
 * Pure: texts in, ids out; ids and the register in, one resolution per id out.
 */

import type { DraftProofMissing } from "../components/live/draftProofMissing";
import { isParked, type ParkedDraft } from "../components/live/readSlackDrafts";
import type { QueueCardForm } from "./briefingCardForm";

/**
 * A draft id as the card can DRAW it, which is a SUPERSET of the id as minted (`sd-` and eight lowercase hex
 * digits). The card draws a body through its mrkdwn renderer (`site/lib/slackMrkdwn.ts`), which only ever drops
 * the `*`, `_`, `~` and `` ` `` markers of a run it recognises and draws a `<target|label>` entity as its label.
 * So the pattern lets a marker sit between any two characters of the id, and a marker counts as the boundary either
 * side — `_` included, though a regex `\w` counts it a letter — since the renderer only ever drops one, so the
 * character beside a drawn id is its drawn neighbour or a marker.
 * `sd-*deadbeef*`, `sd-*deadbeef**x` and `*sd-deadbeef*x` all match however the renderer pairs their markers, and
 * `sd-deadbeefx` still does not. Every text is read raw and with its entities replaced; the markers are dropped from
 * what matched. A marker the renderer keeps can yield a false match, which refuses with the hatch.
 */
const DRAWN_ID = /(?<![A-Za-z0-9-])s[*_~`]*d[*_~`]*-(?:[*_~`]*[0-9a-f]){8}(?![A-Za-z0-9-])/gu;
const MRKDWN_MARKS = /[*_~`]/gu;
const MRKDWN_ENTITY = /<[@#!]?([^>|]*)(?:\|([^>]*))?>/gu;

/** The two reads of one text that between them hold every id its rendering can draw: raw, and entities drawn. */
function readsOf({ text }: { text: string }): readonly string[] {
  const labelled = text.replace(MRKDWN_ENTITY, (_whole: string, target: string, label: string | undefined) => {
    if (label === undefined) {
      return target;
    }
    return label;
  });
  return [text, labelled];
}

/**
 * Every draft id the texts name, first seen first, each once.
 *
 * @param texts the fields to read, in the order their ids should be listed; an absent field is skipped
 * @returns the ids
 */
export function slackDraftIdsIn({ texts }: { texts: readonly (string | undefined)[] }): readonly string[] {
  const reads = texts.flatMap((text) => (text === undefined ? [] : readsOf({ text })));
  const out: string[] = [];
  for (const match of reads.flatMap((read) => [...read.matchAll(DRAWN_ID)])) {
    const id = match[0].replaceAll(MRKDWN_MARKS, "");
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

/**
 * One id a card names, resolved against the parked-draft register. Never dropped, whatever it resolved to: a
 * named id the register cannot show as a held draft is still a line saying what became of it, rather than an
 * absence that reads as "this card carries no draft".
 *
 * `recut` is a named id that was dropped and re-cut: the card draws the LIVE cut, and the dropped cuts only folded
 * with their drop notes. A card naming a dropped id, whose drop note reads "re-cut as <id>", must not draw
 * that first cut whole: the owner would approve words that are no longer the draft.
 */
export type NamedDraft =
  | { readonly kind: "held"; readonly id: string; readonly draft: ParkedDraft }
  | { readonly kind: "spent"; readonly id: string; readonly draft: ParkedDraft }
  | {
      readonly kind: "recut";
      readonly id: string;
      /** The cut that stands — held, released, or the last dropped cut when no further re-cut is named. */
      readonly live: ParkedDraft;
      /** Every dropped cut on the way to it, the named one first. */
      readonly superseded: readonly ParkedDraft[];
    }
  | { readonly kind: "absent"; readonly id: string }
  /** A named id whose live cut, its id carried, the Queue sent back unseen for want of its proof (`../components/live/draftProofMissing.ts`). */
  | { readonly kind: "proof-missing"; readonly id: string; readonly missing: readonly DraftProofMissing[] }
  | { readonly kind: "unread"; readonly id: string }
  | { readonly kind: "not-measured"; readonly id: string; readonly why: string };

/**
 * The parked-draft register in the three phases a live channel has — the shape `LiveState` already is, restated so
 * this module imports no hook. Still being read and could not be read are different lines on a card.
 */
export type DraftRegister =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly value: readonly ParkedDraft[] }
  | { readonly phase: "not-measured"; readonly why: string };

/**
 * Every id resolved against the register, in the order the ids came, each draft drawn once ({@link drawnOnce}).
 *
 * @param ids the ids a card names, as {@link slackDraftIdsIn} found them
 * @param posts the parked-draft register — every id is `unread` while it loads, and `not-measured` with its reason
 *   when it could not be read
 * @returns one resolution per id, less every one whose draft another already draws
 */
export function namedDrafts({ ids, posts }: { ids: readonly string[]; posts: DraftRegister }): readonly NamedDraft[] {
  const resolved = ids.map((id): NamedDraft => {
    if (posts.phase === "loading") {
      return { id, kind: "unread" };
    }
    if (posts.phase === "not-measured") {
      return { id, kind: "not-measured", why: posts.why };
    }
    const cut = liveCutOf({ id, items: posts.value });
    if (cut === undefined) {
      return { id, kind: "absent" };
    }
    const { live, superseded } = cut;
    // A cut missing its finding proof draws no words wherever the chain led: the owner is never shown a finding without its proof.
    if (live.state === "held" && live.proofMissing !== undefined) {
      return { id: live.id, kind: "proof-missing", missing: live.proofMissing };
    }
    if (superseded.length > 0) {
      return { id, kind: "recut", live, superseded };
    }
    if (isParked({ draft: live })) {
      return { draft: live, id, kind: "held" };
    }
    return { draft: live, id, kind: "spent" };
  });
  return drawnOnce({ named: resolved });
}

/**
 * The draft a resolution draws whole — the live cut — or `undefined` for one that draws no draft.
 *
 * @returns the drawn draft's id
 */
function drawnLiveId({ named }: { named: NamedDraft }): string | undefined {
  if (named.kind === "held" || named.kind === "spent") {
    return named.draft.id;
  }
  if (named.kind === "recut") {
    return named.live.id;
  }
  return undefined;
}

/**
 * One resolution per draft drawn. Measured: a card's ask named the live cut in its question and the dropped first
 * cut in its still-real line, and each id resolved on its own, so the live draft, its conversation, its attachments
 * and its send line were drawn twice, with a re-cut note between them.
 *
 * A live cut the card names directly keeps that resolution, and every re-cut ending on it goes with its note and its
 * folded history: the card already draws the draft it names. Two dropped ids re-cut to one live cut the card does not
 * name keep the first re-cut, carrying every dropped cut either passed through. The kept resolution stands where the
 * first of those it absorbed stood. A resolution drawing no draft is kept as it is, bar a second line for one live cut sent back for its proof.
 *
 * @param named the resolutions, one per named id, in the order the ids came
 * @returns the resolutions, each drawn draft once
 */
function drawnOnce({ named }: { named: readonly NamedDraft[] }): readonly NamedDraft[] {
  // Each slot is a resolution drawing no draft, or the live cut whose one resolution `byLive` holds.
  const slots: ({ readonly one: NamedDraft } | { readonly live: string })[] = [];
  const byLive = new Map<string, NamedDraft>();
  for (const one of named) {
    const live = drawnLiveId({ named: one });
    if (live === undefined) {
      if (
        one.kind === "proof-missing" &&
        slots.some((slot) => "one" in slot && slot.one.kind === "proof-missing" && slot.one.id === one.id)
      ) {
        continue;
      }
      slots.push({ one });
      continue;
    }
    const earlier = byLive.get(live);
    if (earlier === undefined) {
      slots.push({ live });
    }
    byLive.set(live, keptDraw({ earlier, one }));
  }
  return slots.map((slot) => ("one" in slot ? slot.one : byLive.get(slot.live)!));
}

/**
 * Which of two resolutions drawing one live cut stands: the one naming it directly, else one re-cut carrying every
 * dropped cut either passed through, in chain order.
 *
 * @param earlier the resolution already kept for this live cut, or `undefined` for the first
 * @param one the resolution just met
 * @returns the resolution to keep
 */
function keptDraw({ earlier, one }: { earlier: NamedDraft | undefined; one: NamedDraft }): NamedDraft {
  if (earlier === undefined || (earlier.kind === "recut" && one.kind !== "recut")) {
    return one;
  }
  if (earlier.kind !== "recut" || one.kind !== "recut") {
    return earlier;
  }
  // Two ids on one chain: the longer walk already holds the shorter in chain order.
  let [base, rest] = [earlier.superseded, one.superseded];
  if (rest.length > base.length) {
    [base, rest] = [rest, base];
  }
  const passed = new Set(base.map((draft) => draft.id));
  return { ...earlier, superseded: [...base, ...rest.filter((draft) => !passed.has(draft.id))] };
}

/**
 * Every draft id a set of resolutions draws, in drawing order — a live cut whole, each dropped cut folded.
 *
 * @param named the resolutions a card draws
 * @returns the ids, repeats kept
 */
export function drawnDraftIds({ named }: { named: readonly NamedDraft[] }): readonly string[] {
  return named.flatMap((one) => {
    if (one.kind === "recut") {
      return [one.live.id, ...one.superseded.map((draft) => draft.id)];
    }
    if (one.kind === "held" || one.kind === "spent") {
      return [one.draft.id];
    }
    return [];
  });
}

/**
 * The draft a resolution still asks the owner to send: a held draft, or a re-cut whose live cut is still parked. Every other
 * resolution is a record or a gap, never a decision, so it answers `undefined`.
 *
 * @param named one resolution a card draws
 * @returns the parked draft, or `undefined`
 */
export function heldDraftOf({ named }: { named: NamedDraft }): ParkedDraft | undefined {
  if (named.kind === "held") {
    return named.draft;
  }
  if (named.kind === "recut" && isParked({ draft: named.live })) {
    return named.live;
  }
  return undefined;
}

/**
 * The held drafts a card's resolutions draw, each register ENTRY once — two resolutions of one entry are one draft, two
 * entries sharing an id are two. The one count both the Queue's draft ownership (`./queueDraftOwnership.ts`) and its
 * voice (`./queueVoice.ts`) read, so a card the first lets absorb a post card is one the second reads one draft off.
 *
 * @param named the resolutions the card draws
 * @returns the drafts, first named first
 */
export function heldDraftsNamed({ named }: { named: readonly NamedDraft[] }): readonly ParkedDraft[] {
  const out: ParkedDraft[] = [];
  for (const each of named) {
    const held = heldDraftOf({ named: each });
    if (held !== undefined && !out.includes(held)) {
      out.push(held);
    }
  }
  return out;
}

/**
 * A card's form once the drafts it names are accounted for: refused, naming each id, when one draft would be drawn
 * twice. {@link namedDrafts} draws each once, so this holds any later path to such a card to the same line.
 *
 * @param named the resolutions the card draws
 * @returns `drawn`, or the refusal
 */
export function drawnOnceForm({ named }: { named: readonly NamedDraft[] }): QueueCardForm {
  const ids = drawnDraftIds({ named });
  const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (twice.length === 0) {
    return { kind: "drawn" };
  }
  const listed = [...new Set(twice)].join(", ");
  return {
    kind: "refused",
    why:
      `This card would draw draft ${listed} more than once, so it is refused rather than drawn long. That is a defect ` +
      "in how the card resolves the drafts it names, not two drafts to judge.",
  };
}

/** A whole minted draft id in a drop note — no neighbouring letter, digit or hyphen. */
const MINTED_ID = /(?<![A-Za-z0-9-])sd-[0-9a-f]{8}(?![A-Za-z0-9-])/gu;

/**
 * The draft a dropped one was re-cut as: the first whole id its drop note names that is not its own and that the
 * register holds. Forward only — a later draft's `why` saying "PROOF copy of sd-…" is not a re-cut. Held and released
 * drafts have none. `src/outbound/slack/draftLiveCut.ts`'s rule, restated because the console cannot import `src/`.
 *
 * @returns the successor, or `undefined`
 */
function successorOf({ draft, posts }: { draft: ParkedDraft; posts: readonly ParkedDraft[] }): ParkedDraft | undefined {
  if (draft.state !== "dropped" || draft.outcome === undefined) {
    return undefined;
  }
  for (const match of draft.outcome.matchAll(MINTED_ID)) {
    const found = posts.find((post) => post.id === match[0] && post.id !== draft.id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Follow a named draft through its drop notes to the cut that stands; a looping chain ends at the draft that would
 * revisit one already passed.
 *
 * @param id the id a card names
 * @param items the register
 * @returns the live cut and the dropped cuts before it, named first, or `undefined` when the register holds no such id
 */
export function liveCutOf({
  id,
  items,
}: {
  id: string;
  items: readonly ParkedDraft[];
}): { readonly live: ParkedDraft; readonly superseded: readonly ParkedDraft[] } | undefined {
  let current = items.find((item) => item.id === id);
  if (current === undefined) {
    return undefined;
  }
  const superseded: ParkedDraft[] = [];
  const passed = new Set<string>([current.id]);
  for (;;) {
    const next = successorOf({ draft: current, posts: items });
    if (next === undefined || passed.has(next.id)) {
      return { live: current, superseded };
    }
    superseded.push(current);
    passed.add(next.id);
    current = next;
  }
}

/**
 * Every dropped cut whose re-cut chain ends on one draft — {@link liveCutOf} read backwards, so the cut that stands
 * answers to each id it replaced. A call's frozen reading opened a draft id half an hour after it was re-cut, and the console,
 * which has read the re-cut, would draw "gone".
 *
 * @param id the draft the chains must end on
 * @param items the register
 * @returns the dropped cuts' ids, in register order, each once, never `id` itself
 */
export function droppedCutIdsEndingAt({ id, items }: { id: string; items: readonly ParkedDraft[] }): readonly string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.state !== "dropped" || item.id === id) {
      continue;
    }
    if (liveCutOf({ id: item.id, items })?.live.id === id) {
      ids.add(item.id);
    }
  }
  return [...ids];
}
