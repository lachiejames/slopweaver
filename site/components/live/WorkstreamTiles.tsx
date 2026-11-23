"use client";

/**
 * The Workstreams page: every outcome the owner drives as one collapsed card in a vertical list, at risk first, each
 * opening into a slide-over with its progress against its own milestones and its dated story.
 *
 * The shape of the page:
 *
 * - **A list of collapsed cards, like the Queue**: Queue-sized, stacked vertically, never one
 *   workstream filling the screen. On each card's left, a colour-coded chip naming whose move it is — the owner's call, a
 *   chase, moving — then the title, a progress meter under it, and a few tags and stats.
 * - **Key-value filters, not category chips**: dropdowns for state, priority, initiative and tag, addressed in the
 *   URL, everything shown by default. Hero numbers above them, each a button that filters to what it counts and says
 *   which workstreams and why on hover.
 * - **A card opens a slide-over, exactly as a Queue card does**: the shared `SlideOver` shell, addressed by
 *   `?open=<id>`, holding the progressive disclosure. No slug or worktree id line anywhere on a card.
 * - **Every dated entry's source is a citation**: the console's own chip with its hover card, never a bare link.
 * - **The context switcher filters the page**: an Acme workstream is not shown under Slopweaver.
 *
 * Every figure is the verb's (`slopweaver workstreams list --json`, `src/workstreams/store/projection.ts`); what the page
 * shows of it is `../../lib/workstreamFilter.ts`. This file only draws.
 */
import { type ReactElement, useCallback, useMemo } from "react";

import { isBag } from "../../lib/bag";
import { provenNowOf } from "../../lib/pageEmpty";
import type { SlackPeople } from "../../lib/slackPeople";
import { ALL, FILTER_KEYS, filterFacets, heroNumbers, inContext, matchesFilter } from "../../lib/workstreamFilter";
import { isWorkstreamsAbsent, readWorkstreamsReading, type WorkstreamsAbsent } from "../../lib/workstreamsReading";
import type { WorkstreamsView } from "../../lib/workstreamTiles";
import { CHIP } from "../console/controls";
import { PageEmpty } from "../console/PageEmpty";
import { HiddenNote, useWorkContext } from "../console/workContextState";
import { ReadMark, ReadStandIn } from "./LiveMarks";
import { peopleOf } from "./readSlackDraftsPeople";
import { SlideOver } from "./SlideOver";
import { useLive } from "./useLive";
import { Card } from "./WorkstreamTilesCard";
import { ChannelNames } from "./WorkstreamTilesCite";
import { FilterBar, Grouping, Heroes, useWorkstreamFilter } from "./WorkstreamTilesFilters";
import { Panel } from "./WorkstreamTilesPanel";

/**
 * The page once the reading is in.
 *
 * @param provenNow whether the register's latest read answered, so "none in this context" may be said in the present
 * @returns the page body
 */
