"use client";

import { X } from "lucide-react";
import { type ReactElement } from "react";

import { type QueueView } from "../../lib/queueViews";
import { type FreshnessLine } from "../../lib/registerFreshness";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { cn } from "../../lib/utils";
import { LiveChangesNotice } from "../live/LiveChanges";
import { CHIP } from "./controls";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";
import { ViewSelector } from "./ViewSelector";

/**
 * The one bar above the Queue's cards: the view selector, any tag a link narrowed the page to, and how fresh the
 * cards are. The selector is the one control that says it all: it offers "blocked on you" with the count in
 * parentheses, each view clickable. The freshness half says why when the cards are not current. Alignment is the
 * sidebar entry under the Queue, so the bar carries no link to it.
 *
 * @param views every view with its words and count, in the selector's order (`../../lib/queueViews.ts`)
 * @param view the view the page is on
 * @param choose move to a view
 * @param tags the tag selectors a link put in the address, verbatim — only a link sets one now
 * @param dropTag remove one tag selector
 * @param fixture whether a register is a frozen fixture, which acts would write against a live ledger
 * @param freshness the line saying how current the cards are, and why not when they are not
 * @param tagsUnread why a tag-borne view's count is left out over cards whose tags read only in part, drawn as a
 *   staleness mark beside the selector; `undefined` when every card's tags read
 * @param tagsAmbiguous the cards a tag-borne view cannot place because each names a slug several rows carry, in words
 *   since that is the data and no read failed; `undefined` when there are none
 * @returns the bar
 */
export function QueueViewBar({
  views,
  view,
  choose,
  tags,
  dropTag,
  fixture,
  freshness,
  tagsUnread,
  tagsAmbiguous,
}: {
  views: readonly { readonly view: QueueView; readonly label: string; readonly count: number | undefined }[];
  view: QueueView;
  choose: (view: QueueView) => void;
  tags: readonly string[];
  dropTag: (selector: string) => void;
  fixture: boolean;
  freshness: FreshnessLine;
  tagsUnread: StalenessFact | undefined;
  tagsAmbiguous: string | undefined;
}): ReactElement {
  return (
    <div className="mb-[0.75rem] flex flex-wrap items-center gap-[0.5rem] text-[0.8rem]">
      <ViewSelector views={views} view={view} choose={choose} listLabel="What to show" />
      {tagsUnread !== undefined && <StaleMark facts={[tagsUnread]} />}
      {tagsAmbiguous !== undefined && <span className="text-[0.72rem] text-muted-foreground">{tagsAmbiguous}</span>}
      {tags.map((selector) => (
        <span key={selector} className={cn(CHIP, "gap-[0.25rem]")}>
          {selector}
          <button
            type="button"
            className="inline-grid place-items-center text-muted-foreground hover:text-foreground"
            aria-label={`Stop filtering by ${selector}`}
            onClick={() => {
              dropTag(selector);
            }}
          >
            <X className="size-[0.75rem]" aria-hidden="true" />
          </button>
        </span>
      ))}
      {fixture && (
        <span className={CHIP} data-tone="warn">
          a register is a FIXTURE: its rows are frozen and its acts would write against a live ledger
        </span>
      )}
      <LiveChangesNotice />
      <FreshnessMark line={freshness} />
    </div>
  );
}

/**
 * How current a page's cards are, at the right of its bar: a spinner while a read is in flight, a staleness mark
 * whose hover says why when one failed — each beside the age of the cards still drawn — or the plain words alone.
 * The Queue and the Pull requests page draw the same line (`../../lib/registerFreshness.ts`).
 *
 * @param line what the line says
 * @returns the line, or nothing when it has nothing to say
 */
export function FreshnessMark({ line }: { line: FreshnessLine }): ReactElement | null {
  const box = "ml-auto inline-flex items-center gap-[0.35rem] text-[0.76rem] text-muted-foreground";
  if (line.kind === "reading") {
    return (
      <span className={box}>
        {line.words !== "" && <span>{line.words}</span>}
        <ReadingIndicator label={line.label} />
      </span>
    );
  }
  if (line.kind === "stale") {
    return (
      <span className={box}>
        {line.words !== "" && <span>{line.words}</span>}
        <StaleMark facts={line.facts} />
      </span>
    );
  }
  if (line.words === "") {
    return null;
  }
  return (
    <output className={cn(box, line.tone === "warn" && "text-warning")} title={line.title}>
      {line.words}
    </output>
  );
}
