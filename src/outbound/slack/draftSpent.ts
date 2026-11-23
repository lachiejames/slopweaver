/**
 * When a parked as-me draft is SPENT beyond its own row: another row carrying the same message.
 *
 * A finding once reached #defects twice under the owner's name, because an older cut of it was still there to be
 * sent after the newer one landed, so a repeat is made structurally impossible.
 * A row's own state already refuses a second release of THAT row (`./draftRegister.ts`'s `slackDraftById`),
 * but a re-record mints a NEW id over the same message and nothing compared the two. Three rules close it:
 *
 * - **A re-cut names what it replaces.** `slack draft record --supersedes <id>` refuses unless that row is
 *   still held ({@link supersedeRefusal}), then drops it in the same act, so the older cut is spent on record.
 * - **A release spends every other held cut the register records as the same message.** {@link heldCutsOf} is the
 *   same author, the same place, and the same words or the same opening line (`./repeatMatch.ts`'s identity, the one
 *   the transport guard reads); of those, a cut with the same digest or a recorded re-cut lineage is dropped naming
 *   the released row, and one sharing only the opening line is kept held and named ({@link releaseSpendsCuts}).
 * - **A second release of the same digest refuses**, naming where the first landed ({@link releasedTwinOf}).
 *
 * Words that differ past the first line and were never recorded as a cut pass here; the transport's own
 * read of the place (`../../corpus/slack/writeGuardRepeat.ts`) refuses those at the wire. Pure: rows in.
 */
import { type ParkedSlackDraft, type SlackDraftItem, slackDraftById } from "./draftRegister.js";
import { repeatIdentity, repeatTextOf } from "./repeatMatch.js";

/**
 * The released row that already carries this draft's message, or `undefined` when none does.
 *
 * @param draft the held row about to be released
 * @param items every folded row
 * @returns the earliest-released twin
 */
export function releasedTwinOf({
  draft,
  items,
}: {
  draft: SlackDraftItem;
  items: readonly SlackDraftItem[];
}): SlackDraftItem | undefined {
  const twins = items.filter(
    (item) => item.id !== draft.id && item.state === "released" && item.draft.digest === draft.draft.digest,
  );
  // A released row always carries its release instant (`foldSlackDrafts`).
  return twins.toSorted((left, right) => left.resolvedIso!.localeCompare(right.resolvedIso!))[0];
}

/**
 * Why a `--supersedes` target cannot be superseded, or `undefined` when it is a held row.
 *
 * @param id the row `--supersedes` names
 * @param items every folded row
 * @returns the refusal, naming where a spent target went
 */
export function supersedeRefusal({ id, items }: { id: string; items: readonly SlackDraftItem[] }): string | undefined {
  const found = slackDraftById({ id, items, mustBeHeld: true });
  if (found.isOk()) {
    return undefined;
  }
  return `--supersedes ${id}: ${found.error.message} — nothing was parked. Name the cut that is still held.`;
}

/** Whether two rows go to the same place under the same identity. */
function samePlace({ left, right }: { left: ParkedSlackDraft; right: ParkedSlackDraft }): boolean {
  return left.channel === right.channel && left.threadTs === right.threadTs && left.authorId === right.authorId;
}

/**
 * Every OTHER held row that is a cut of the message this row carries: the same author and place, and the same
 * normalised words or the same counted first line.
 *
 * @param draft the row being released
 * @param items every folded row
 * @returns the held cuts a release spends, oldest first
 */
export function heldCutsOf({
  draft,
  items,
}: {
  draft: SlackDraftItem;
  items: readonly SlackDraftItem[];
}): readonly SlackDraftItem[] {
  const text = repeatTextOf({ message: draft.draft.payload });
  if (text === undefined) {
    return [];
  }
  const mine = repeatIdentity({ text });
  return items
    .filter((item) => {
      if (item.id === draft.id || item.state !== "held" || !samePlace({ left: item.draft, right: draft.draft })) {
        return false;
      }
      const theirs = repeatTextOf({ message: item.draft.payload });
      if (theirs === undefined) {
        return false;
      }
      const other = repeatIdentity({ text: theirs });
      const sameOpening = mine.firstLineCounts && other.firstLineCounts && mine.firstLine === other.firstLine;
      return other.digest === mine.digest || sameOpening;
    })
    .toSorted((left, right) => left.draft.tsIso.localeCompare(right.draft.tsIso));
}