function Page({
  view,
  roster,
  provenNow,
}: {
  view: WorkstreamsView;
  roster: SlackPeople;
  provenNow: boolean;
}): ReactElement {
  const { context } = useWorkContext();
  const { filter, set, opened, open } = useWorkstreamFilter();
  const close = useCallback(() => {
    open(null);
  }, [open]);
  const { shown, hidden } = useMemo(() => inContext({ context, workstreams: view.workstreams }), [context, view]);
  const listed = useMemo(() => shown.filter((one) => matchesFilter({ filter, one })), [shown, filter]);
  const facets = useMemo(() => filterFacets({ filter, view, workstreams: shown }), [filter, view, shown]);
  const numbers = useMemo(() => heroNumbers({ view, workstreams: shown }), [view, shown]);
  const openedOne = opened === null ? undefined : shown.find((one) => one.id === opened);
  let noneHere = "No workstreams in this context.";
  if (!provenNow) {
    noneHere = "No workstreams in this context as of the last reading that answered.";
  }
  let skippedLine: string | null = null;
  if (view.skipped === 1) {
    skippedLine = "1 workstream of a kind this page does not draw yet.";
  } else if (view.skipped > 1) {
    skippedLine = `${String(view.skipped)} workstreams of a kind this page does not draw yet.`;
  }
  return (
    <ChannelNames.Provider value={view.channels}>
      <div className="mt-4">
        <Heroes
          numbers={numbers}
          chosen={filter.state}
          choose={(value) => {
            set({ key: "state", value });
          }}
        />
        <FilterBar facets={facets} filter={filter} set={set} />
        <HiddenNote hidden={hidden} what="workstreams" one="workstream" />
        {skippedLine === null ? null : <p className="mt-0 mb-2 text-[0.82rem] text-warning">{skippedLine}</p>}
        {listed.length === 0 ? (
          <p className="text-[0.86rem] text-muted-foreground">
            {shown.length === 0 ? noneHere : "Nothing matches this filter."}
          </p>
        ) : (
          <div className="sw-glass-plane overflow-hidden rounded-xl border border-solid">
            {listed.map((one) => (
              <Card key={one.id} one={one} view={view} open={open} />
            ))}
          </div>
        )}
        {listed.length === shown.length ? null : (
          <p className="mt-[0.4rem] text-[0.78rem] text-muted-foreground">
            {listed.length} of {shown.length} shown.{" "}
            <button
              type="button"
              className="cursor-pointer text-primary underline"
              onClick={() => {
                for (const key of FILTER_KEYS) {
                  set({ key, value: ALL[key] });
                }
              }}
            >
              show all
            </button>
          </p>
        )}
        <Grouping view={view} />
        {openedOne === undefined ? null : (
          <Panel one={openedOne} view={view} roster={roster} open={open} onClose={close} />
        )}
        {opened !== null && openedOne === undefined ? (
          <SlideOver label="no such workstream" tag={<span className={CHIP}>gone</span>} title={opened} onClose={close}>
            <p className="px-[1.3rem] py-[1.2rem] text-muted-foreground">
              {hidden > 0 && view.workstreams.some((one) => one.id === opened)
                ? "This workstream sits in the other context; switch context to open it."
                : "No workstream on the register has this address any more."}
            </p>
          </SlideOver>
        ) : null}
      </div>
    </ChannelNames.Provider>
  );
}

/**
 * What the page reads: no register yet, or the register's view with the member roster its stakeholder chips are
 * drawn from.
 */
type Reading =
  WorkstreamsAbsent | { readonly kind: "present"; readonly view: WorkstreamsView; readonly roster: SlackPeople };

/**
 * Read the verb's document and the roster beside it; either refusing refuses the reading. No register yet is its
 * own answer, read before either (`../../lib/workstreamsReading.ts`).
 *
 * @returns the reading, or `undefined`
 */
function readingOf({ payload }: { payload: unknown }): Reading | undefined {
  const view = readWorkstreamsReading({ payload });
  if (view === undefined) {
    return undefined;
  }
  if (isWorkstreamsAbsent(view)) {
    return view;
  }
  if (!isBag(payload)) {
    return undefined;
  }
  const roster = peopleOf({ payload });
  if (roster === undefined) {
    return undefined;
  }
  return { kind: "present", roster, view };
}

/**
 * The Workstreams page body, read live.
 *
 * @returns the page body in whichever of its three states the reading is
 */
export function WorkstreamTiles(): ReactElement {
  const state = useLive<Reading>({
    read: (payload) => readingOf({ payload }),
    slug: "workstreams",
  });
  if (state.phase !== "ready") {
    return <ReadStandIn state={state} subject="the workstreams register" block />;
  }
  // No register yet is an answer, so it draws the designed empty state. The read mark stays on both arms: it draws only when a LATER read failed over the answer
  // drawn, which is still a failure.
  // A register written with no workstream on it is as empty as no register at all.
  const none = state.value.kind === "absent" || state.value.view.workstreams.length === 0;
  const provenNow = provenNowOf({ state });
  return (
    <>
      <ReadMark state={state} subject="The workstreams register" row />
      {none && !provenNow && (
        // An empty answer kept over a failed read proves nothing now: a plain line under the read mark.
        <p className="mt-4 text-[0.86rem] text-muted-foreground">
          No workstream was on the register as of the last reading that answered.
        </p>
      )}
      {none && provenNow && (
        <PageEmpty
          title="Workstreams will appear here."
          appearsWhen="A workstream appears when you keep one of the proposals above. The outcomes you have stated are among them. Nothing is kept until you do."
          action={{ kind: "plans" }}
          surface="workstreams"
        />
      )}
      {!none && <Page view={state.value.view} roster={state.value.roster} provenNow={provenNow} />}
    </>
  );
}
