"use client";

/*
 * The Fleet page: what the fleet did, is doing and does next, as three views behind one switch. Now is the default;
 * the switch is a link per view, so the view the owner picked is the one a bookmark keeps (`?view=past|now|next`), and only
 * the selected view mounts, so the other two read nothing. Every view is read-only — the owner steers through the
 * supervisor or the voice, never by clicking here.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactElement, Suspense } from "react";

import { FLEET_VIEW_PARAM, FLEET_VIEWS, type FleetView, fleetViewOf } from "../../lib/fleetViews";
import { cn } from "../../lib/utils";
import { withParamSet } from "../../lib/workContext";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { NextView } from "./FleetNext";
import { PastView } from "./FleetPast";
import { NowView } from "./Now";

/** Each view's switch label and the one line saying what it holds. */
const VIEW_WORDS: Readonly<Record<FleetView, { label: string; holds: string }>> = {
  next: {
    holds: "what you'll wake up to, what the fleet takes next, and where your steers stand",
    label: "Next",
  },
  now: { holds: "what each agent is doing right now", label: "Now" },
  past: { holds: "what settled, and what the fleet did without asking", label: "Past" },
};

/** The switch: three links in one pill, the current one filled. */
const SWITCH = "inline-flex gap-[0.2rem] rounded-[8px] border border-border p-[0.2rem] text-[0.82rem]";

/** One view's link in the switch. */
const SWITCH_LINK =
  "rounded-[6px] px-[0.75rem] py-[0.25rem] text-muted-foreground no-underline hover:text-foreground aria-[current=page]:bg-primary/22 aria-[current=page]:font-semibold aria-[current=page]:text-foreground";

/**
 * A query parameter as a value, or undefined when the address does not name it.
 *
 * @returns the value
 */
function paramOf({ params, name }: { params: URLSearchParams; name: string }): string | undefined {
  const value = params.get(name);
  if (value === null) {
    return undefined;
  }
  return value;
}

/**
 * The selected view, and only that one.
 *
 * @returns the view
 */
function ViewOf({ view, params }: { view: FleetView; params: URLSearchParams }): ReactElement {
  if (view === "past") {
    return <PastView />;
  }
  if (view === "next") {
    return <NextView />;
  }
  return <NowView fixture={paramOf({ name: "fixture", params })} seat={paramOf({ name: "seat", params })} />;
}

/**
 * The page body, once the search params are known.
 *
 * @returns the switch and the selected view
 */
function FleetBody(): ReactElement {
  const params = useSearchParams();
  const view = fleetViewOf({ param: params.get(FLEET_VIEW_PARAM) });
  const search = params.toString();
  return (
    <>
      <nav aria-label="fleet view" className="mt-5 flex flex-wrap items-center gap-[0.8rem]">
        <span className={SWITCH}>
          {FLEET_VIEWS.map((each) => (
            <Link
              key={each}
              href={withParamSet({ param: FLEET_VIEW_PARAM, search, value: each })}
              className={cn(SWITCH_LINK)}
              aria-current={each === view ? "page" : undefined}
            >
              {VIEW_WORDS[each].label}
            </Link>
          ))}
        </span>
        <span className="text-[0.78rem] text-muted-foreground">{VIEW_WORDS[view].holds}</span>
      </nav>
      <ViewOf params={params} view={view} />
    </>
  );
}

/**
 * The Fleet page's body: the Past / Now / Next switch and the one view it selects, Now unless the address names
 * another.
 *
 * Wrapped in `Suspense` because `useSearchParams` requires it on a statically rendered page.
 *
 * @returns the page body
 */
export function Fleet(): ReactElement {
  return (
    <Suspense fallback={<ReadingIndicator label="Reading the fleet" block />}>
      <FleetBody />
    </Suspense>
  );
}
