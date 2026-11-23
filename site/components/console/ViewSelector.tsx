"use client";

import { Check, ChevronDown } from "lucide-react";
import { type ReactElement, useState } from "react";

import { cn } from "../../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/** One entry the selector lists: its key, its words and how many it holds, `undefined` while that is not known. */
export interface ViewChoice<View extends string> {
  readonly view: View;
  readonly label: string;
  readonly count: number | undefined;
}

/**
 * A count as the selector prints it: the number in parentheses, or nothing while what it counts has not read — the
 * page's own freshness mark beside the selector is the spinner or staleness mark for that read, never a dash here.
 *
 * @returns the words, with a leading space
 */
function countWords({ count }: { count: number | undefined }): string {
  if (count === undefined) {
    return "";
  }
  return ` (${String(count)})`;
}

/**
 * The one dropdown a page opens on: the view it is showing with its count, and every other view with its count in
 * parentheses, each clickable. The Queue and the Pull requests page both use it, so the two pages
 * switch views the same way.
 *
 * An entry counted zero is disabled unless it is the one showing; an entry whose count is not known stays
 * selectable, because a count not read is not a zero.
 *
 * @param views every view with its words and count, in the selector's order
 * @param view the view the page is on
 * @param choose move to a view
 * @param listLabel what the open list is called, for a screen reader
 * @returns the selector
 */
export function ViewSelector<View extends string>({
  views,
  view,
  choose,
  listLabel,
}: {
  views: readonly ViewChoice<View>[];
  view: View;
  choose: (view: View) => void;
  listLabel: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const current = views.find((each) => each.view === view)!;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="sw-glass-control inline-flex items-center gap-[0.35rem] rounded-lg border border-solid px-[0.6rem] py-[0.3rem] text-[0.82rem] font-medium text-foreground"
          aria-label={`Showing ${current.label}${countWords({ count: current.count })}: choose what to show`}
        >
          {current.label}
          {countWords({ count: current.count })}
          <ChevronDown className="size-[0.85rem] text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[16rem] p-[0.3rem]">
        <ul className="m-0 list-none p-0" aria-label={listLabel}>
          {views.map((each) => {
            const on = each.view === view;
            return (
              <li key={each.view}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={each.count === 0 && !on}
                  className={cn(
                    "flex w-full items-center gap-[0.5rem] rounded-md px-[0.55rem] py-[0.38rem] text-left text-[0.82rem] text-foreground hover:bg-muted disabled:text-muted-foreground disabled:hover:bg-transparent",
                    on && "bg-muted",
                  )}
                  onClick={() => {
                    choose(each.view);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1">{each.label}</span>
                  <span className="text-muted-foreground tabular-nums">{countWords({ count: each.count })}</span>
                  <Check className={cn("size-[0.85rem]", on ? "visible" : "invisible")} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
