/**
 * ONE ranked list over the whole board — planned work, the owner's own asks, and the Slack tags waiting on a
 * reply, in the order they should be picked up.
 *
 * ## Why the board needed an order at all
 *
 * It had sections and no ranking. `RUN NOW` printed 119 rows in alphabetical order on the day this was
 * written, which is not a priority list; it is an inventory. That was survivable while everything on it was
 * planned work of roughly equal standing, and stopped being survivable the moment a tag someone is waiting
 * on in a thread had to sit on the same board as a refactor nobody is waiting on at all.
 *
 * ## The ordering, and what each level is actually for
 *
 * Priority band first ({@link ../rowKind.ts}'s `p0`..`p3`, defaulted by kind so a tag outranks doc work
 * without anyone having to type it), then — within `p1` only — the owner's landing rows ahead of other asks
 * ({@link isOwnerPrHygieneRow}), then a row carrying the owner's RULING ahead of one never ruled on
 * ({@link BoardRow.ruled}), then AGE within a band, oldest first. Age is the level that carries the
 * measurement this whole feature came from: the owner's stuck-chat ask was restated nine times over thirteen hours,
 * so a register that ranked the owner's asks by anything other than how long they have been sitting would reproduce
 * the failure with more ceremony. A row with no age at all — an ordinary doc, which records no `askedIso` —
 * sorts after every aged row in its band, then by slug, which is stable and reproducible.
 *
 * Pure: rows in, rows out. No filesystem, no clock — `nowIso` is passed in.
 */

import { absentAs } from "#lib/absent.js";
import { isLandingRegistrationSlug } from "../review/boardAtHead.js";
import { type QueueFact, rankQueue } from "../waiting/queueOrder.js";
import type { HandoverDoc } from "./doc.js";
import { type BoardPriority, type BoardRowKind, effectivePriority, priorityIndex } from "./rowKind.js";
import type { RowStanding } from "./rowStanding.js";

/** One row on the consolidated board, whatever kind of thing it is. */
export interface BoardRow {
  readonly kind: BoardRowKind;
  /** The stable identifier: a doc/ask slug, or a tag's `channel/messageTs` key. */
  readonly id: string;
  /** One line saying what it is, for a reader scanning the ranked list. */
  readonly label: string;
  readonly priority: BoardPriority;
  /** When this row started waiting, when that is knowable. Absent for an ordinary doc row. */
  readonly openedIso: string | undefined;
  /** How long it has been waiting, in whole hours. Zero for a row with no `openedIso`. */
  readonly waitingHours: number;
  /**
   * Whether this row's POSITION means anything — the distinction that keeps the reconciliation honest.
   *
   * A row is groomed when somebody stated where it sits: it declared a `priority:`, or it carries the moment
   * it started waiting (which every tag and every ask does, and no ordinary doc does). A row with neither is
   * in the ranked list only because it has to be somewhere, and its neighbours are alphabetical.
   *
   * Measured on the live board the day this landed: 281 rows, of which zero declared a priority. Ranking them
   * anyway produced a "top 5" that was the first five slugs in the alphabet, and a reconciliation built on
   * that would have reported five starving top rows and fifteen misaligned sessions — every one of them an
   * artefact of sorting. `../reconcile.ts` reports the ungroomed COUNT instead, which is the true finding: the
   * board cannot say what matters most until somebody says.
   */
  readonly groomed: boolean;
  /**
   * Whether the owner has RULED on this live row — `handover rule` recorded their decision and nothing has settled it.
   *
   * A ruling is a decision already made, so the work left is applying it, and nothing else on the board is
   * that. MEASURED: a "keep posting into this channel" ruling on
   * `approve-proj-dependencies-channel-for-nightly-bump-posts` sat 19 days with the recipe it ruled on still
   * posting to the owner's DM, ranked by age among fleet findings the owner had never seen. A later board had
   * 156 live rows carrying a ruling, 47 of them ready — `slopweaver handover reconcile --json | jq '[(.ready + .held)[] | select(.ruled)]
   * | length'`. It is NOT grooming: a ruling says what the owner decided, never where the row sits, so a
   * ruled row the owner never placed stays ungroomed. Always `false` on a projected tag, which no ruling can reach.
   */
  readonly ruled: boolean;
  /**
   * WHERE this row stands — see {@link ./rowStanding.ts}, which carries why a boolean could not.
   *
   * A ranked row is not automatically available work: most of the board is in flight, paused, waiting on the
   * owner or blocked behind a dependency, and a reader deciding what to do next has to tell those apart
   * rather than only tell `ready` from everything else.
   */
  readonly standing: RowStanding;
  /**
   * Whether this row could be PICKED UP right now — DERIVED from {@link BoardRow.standing}, never declared
   * beside it.
   *
   * `../supervisor/outcomes/coverage.ts` reports the rows under one of the owner's kept outcomes that nobody is
   * on, and without this it would report every row in flight as unattended — a number that would be wrong
   * every tick and therefore ignored, which is the fate `./reconcile.ts`'s own header describes for the
   * first version of that verb. It stays a FIELD rather than a call because it crosses a JSON boundary into
   * the docs site, and it is computed in exactly the two builders below, so the two cannot disagree.
   */
  readonly ready: boolean;
}

