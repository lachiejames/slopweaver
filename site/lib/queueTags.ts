/**
 * The tags a Queue card carries, and the `?tag=` filter over them.
 *
 * Everything on localhost is tagged the AWS way, queue items taking the tags of the board row they come from: good
 * filtering options on the queue page rather than saved views. The row tags are specified in `skills/handover/reference/row-tags.md` and defined by
 * `src/handover/rowTags.ts`, and read by `../components/live/read.ts`.
 *
 * - **A card inherits.** It carries the union of the tags of every board row it belongs to, plus the facets its own
 *   record states (a held reply is Slack; a pull request is GitHub, in one repository). Nothing is guessed from text.
 * - **Absence is proven or it is not claimed.** A card's tags read `whole` only when every row it belongs to read
 *   whole. `!key` matches only a whole card, because a row whose tags did not read cannot prove it lacks one.
 * - **The address is the view.** Selectors are repeated `tag` parameters, `key:value` or `!key`: AND across keys,
 *   OR within one. A malformed one is set aside and said aloud, never thrown and never matched.
 * - **Keys are data.** The bar orders the keys it knows first and still draws one it has never seen, so a key the
 *   registry adds reaches the page with no release of this file.
 *
 * Pure: records in, tags and selections out.
 */
import type { CardTag, QueueTags } from "./queueTagsInherited";

/** The query parameter a selector rides in, repeated once per selector. */
export const TAG_PARAM = "tag";

/**
 * Every key the board's closed registry holds (`TAG_KEYS`, `src/handover/rowTags.ts`), in the order the bar draws
 * them, most useful first. `site/` cannot import `src/`, so this is a copy held equal to the registry by
 * `src/__tests__/unit/handover/queueTagKeysMirror.test.ts`. It is also the address's contract: a selector naming
 * any other key is malformed, shown as ignored, so a typo in a shared link says so rather than drawing an empty Queue
 * that looks like a verdict.
 */
export const TAG_KEY_ORDER: readonly string[] = [
  "workstream",
  "substream",
  "area",
  "impact",
  "priority",
  "controls-resolved",
  "effort",
  "platform",
  "needs",
  "audience",
  "context",
  "repo",
  "run",
  "kind",
  "reply",
  "origin",
  "pr",
  "preapproved",
  "steer-hatch",
];

/** One key's selectors: the values any of which satisfies it, and whether a card missing the key does too. */
export interface TagGroup {
  readonly key: string;
  readonly values: readonly string[];
  readonly missing: boolean;
}

/** What the address asks for: one group per key, and every selector that did not parse, verbatim. */
export interface TagSelection {
  readonly groups: readonly TagGroup[];
  readonly malformed: readonly string[];
}

/** A key as the registry spells one: lowercase, kebab-case. */
const KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/** One selector, parsed: a value of a key, or the key's absence. */
type Selector = { readonly key: string; readonly value: string } | { readonly key: string; readonly missing: true };

/**
 * One `tag` parameter read as a selector, or `undefined` when it is not one — a key outside the registry included.
 *
 * @returns the selector
 */
function selectorOf({ text }: { text: string }): Selector | undefined {
  if (text.startsWith("!")) {
    const key = text.slice(1);
    if (!KEY.test(key) || !TAG_KEY_ORDER.includes(key)) {
      return undefined;
    }
    return { key, missing: true };
  }
  const at = text.indexOf(":");
  if (at <= 0) {
    return undefined;
  }
  const key = text.slice(0, at);
  const value = text.slice(at + 1);
  if (!KEY.test(key) || !TAG_KEY_ORDER.includes(key) || value === "" || value.trim() !== value) {
    return undefined;
  }
  return { key, value };
}

/**
 * Read every repeated `tag` parameter into one selection. Total: a selector that does not parse is kept in
 * `malformed` for the page to name, and matches nothing.
 *
 * @param values every `tag` parameter, in address order
 * @returns the selection
 */
export function parseTagParams({ values }: { values: readonly string[] }): TagSelection {
  const groups: { key: string; values: string[]; missing: boolean }[] = [];
  const malformed: string[] = [];
  for (const text of values) {
    const selector = selectorOf({ text });
    if (selector === undefined) {
      if (!malformed.includes(text)) {
        malformed.push(text);
      }
      continue;
    }
    let group = groups.find((each) => each.key === selector.key);
    if (group === undefined) {
      group = { key: selector.key, missing: false, values: [] };
      groups.push(group);
    }
    if ("missing" in selector) {
      group.missing = true;
    } else if (!group.values.includes(selector.value)) {
      group.values.push(selector.value);
    }
  }
  return { groups, malformed };
}

/**
 * Whether a card satisfies a selection: every key's group, each by any of its values or by lacking the key when the
 * group allows that. A filter claims only a card whose tags read WHOLE: a partial card's tags may be stale (a journal
 * line that did not decode may have removed one) or lent by the wrong row, so a value it carries proves no more than
 * a value it lacks. The bar counts such cards apart ({@link tagSummary}), so they are hidden and said, never silent.
 *
 * @returns true when the card is shown
 */
export function matchesTags({ card, selection }: { card: QueueTags; selection: TagSelection }): boolean {
  if (selection.groups.length === 0) {
    return true;
  }
  if (card.tagsRead !== "whole") {
    return false;
  }
  return selection.groups.every((group) => {
    const values = card.tags.filter((tag) => tag.key === group.key).map((tag) => tag.value);
    return group.values.some((value) => values.includes(value)) || (group.missing && values.length === 0);
  });
}

