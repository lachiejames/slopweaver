/**
 * Each live board row's fact in the ONE order the owner's Queue, the voice and reconcile lead with (`../waiting/queueOrder.ts`),
 * read off the board as the Queue reads its cards (`site/lib/queueFocus.ts` `queueFactOf`, `site/lib/queueStopping.ts`
 * `stoppingKeys`), so a row waiting on the owner ranks here where its card ranks there.
 *
 * - **blocker**: named in the `blockedBy:` of an open row carrying one of the owner's priorities' `workstream=` tag, its tags
 *   read whole — by the highest such priority. Direct only, as the Queue's. The Queue also asks that the blocked row
 *   wait on the owner, since only those are cards; here a fleet row blocking a priority is the work to seat first, so it
 *   ranks as a blocker either way.
 * - **priority**: a row carrying one of those tags, read whole — by that priority, then its `priority=` band, then its
 *   `controls-resolved=` count. A row the owner put off on the Queue (`queue defer`) is not one: the Queue draws a deferred
 *   card in its last section, never among the priorities' (`site/lib/queueFocus.ts` `focusRankOf`). A blocker put
 *   off stays a blocker, as its card stays lifted there.
 * - **rest**: every other row. A stopped automation is a hand step, never a board row, so nothing here is `stopped`.
 *
 * Inside the rest band reconcile keeps the board's own order (band, landing, age) where the Queue keeps tier then
 * question age: the rule leaves a band's order to its caller, and the owner's ruling fixes the head.
 *
 * The boundary, stated rather than chased: these facts are what the board and the deferral ledger say. A
 * card the Queue moves to check-in on the owner's reply (`site/lib/cardCurrencyMark.ts`), an ask it absorbs into a hand card
 * (`site/lib/queueRows.ts`) and two docs sharing a slug are site-only overlays, so on those rows the Queue's order is
 * the one the owner reads and this one can differ.
 *
 * Pure: composed rows and the owner's priorities in, facts out.
 */
import type { QueueFact } from "../waiting/queueOrder.js";
import { isClosedBoardSection } from "./boardRefusal.js";
import type { BoardModel } from "./boardTypes.js";
import type { HandoverDoc } from "./doc.js";
import { BOARD_PRIORITIES } from "./rowKind.js";

/** A whole count, as the `controls-resolved=` tag's closed registry spells one (`./rowTags.ts`). */
const COUNT = /^(?:0|[1-9][0-9]*)$/u;

/** One composed row, as the facts read it: of its doc, only the slug and what it waits behind. */
type FactModel = Pick<BoardModel, "section" | "tags" | "tagsIncomplete"> & {
  readonly doc: Pick<HandoverDoc, "blockedBy" | "slug">;
};

/**
 * The rank of the highest priority a row carries the tag of, read whole; `undefined` for a row in none.
 *
 * @returns the rank, 0 first, or `undefined`
 */
function priorityRankOf({
  model,
  priorities,
}: {
  model: FactModel;
  priorities: readonly string[];
}): number | undefined {
  if (model.tagsIncomplete) {
    return undefined;
  }
  const values = new Set(model.tags.tags.filter((tag) => tag.key === "workstream").map((tag) => tag.value));
  const at = priorities.findIndex((value) => values.has(value));
  return at === -1 ? undefined : at;
}

/**
 * Every live row's fact, keyed by its slug. A slug two docs claim takes the first's — the board's existing
 * duplicate-slug residue (`../cli/commands/handover/reconcileRows.ts`), never a second resolution here.
 *
 * @param models the composed board
 * @param priorities the owner's priorities' `workstream=` values, the first priority first (`../workstreams/queuePriorities.ts`)
 * @param deferred the slugs of the asks the owner has put off on the Queue and not restored
 * @returns each live row's fact; a row absent from it ranks with the rest
 */
export function boardQueueFacts({
  deferred,
  models,
  priorities,
}: {
  deferred: ReadonlySet<string>;
  models: readonly FactModel[];
  priorities: readonly string[];
}): ReadonlyMap<string, QueueFact> {
  const live = models.filter((model) => !isClosedBoardSection({ section: model.section }));
  const blocks = blockedRanks({ live, priorities });
  const facts = new Map<string, QueueFact>();
  for (const model of live) {
    const { slug } = model.doc;
    if (facts.has(slug)) {
      continue;
    }
    const blocked = blocks.get(slug);
    if (blocked !== undefined) {
      facts.set(slug, { band: "blocker", priorityRank: blocked });
      continue;
    }
    const fact = priorityFactOf({ model, priorities });
    if (fact !== undefined && !deferred.has(slug)) {
      facts.set(slug, fact);
    }
  }
  return facts;
}

/**
 * Each slug a priority's live row waits behind, by the highest priority it blocks.
 *
 * @param live the open rows
 * @returns the blocked priority's rank, 0 first, by the blocking slug
 */
function blockedRanks({
  live,
  priorities,
}: {
  live: readonly FactModel[];
  priorities: readonly string[];
}): ReadonlyMap<string, number> {
  const blocks = new Map<string, number>();
  for (const model of live) {
    const rank = priorityRankOf({ model, priorities });
    if (rank === undefined) {
      continue;
    }
    for (const slug of model.doc.blockedBy) {
      const seen = blocks.get(slug);
      if (seen === undefined || rank < seen) {
        blocks.set(slug, rank);
      }
    }
  }
  return blocks;
}

/**
 * A row's priority fact: its priority's rank, its `priority=` band and its `controls-resolved=` count.
 *
 * @returns the fact, or `undefined` for a row in none of the owner's priorities
 */
function priorityFactOf({
  model,
  priorities,
}: {
  model: FactModel;
  priorities: readonly string[];
}): QueueFact | undefined {
  const priorityRank = priorityRankOf({ model, priorities });
  if (priorityRank === undefined) {
    return undefined;
  }
  const band = model.tags.tags.find((tag) => tag.key === "priority")?.value;
  const controls = model.tags.tags.find((tag) => tag.key === "controls-resolved")?.value;
  const boardBand = BOARD_PRIORITIES.findIndex((priority) => priority === band);
  const counted = controls !== undefined && COUNT.test(controls);
  return {
    band: "priority",
    priorityRank,
    ...(boardBand === -1 ? {} : { boardBand }),
    ...(counted ? { controlsResolved: Number(controls) } : {}),
  };
}