/** How many whole hours separate two instants, floored at zero, or zero when either is unreadable. */
function hoursBetween({ fromIso, nowIso }: { fromIso: string; nowIso: string }): number {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now)) {
    return 0;
  }
  return Math.max(0, Math.floor((now - from) / 3_600_000));
}

/**
 * Turn one authored doc or ask into a board row.
 *
 * @param doc the parsed row
 * @param nowIso the instant to measure waiting against
 * @param standing where the board's composed section puts this row
 * @param ruled whether the row's derived state carries the owner's ruling — its caller reads it off the journal, which
 *   this pure builder never opens
 * @returns the row, ranked by its declared priority or its kind's default
 */
export function rowOfDoc({
  doc,
  nowIso,
  ruled,
  standing,
}: {
  doc: HandoverDoc;
  nowIso: string;
  ruled: boolean;
  standing: RowStanding;
}): BoardRow {
  const openedIso = doc.kind === "ask" ? doc.askedIso : undefined;
  return {
    // A backfilled kind default is written down, never chosen, so it grooms nothing (`priorityFrom`, `./doc.ts`).
    groomed: (doc.priority !== undefined && doc.priorityFrom === undefined) || openedIso !== undefined,
    ready: standing === "ready",
    ruled,
    standing,
    id: doc.slug,
    kind: doc.kind,
    label: absentAs({ value: doc.summary, whenAbsent: doc.slug }),
    openedIso,
    priority: effectivePriority({ declared: doc.priority, kind: doc.kind }),
    waitingHours: openedIso === undefined ? 0 : hoursBetween({ fromIso: openedIso, nowIso }),
  };
}

/**
 * One unanswered Slack tag, as the ask-lifecycle stream reports it — the projection, never a file.
 *
 * @internal — the input shape {@link rowOfTag} takes; its CLI edge builds one and names nothing else.
 */
export interface TagRowInput {
  /** The lifecycle key, `channel/messageTs`. */
  readonly id: string;
  /** The Slack user who tagged the bot. */
  readonly userId: string;
  /** The lifecycle state that makes it still active. */
  readonly state: string;
  /** When it was captured. */
  readonly capturedIso: string | undefined;
}

/**
 * Turn one active Slack tag into a board row.
 *
 * A tag carries no declared priority because there is nowhere to declare one — it is projected from a stream
 * nobody hand-edits — so it always ranks at its kind's default. That is the mechanical half of "a tag
 * generally outranks doc work": it is not advice a session can forget to follow.
 *
 * @param tag the active ask as the lifecycle reports it
 * @param nowIso the instant to measure waiting against
 * @returns the row
 */
export function rowOfTag({ tag, nowIso }: { tag: TagRowInput; nowIso: string }): BoardRow {
  return {
    groomed: tag.capturedIso !== undefined,
    // A tag is projected from the lifecycle stream precisely because it is still ACTIVE: somebody is waiting
    // in a thread. There is no shape in which one of these rows is not available work.
    ready: true,
    ruled: false,
    standing: "ready",
    id: tag.id,
    kind: "tag",
    label: `Slack tag from ${tag.userId} (${tag.state})`,
    openedIso: tag.capturedIso,
    priority: effectivePriority({ declared: undefined, kind: "tag" }),
    waitingHours: tag.capturedIso === undefined ? 0 : hoursBetween({ fromIso: tag.capturedIso, nowIso }),
  };
}

/**
 * Whether a row is landing work on one of the OWNER's pull requests — a `p1` ask the landing register filed.
 *
 * **The producer is the invariant.** A board row does not record a pull request's author, so this reads the
 * slug's exact grammar ({@link isLandingRegistrationSlug}) and relies on the one producer that writes it:
 * the supervisor pass's `github landing --author @me --register`
 * (`skills/supervisor/reference/sweep-contract.md`). A caller registering another author's pull requests
 * would be ranked as the owner's; the fix then is provenance recorded on the row, never a guess from branch text.
 *
 * `p1` only, so a declared `p0` landing row keeps its own band and every `p0` Slack tag stays ahead.
 *
 * @param row the board row
 * @returns whether it is the owner's landing work at the default ask band
 */
