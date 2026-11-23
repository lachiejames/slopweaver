/**
 * What the Workstreams page shows of the verb's document: the context's half, narrowed by the key-value filters in
 * the address, with the hero numbers counted over what the context shows.
 *
 * Acme workstreams never show under the Slopweaver context; the status chips are key-value filters that are easy to
 * query — dropdowns for the blocked ones, the in-progress ones, all of them, with everything shown by default; and a
 * hero number stays only if it can be clicked and says which workstreams it counts and why. Pure, so the unit lane
 * holds every rule here; the page only draws what these return.
 *
 * The counts are made HERE rather than by the verb, because the verb has no context: a count over the whole
 * register would include the workspace the switcher is hiding.
 */
import type { WorkContext } from "./workContext";
import { placementOf, statedEvidence, type WorkspacePlacement } from "./workspacePlacement";
import { shownInContext } from "./workspacePlacementContext";
import type { LaneView, WorkstreamsView, WorkstreamView } from "./workstreamTiles";

/** The keys the filter bar offers, each one query parameter of the same name. */
export const FILTER_KEYS = ["state", "priority", "initiative", "tag"] as const;

/** One filter key. */
export type FilterKey = (typeof FILTER_KEYS)[number];

/** The chosen value per key; `null` is "all". */
export type WorkstreamFilter = Readonly<Record<FilterKey, string | null>>;

/** Every key at "all". */
export const ALL: WorkstreamFilter = { initiative: null, priority: null, state: null, tag: null };

/** The `state` value meaning every lane at risk at once — "show me the blocked ones". */
export const AT_RISK = "at-risk";

/** The `priority` value for a workstream no steer of the owner's has placed. */
export const NOT_STATED = "not-stated";

/** The `initiative` value for a workstream under none. */
export const NO_INITIATIVE = "none";

/**
 * Where a workstream belongs, from the workspace it states — the same placement every console page filters by.
 *
 * @returns the placement
 */
export function workstreamPlacement({ one }: { one: WorkstreamView }): WorkspacePlacement {
  return placementOf({ evidence: statedEvidence({ workspace: one.workspace }), why: "no workspace stated" });
}

/**
 * The context's half of the workstreams, and how many the other context holds.
 *
 * @returns the shown workstreams in the verb's order, and the hidden count
 */
export function inContext({ workstreams, context }: { workstreams: readonly WorkstreamView[]; context: WorkContext }): {
  readonly shown: readonly WorkstreamView[];
  readonly hidden: number;
} {
  const shown = workstreams.filter((one) => shownInContext({ context, placement: workstreamPlacement({ one }) }));
  return { hidden: workstreams.length - shown.length, shown };
}

/**
 * The filter an address carries. A key it does not carry, or carries empty, is "all".
 *
 * @param search the query string, with or without its leading `?`
 * @returns the filter
 */
export function readFilter({ search }: { search: string }): WorkstreamFilter {
  const params = new URLSearchParams(search);
  const valueOf = ({ key }: { key: FilterKey }): string | null => {
    const value = params.get(key);
    if (value === null || value === "") {
      return null;
    }
    return value;
  };
  return {
    initiative: valueOf({ key: "initiative" }),
    priority: valueOf({ key: "priority" }),
    state: valueOf({ key: "state" }),
    tag: valueOf({ key: "tag" }),
  };
}

/**
 * The query string with one filter key set, or dropped for "all", every other parameter — the context among them
 * — kept in order.
 *
 * @param search the current query string, with or without its leading `?`
 * @param value the key's new value, or `null` for "all"
 * @returns the new query string with its leading `?`, or `""` when nothing is left
 */
export function withFilter({ search, key, value }: { search: string; key: FilterKey; value: string | null }): string {
  const params = new URLSearchParams(search);
  if (value === null) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  const query = params.toString();
  if (query === "") {
    return "";
  }
  return `?${query}`;
}

/** The query parameter naming the workstream whose slide-over is open, the Queue's own `open`. */
export const OPEN = "open";

/**
 * The workstream whose slide-over the address opens, by id.
 *
 * @param search the query string, with or without its leading `?`
 * @returns the id, or `null` when none is open
 */
export function readOpen({ search }: { search: string }): string | null {
  const value = new URLSearchParams(search).get(OPEN);
  if (value === null || value === "") {
    return null;
  }
  return value;
}

/**
 * The query string with a workstream's slide-over opened or closed, every filter and the context kept — unlike the
 * Queue's `panelHref`, which keeps only the view choices it knows, so a filter would drop on opening a card.
 *
 * @param search the current query string, with or without its leading `?`
 * @param open the workstream id to open, or `null` to close
 * @returns the new query string with its leading `?`, or `""` when nothing is left
 */
export function withOpen({ search, open }: { search: string; open: string | null }): string {
  const params = new URLSearchParams(search);
  if (open === null) {
    params.delete(OPEN);
  } else {
    params.set(OPEN, open);
  }
  const query = params.toString();
  if (query === "") {
    return "";
  }
  return `?${query}`;
}

/**
 * Whether a workstream passes every chosen key. A key a kind does not carry (a closing entry's priority) never
 * matches a chosen value, and always passes "all".
 *
 * @returns true when it is shown
 */
export function matchesFilter({ one, filter }: { one: WorkstreamView; filter: WorkstreamFilter }): boolean {
  if (filter.state !== null && !stateMatches({ one, state: filter.state })) {
    return false;
  }
  if (filter.priority !== null && priorityValue({ one }) !== filter.priority) {
    return false;
  }
  if (filter.initiative !== null && initiativeValue({ one }) !== filter.initiative) {
    return false;
  }
  if (filter.tag !== null && !tagsOf({ one }).includes(filter.tag)) {
    return false;
  }
  return true;
}

