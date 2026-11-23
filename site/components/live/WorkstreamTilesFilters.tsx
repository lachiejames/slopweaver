/**
 * The Workstreams page's controls: the hero numbers, the filter bar, this install's grouping, and the filter read
 * from and written to the address. How progress is read is `docs/console/fleet-and-workstreams.md`'s to say, never
 * the page's.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactElement, useCallback, useMemo } from "react";

import { cn } from "../../lib/utils";
import {
  FILTER_KEYS,
  type FilterFacet,
  type FilterKey,
  type HeroNumber,
  readFilter,
  readOpen,
  type WorkstreamFilter,
  withFilter,
  withOpen,
} from "../../lib/workstreamFilter";
import { type WorkstreamsView } from "../../lib/workstreamTiles";

/** A select, drawn like the Queue's own tag picker. */
const SELECT = "sw-glass-control rounded-lg border border-solid px-[0.5rem] py-[0.28rem] text-[0.8rem] text-foreground";

/**
 * The hero numbers: each a button that filters to what it counts, naming which workstreams and why on hover.
 *
 * @returns the row
 */
export function Heroes({
  numbers,
  chosen,
  choose,
}: {
  numbers: readonly HeroNumber[];
  chosen: string | null;
  choose: (value: string | null) => void;
}): ReactElement {
  return (
    <div className="mb-[0.8rem] flex flex-wrap gap-2">
      {numbers.map((number) => {
        const on = chosen === number.value;
        const named = number.names.length === 0 ? "none" : number.names.join(", ");
        return (
          <button
            key={number.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              choose(on ? null : number.value);
            }}
            title={`${number.label}: ${number.rule}.\n${named}`}
            className={cn(
              "grid min-w-[6.5rem] cursor-pointer rounded-lg border border-solid border-border bg-card px-3 py-[0.45rem] text-left hover:bg-muted/55",
              number.atRisk && number.names.length > 0 && "border-warning/50",
              on && "border-primary bg-primary/12",
            )}
          >
            <span className="text-[1.35rem] leading-[1.1] font-[650] tabular-nums">{number.names.length}</span>
            <span className="text-[0.76rem] text-muted-foreground">{number.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The filter bar: one dropdown per key, "all" by default, and a clear when anything is chosen.
 *
 * @returns the bar
 */
export function FilterBar({
  facets,
  filter,
  set,
}: {
  facets: readonly FilterFacet[];
  filter: WorkstreamFilter;
  set: (change: { readonly key: FilterKey; readonly value: string | null }) => void;
}): ReactElement {
  const any = FILTER_KEYS.some((key) => filter[key] !== null);
  return (
    <div className="mb-[0.6rem] flex flex-wrap items-center gap-[0.5rem] text-[0.8rem]">
      {facets.map((facet) => {
        // The empty value is the "all" option below, so an unchosen key selects it.
        let chosen = "";
        const value = filter[facet.key];
        if (value !== null) {
          chosen = value;
        }
        return (
          <label key={facet.key} className="flex items-center gap-[0.3rem] text-muted-foreground">
            {facet.label}
            <select
              className={SELECT}
              value={chosen}
              onChange={(event) => {
                set({ key: facet.key, value: event.target.value === "" ? null : event.target.value });
              }}
            >
              <option value="">all</option>
              {facet.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} · {option.count}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {any ? (
        <button
          type="button"
          className="cursor-pointer rounded-lg border border-solid border-border bg-card px-[0.5rem] py-[0.28rem] text-muted-foreground hover:text-foreground"
          onClick={() => {
            for (const key of FILTER_KEYS) {
              set({ key, value: null });
            }
          }}
        >
          clear
        </button>
      ) : null}
    </div>
  );
}

/**
 * This install's grouping, open at the foot: the grouping the register document names, with its reason. Nothing
 * while no register document is written. How a workstream's progress is read off its own milestones is
 * `docs/console/fleet-and-workstreams.md`'s to say, never a fold.
 *
 * @returns the grouping line, or nothing
 */
export function Grouping({ view }: { view: WorkstreamsView }): ReactElement | null {
  if (view.grouping === null) {
    return null;
  }
  return (
    <p className="mt-4 mb-0 text-[0.82rem] text-muted-foreground">
      <b className="text-foreground">{view.grouping.label}.</b> {view.grouping.why}
    </p>
  );
}

/**
 * The page's filter, read from and written to the address only, the way the Queue's tag filter is — a write
 * replaces the address in place, so choosing never refetches.
 *
 * @returns the filter and its setter
 */
export function useWorkstreamFilter(): {
  readonly filter: WorkstreamFilter;
  readonly set: (change: { readonly key: FilterKey; readonly value: string | null }) => void;
  readonly opened: string | null;
  readonly open: (id: string | null) => void;
} {
  const params = useSearchParams();
  const pathname = usePathname();
  const search = params.toString();
  const filter = useMemo(() => readFilter({ search }), [search]);
  const opened = useMemo(() => readOpen({ search }), [search]);
  const set = useCallback(
    (change: { readonly key: FilterKey; readonly value: string | null }): void => {
      const next = withFilter({ key: change.key, search: window.location.search, value: change.value });
      window.history.replaceState(null, "", `${pathname}${next}${window.location.hash}`);
    },
    [pathname],
  );
  const open = useCallback(
    (id: string | null): void => {
      const next = withOpen({ open: id, search: window.location.search });
      window.history.replaceState(null, "", `${pathname}${next}${window.location.hash}`);
    },
    [pathname],
  );
  return { filter, open, opened, set };
}