/** One value the bar offers under a key, with how many cards carry it. */
export interface FacetValue {
  readonly value: string;
  readonly count: number;
}

/** One key the bar offers: its values, and how many whole cards provably lack it. */
export interface Facet {
  readonly key: string;
  readonly values: readonly FacetValue[];
  readonly missing: number;
}

/**
 * The keys present on the cards whose tags read whole, each with its values counted by CARD and the cards provably
 * lacking it, in the bar's order: {@link TAG_KEY_ORDER} first, any other key after it alphabetically. Only a whole
 * card can be claimed ({@link matchesTags}), so a count that included the rest would promise cards a pick never shows.
 *
 * @returns the facets
 */
export function tagFacets({ cards: every }: { cards: readonly QueueTags[] }): readonly Facet[] {
  const cards = every.filter((card) => card.tagsRead === "whole");
  const keys = new Set(cards.flatMap((card) => card.tags.map((tag) => tag.key)));
  const known = TAG_KEY_ORDER.filter((key) => keys.has(key));
  const unknown = [...keys].filter((key) => !TAG_KEY_ORDER.includes(key)).toSorted();
  return [...known, ...unknown].map((key) => {
    const counts = new Map<string, number>();
    let missing = 0;
    for (const card of cards) {
      const values = card.tags.filter((tag) => tag.key === key).map((tag) => tag.value);
      if (values.length === 0) {
        missing += 1;
      }
      for (const value of new Set(values)) {
        const was = counts.get(value);
        counts.set(value, was === undefined ? 1 : was + 1);
      }
    }
    const values = [...counts]
      .map(([value, count]) => ({ count, value }))
      .toSorted((left, right) => right.count - left.count || left.value.localeCompare(right.value));
    return { key, missing, values };
  });
}

/** What a filter leaves unsaid unless the page says it: how many it hides, and what the cards could not tell it. */
export interface TagSummary {
  /** Cards the selection hides. */
  readonly hidden: number;
  /** Cards whose tags read whole and hold none at all. */
  readonly untagged: number;
  /** Cards whose inherited tags did not wholly read — unpublished, partial, or a board not read yet. */
  readonly incomplete: number;
}

/**
 * Count what the bar has to say about a set of cards under a selection.
 *
 * @returns the summary
 */
export function tagSummary({ cards, selection }: { cards: readonly QueueTags[]; selection: TagSelection }): TagSummary {
  let hidden = 0;
  let untagged = 0;
  let incomplete = 0;
  for (const card of cards) {
    if (!matchesTags({ card, selection })) {
      hidden += 1;
    }
    if (card.tagsRead !== "whole") {
      incomplete += 1;
    } else if (card.tags.length === 0) {
      untagged += 1;
    }
  }
  return { hidden, incomplete, untagged };
}

/**
 * A selector as the address spells it.
 *
 * @returns `key:value`, or `!key` for the key's absence
 */
export function selectorText({ key, value }: { key: string; value: string | undefined }): string {
  if (value === undefined) {
    return `!${key}`;
  }
  return `${key}:${value}`;
}

/**
 * Turn one selector on or off in a query string, keeping every other parameter — and every other `tag`, malformed
 * ones included — exactly as it was.
 *
 * @param search the current query string, with or without its `?`
 * @param selector the selector as the address spells it ({@link selectorText})
 * @param on whether the selector should be present afterwards
 * @returns the new query string, `?`-prefixed, or `""` when nothing is left
 */
export function withTagSelector({ search, selector, on }: { search: string; selector: string; on: boolean }): string {
  const params = new URLSearchParams(search);
  const kept = params.getAll(TAG_PARAM).filter((each) => each !== selector);
  params.delete(TAG_PARAM);
  for (const each of kept) {
    params.append(TAG_PARAM, each);
  }
  if (on) {
    params.append(TAG_PARAM, selector);
  }
  return queryOf({ params });
}

/**
 * Drop every `tag` parameter from a query string, keeping everything else.
 *
 * @returns the new query string, `?`-prefixed, or `""` when nothing is left
 */
export function withoutTags({ search }: { search: string }): string {
  const params = new URLSearchParams(search);
  params.delete(TAG_PARAM);
  return queryOf({ params });
}

/**
 * The Queue filtered to one workstream: the address's tag selection REPLACED by exactly `workstream:<name>`, the
 * opened card closed, every other parameter (the context, the sidebar) kept.
 *
 * @param search the current query string
 * @param workstream the workstream's name, as its tag spells it
 * @returns the href
 */
export function workstreamHref({ search, workstream }: { search: string; workstream: string }): string {
  return tagHref({ search, tag: { key: "workstream", value: workstream } });
}

/**
 * The Queue filtered to one tag: the address's tag selection REPLACED by exactly `key:value`, the opened card closed,
 * every other parameter (the context, the sidebar) kept. What a card's tag pill links to.
 *
 * @param search the current query string
 * @param tag the tag to filter by, as the card carries it
 * @returns the href
 */
export function tagHref({ search, tag }: { search: string; tag: CardTag }): string {
  const params = new URLSearchParams(search);
  params.delete(TAG_PARAM);
  params.delete("open");
  params.append(TAG_PARAM, selectorText({ key: tag.key, value: tag.value }));
  return `/queue${queryOf({ params })}`;
}

/**
 * A parameter set as a query string.
 *
 * @returns `?`-prefixed, or `""` when empty
 */
function queryOf({ params }: { params: URLSearchParams }): string {
  const query = params.toString();
  if (query === "") {
    return "";
  }
  return `?${query}`;
}