export function isOwnerPrHygieneRow({ row }: { row: BoardRow }): boolean {
  return row.kind === "ask" && row.priority === "p1" && isLandingRegistrationSlug({ slug: row.id });
}

/**
 * Rank every row: priority band first, then the owner's landing work within `p1`, then a row the owner ruled on
 * ahead of one they did not, then groomed rows ahead of ungroomed ones, then longest-waiting, then slug.
 *
 * The ruled level ({@link BoardRow.ruled}) sits INSIDE the band and below landing on purpose. A band is the owner's
 * own placement — about a hundred rows parked at `p3` sit below the owner's two priorities — so a ruling
 * on one of them must not override that, and a ready pull request of the owner's still waits on nothing but a seat. What
 * it does override is age: an unruled fleet finding asked earlier no longer queues ahead of a decision the owner made.
 *
 * The groomed level sits ABOVE waiting time on purpose. A doc whose author declared `p2` and an untouched doc
 * that merely defaulted to `p2` both carry zero waiting hours, so without it the two would be separated by
 * nothing but the alphabet — and the declared one is the only one anybody has actually placed.
 *
 * The landing level ({@link isOwnerPrHygieneRow}) sits below the band and above everything else in it: a
 * ready pull request of the owner's waits on nothing but a seat, and as an ordinary `p1` ask it queued behind older
 * asks by age alone. Between two landing rows, and between two rows that are not, the order is unchanged.
 *
 * **The owner's priorities come before all of it** when the caller states them: that order runs through the ONE
 * order the owner's Queue and the voice lead with (`../waiting/queueOrder.ts`), so a row blocking one of the
 * priorities leads, then the priorities' own rows, then everything else in the order above. The board is re-ranked so
 * no stale `p1` outranks a top priority. With no facts stated the order is the one above alone.
 *
 * **A row the owner put off on the Queue goes last**, earliest put off first, as its card does
 * (`site/lib/cardDeferrals.ts` `deferredLast`) — unless it blocks one of the owner's priorities, whose card the
 * Queue keeps lifted.
 *
 * @param rows the rows to order
 * @param facts each row's place in the one order, by id (`./queueFacts.ts`); a row absent from it ranks with the rest
 * @param deferred when each row the owner put off on the Queue was put off, by id
 * @returns a new array, most urgent first
 */
export function rankRows({
  rows,
  facts,
  deferred,
}: {
  rows: readonly BoardRow[];
  facts?: ReadonlyMap<string, QueueFact>;
  deferred?: ReadonlyMap<string, string>;
}): readonly BoardRow[] {
  const ordered = boardOrder({ rows });
  if (facts === undefined) {
    return ordered;
  }
  const factOf = (row: BoardRow): QueueFact => {
    const fact = facts.get(row.id);
    if (fact === undefined) {
      return { band: "rest" };
    }
    return fact;
  };
  const ranked = rankQueue({ factOf, items: ordered });
  if (deferred === undefined) {
    return ranked;
  }
  const putOff = (row: BoardRow): boolean => deferred.has(row.id) && factOf(row).band !== "blocker";
  const later = ranked
    .filter((row) => putOff(row))
    .toSorted((left, right) => deferred.get(left.id)!.localeCompare(deferred.get(right.id)!));
  if (later.length === 0) {
    return ranked;
  }
  return [...ranked.filter((row) => !putOff(row)), ...later];
}

/**
 * The board's own order: band, landing, ruled, groomed, waiting time, slug — {@link rankRows} without the owner's priorities.
 *
 * @returns a new array, most urgent first
 */
function boardOrder({ rows }: { rows: readonly BoardRow[] }): readonly BoardRow[] {
  return rows.toSorted((left, right) => {
    const band = priorityIndex({ priority: left.priority }) - priorityIndex({ priority: right.priority });
    if (band !== 0) {
      return band;
    }
    const leftLanding = isOwnerPrHygieneRow({ row: left });
    if (leftLanding !== isOwnerPrHygieneRow({ row: right })) {
      return leftLanding ? -1 : 1;
    }
    if (left.ruled !== right.ruled) {
      return left.ruled ? -1 : 1;
    }
    if (left.groomed !== right.groomed) {
      return left.groomed ? -1 : 1;
    }
    const waiting = right.waitingHours - left.waitingHours;
    if (waiting !== 0) {
      return waiting;
    }
    return left.id.localeCompare(right.id);
  });
}

/**
 * Where one row sits in a ranked list, 1-based.
 *
 * @param id the row's identifier
 * @param ranked the ranked list to look in
 * @returns its 1-based position, or `undefined` when the list does not hold it
 */
export function rankOf({ id, ranked }: { id: string; ranked: readonly BoardRow[] }): number | undefined {
  const index = ranked.findIndex((row) => row.id === id);
  return index === -1 ? undefined : index + 1;
}