/**
 * Whether the register RECORDS that `carrier` holds `row`'s message: the same digest — the same words, place and
 * identity — or a lineage of re-cuts back to it, each hop a `--supersedes` the carrier's park names (`recuts`) or a yes
 * inherited from it (`approval.inheritedFrom`). A shared opening line is resemblance, not record: two separate updates
 * can open alike, and declaring one sent because the other was would end the owner's yes to it unsent.
 *
 * @param carrier the cut that would stand for the row — held or released
 * @param row the row whose words it would carry
 * @param items every folded row, for the lineage walk
 * @returns true when the register records the carrier as this row's message
 */
export function recordedCutOf({
  carrier,
  items,
  row,
}: {
  carrier: SlackDraftItem;
  items: readonly SlackDraftItem[];
  row: SlackDraftItem;
}): boolean {
  if (carrier.draft.digest === row.draft.digest) {
    return true;
  }
  return draftAncestorIds({ item: carrier, items }).includes(row.id);
}

/**
 * Every row id a cut descends from, through the hops {@link recordedCutOf} reads — each `--supersedes` its park names
 * (`recuts`) and the row its yes was inherited from — transitively, each once, nearest first. A named parent the
 * register does not hold is listed but not walked past; a cycle ends where it closes.
 *
 * @param item the cut to walk up from
 * @param items every folded row
 * @returns its ancestors' ids, never its own
 */
export function draftAncestorIds({
  item,
  items,
}: {
  item: SlackDraftItem;
  items: readonly SlackDraftItem[];
}): readonly string[] {
  const byId = new Map(items.map((one) => [one.id, one] as const));
  const seen = new Set<string>([item.id]);
  const ancestors: string[] = [];
  const frontier: SlackDraftItem[] = [item];
  for (let next = frontier.shift(); next !== undefined; next = frontier.shift()) {
    for (const id of parentsOf({ item: next }).filter((parent) => !seen.has(parent))) {
      seen.add(id);
      ancestors.push(id);
      const parent = byId.get(id);
      if (parent !== undefined) {
        frontier.push(parent);
      }
    }
  }
  return ancestors;
}

/**
 * The other held cuts a release spends, and those it leaves held. A cut the register records as this message
 * ({@link recordedCutOf}) is spent; one that only shares the opening line is KEPT, because it may carry the owner's yes, a
 * change of meaning or their words landed on its card, and dropping it as sent would end that unsent with no reason
 * in front of them. A kept cut cannot double-post: the transport's repeat read refuses it at the wire,
 * and retiring it is a `slack draft drop`, whose guard reads all three.
 *
 * @param draft the row being released
 * @param items every folded row
 * @returns the cuts to spend once it lands, and the cuts kept held, each oldest first
 */
export function releaseSpendsCuts({ draft, items }: { draft: SlackDraftItem; items: readonly SlackDraftItem[] }): {
  readonly spend: readonly SlackDraftItem[];
  readonly kept: readonly SlackDraftItem[];
} {
  const cuts = heldCutsOf({ draft, items });
  const recorded = (cut: SlackDraftItem): boolean => recordedCutOf({ carrier: draft, items, row: cut });
  return { kept: cuts.filter((cut) => !recorded(cut)), spend: cuts.filter((cut) => recorded(cut)) };
}

/**
 * What a release prints for a held cut it keeps: why it was not spent, and the guarded drop that retires it.
 *
 * @param id the row being released
 * @param kept the held cut that only opens like it
 * @returns one line
 */
export function keptCutNote({ id, kept }: { id: string; kept: string }): string {
  return (
    `kept ${kept} held: it opens like ${id} but nothing on record makes it the same message, so this release does ` +
    `not spend it. The wire refuses it if it repeats; retire it with \`slopweaver slack draft drop ${kept} --note ` +
    `"superseded by ${id}"\`, whose guard reads what it still owes the owner`
  );
}

/** Every row id a park names as a parent: the rows it re-cuts, and the row its yes was inherited from. */
function parentsOf({ item }: { item: SlackDraftItem }): readonly string[] {
  const { approval, recuts } = item.draft;
  const parents = recuts === undefined ? [] : [...recuts];
  if (approval?.inheritedFrom !== undefined) {
    parents.push(approval.inheritedFrom);
  }
  return parents;
}