/**
 * Whether a workstream answers to a `state` value: {@link AT_RISK} takes every lane at risk, any other value is one
 * lane.
 *
 * @returns true when it does
 */
function stateMatches({ one, state }: { one: WorkstreamView; state: string }): boolean {
  if (state === AT_RISK) {
    return one.atRisk;
  }
  return one.lane === state;
}

/**
 * A workstream's `priority` value: its level, {@link NOT_STATED}, or `null` for a kind that carries none.
 *
 * @returns the value
 */
function priorityValue({ one }: { one: WorkstreamView }): string | null {
  if (one.kind === "local" || one.kind === "closing") {
    return null;
  }
  if (one.priority === null) {
    return NOT_STATED;
  }
  return one.priority.level;
}

/**
 * A workstream's `initiative` value: its initiative's id, {@link NO_INITIATIVE}, or `null` for a kind that carries
 * none.
 *
 * @returns the value
 */
function initiativeValue({ one }: { one: WorkstreamView }): string | null {
  if (one.kind === "local" || one.kind === "closing") {
    return null;
  }
  if (one.initiative === null) {
    return NO_INITIATIVE;
  }
  return one.initiative;
}

/**
 * A workstream's tags; none for a kind that carries none.
 *
 * @returns the tags
 */
function tagsOf({ one }: { one: WorkstreamView }): readonly string[] {
  if (one.kind === "local" || one.kind === "closing") {
    return [];
  }
  return one.tags;
}

/** One choice in a filter's dropdown. */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
  /** How many of the context's workstreams it would show, ignoring every other key. */
  readonly count: number;
}

/** One dropdown. */
export interface FilterFacet {
  readonly key: FilterKey;
  readonly label: string;
  readonly options: readonly FilterOption[];
}

/**
 * The dropdowns, each value with how many workstreams carry it, counted over the context's half so the numbers hold
 * still while choosing. A value nothing carries is left out, except a chosen one, which stays so it can be cleared.
 *
 * @param workstreams the context's workstreams, before the filter
 * @returns one facet per key, in {@link FILTER_KEYS} order
 */
export function filterFacets({
  view,
  workstreams,
  filter,
}: {
  view: WorkstreamsView;
  workstreams: readonly WorkstreamView[];
  filter: WorkstreamFilter;
}): readonly FilterFacet[] {
  const keep = ({
    key,
    options,
  }: {
    key: FilterKey;
    options: readonly { value: string; label: string }[];
  }): FilterOption[] => {
    const kept = options
      .map((option) => ({
        ...option,
        count: workstreams.filter((one) => matchesFilter({ filter: { ...ALL, [key]: option.value }, one })).length,
      }))
      .filter((option) => option.count > 0 || filter[key] === option.value);
    // A value from an old link that nothing offers any more stays too, said as such: without it the dropdown would
    // read "all" while the list stood empty, hiding the filter that emptied it.
    const chosen = filter[key];
    if (chosen !== null && !kept.some((option) => option.value === chosen)) {
      kept.push({ count: 0, label: `${chosen} (on no workstream)`, value: chosen });
    }
    return kept;
  };
  const tags = [...new Set(workstreams.flatMap((one) => tagsOf({ one })))].toSorted((a, b) => a.localeCompare(b));
  return [
    {
      key: "state",
      label: "State",
      options: keep({
        key: "state",
        options: [
          { label: "At risk", value: AT_RISK },
          ...view.lanes.map((lane) => ({ label: lane.label, value: lane.id })),
        ],
      }),
    },
    {
      key: "priority",
      label: "Priority",
      options: keep({
        key: "priority",
        options: [
          ...view.priorities.map((level) => ({ label: level, value: level })),
          { label: "not stated", value: NOT_STATED },
        ],
      }),
    },
    {
      key: "initiative",
      label: "Initiative",
      options: keep({
        key: "initiative",
        options: [
          ...view.initiatives.map((one) => ({ label: one.name, value: one.id })),
          { label: "none", value: NO_INITIATIVE },
        ],
      }),
    },
    {
      key: "tag",
      label: "Tag",
      options: keep({ key: "tag", options: tags.map((tag) => ({ label: tag, value: tag })) }),
    },
  ];
}

/** One hero number: what it counts, which workstreams, and the rule that counts them. */
export interface HeroNumber {
  /** The `state` filter value a click sets. */
  readonly value: string;
  readonly label: string;
  readonly names: readonly string[];
  readonly rule: string;
  readonly atRisk: boolean;
}

/**
 * The hero numbers over the context's half: at risk first, then one per lane that holds anything. Each names the
 * workstreams it counts and the rule, so hovering one says what it means and clicking it filters to them.
 *
 * @param workstreams the context's workstreams, before the filter
 * @returns the numbers, "At risk" always first even at zero
 */
export function heroNumbers({
  view,
  workstreams,
}: {
  view: WorkstreamsView;
  workstreams: readonly WorkstreamView[];
}): readonly HeroNumber[] {
  const risky = view.lanes.filter((lane) => lane.atRisk);
  const atRisk: HeroNumber = {
    atRisk: true,
    label: "At risk",
    names: workstreams.filter((one) => one.atRisk).map((one) => one.name),
    rule: `${risky.map((lane) => lane.label.toLowerCase()).join(", ")}: the ones that get dropped`,
    value: AT_RISK,
  };
  const lanes = view.lanes
    .map((lane: LaneView): HeroNumber => ({
      atRisk: lane.atRisk,
      label: lane.label,
      names: workstreams.filter((one) => one.lane === lane.id).map((one) => one.name),
      rule: lane.rule,
      value: lane.id,
    }))
    .filter((number) => number.names.length > 0);
  return [atRisk, ...lanes];
}
