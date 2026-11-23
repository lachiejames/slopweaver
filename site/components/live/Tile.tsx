"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

import { oldestReadingOf } from "../../lib/readingAge";
import { cn } from "../../lib/utils";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ReadMark, ReadStandIn } from "./LiveMarks";
import { ReadingAge } from "./ReadingAge";
import type { LiveState } from "./useLive";

/**
 * A page of tiles: one column read top to bottom as the answer to one question, rather than a grid glanced at
 * as parallel gauges. /fleet and /pull-requests both stack their tiles in it.
 */
export const TILES = "my-5 flex flex-col gap-5";

/** A tile whose figures stand on its own reading alone: one stable list, so no render builds a new one. */
const DRAWS_FROM_ITSELF: readonly { readonly state: LiveState<unknown>; readonly subject: string }[] = [];

/** The row of headline figures a tile opens on, wrapping when the tile is narrow. */
export const STAT_ROW = "flex flex-wrap gap-[1.1rem]";

/** One headline figure: the number large and tabular, the word naming it small and muted under it. */
export const STAT =
  "flex flex-col [&_span]:text-[0.7rem] [&_span]:text-muted-foreground [&_strong]:text-[1.5rem] [&_strong]:leading-[1.1] [&_strong]:tabular-nums";

/** A tile's small muted list — diagnostics, sessions, the lines a verb printed. */
export const TILE_LIST = "m-0 list-disc pl-[1.1rem] text-[0.74rem] leading-[1.5] text-muted-foreground";

/**
 * The one line that says how much to trust the value beside it.
 *
 * A frozen reading prints FIXTURE and the capture's own age in exactly the weight a live stamp gets,
 * because a mock that looks live is the confident-but-wrong row the console exists to make impossible
 *. An instant the route stamped rather than the verb says `on read` beside its age, because
 * otherwise a cached answer presents itself as a fresh reading; its hover carries the sentence behind it.
 *
 * A reading handed over on mount — kept from an earlier visit, or already on the channel — carries a spinner: a
 * reading verb's stamp is its own age, so a kept answer and a fresh one would otherwise print the same line, and a
 * fast-lane tile reading "3m ago" would look like a poll that had stopped. A reading kept over a failed read carries
 * the staleness mark instead, whose hover says why ({@link ReadMark}).
 *
 * The age keeps counting while the page stays open ({@link ReadingAge}), so a read-once tile ages in front of the owner
 * rather than reading `just now` until something re-renders it. A tile whose figures also stand on another reading
 * ages the OLDER of the two (`../../lib/readingAge.ts`), and its hover names which one that is.
 *
 * @param subject what the tile reads, for the mark's hover
 * @param alsoFrom the other channels the tile's figures are drawn from, each with what it is
 * @returns the stamp
 */
function Stamp<T>({
  state,
  subject,
  alsoFrom,
}: {
  state: Extract<LiveState<T>, { phase: "ready" }>;
  subject: string;
  alsoFrom: readonly { readonly state: LiveState<unknown>; readonly subject: string }[];
}): ReactElement {
  const aged = oldestReadingOf({
    others: alsoFrom,
    primary: { observedAtIso: state.observedAtIso, stampedByRoute: state.stampedByRoute, subject },
  });
  const mark = <ReadMark state={state} subject={subject} />;
  if (state.fixture !== undefined) {
    return (
      <span className="inline-flex items-center gap-[0.3rem]">
        <span>
          <b className="tracking-[0.04em] text-warning">FIXTURE {state.fixture}</b> · frozen{" "}
          <ReadingAge iso={state.observedAtIso} />
        </span>
        {mark}
      </span>
    );
  }
  let hover: string | undefined;
  if (aged.subject !== subject) {
    hover = `the age of ${aged.subject}, the oldest reading this tile is drawn from`;
  }
  if (aged.stampedByRoute) {
    let routeHover = "the instant was stamped on read, not by the verb";
    if (hover !== undefined) {
      routeHover = `${hover}; ${routeHover}`;
    }
    return (
      <span className="inline-flex items-center gap-[0.3rem]">
        <span title={routeHover}>
          <ReadingAge iso={aged.observedAtIso} /> · on read
        </span>
        {mark}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-[0.3rem]">
      <ReadingAge iso={aged.observedAtIso} title={hover} />
      {mark}
    </span>
  );
}

/**
 * The one of three bodies this reading has earned: the data, or where it goes a spinner while the first read is in
 * flight and a staleness mark when it failed with nothing earlier to draw.
 *
 * Written as a function with early returns rather than as chained ternaries in the JSX: a ternary whose
 * branch is another ternary is banned repo-wide, and no gate walks `site/`
 * to catch one here.
 *
 * @param subject what the tile reads, for the stand-in's hover
 * @param children rendered only once there is a value to render
 * @returns the body for the current phase
 */
function TileBody<T>({
  state,
  subject,
  children,
}: {
  state: LiveState<T>;
  subject: string;
  children: (value: T) => ReactNode;
}): ReactNode {
  if (state.phase !== "ready") {
    return <ReadStandIn state={state} subject={subject} block />;
  }
  return children(state.value);
}

/**
 * The frame every live reading renders inside.
 *
 * It owns the three states so no tile has to, and the third one is the reason it exists: a console whose
 * failures render as an empty card is one you stop trusting the moment a number looks surprising. A failed read
 * draws the staleness mark — beside the last reading when there is one, where the value goes when there is not —
 * and its hover names the reason, since a text stand-in looks broken.
 *
 * **The body is the data and nothing else** (minimalist, with progressive disclosure, never paragraphs), and a tile carries no fold saying how it was read: the owner never opens one. A failure still shows where the value goes, never behind a click.
 *
 * **The frame is the shadcn card** (`components/ui/card.tsx`), drawn at the tile's own compact spacing.
 *
 * @param href where the title links, when the tile is the first line of a page of its own
 * @param className spacing a page gives its tiles, such as a tighter padding
 * @param alsoFrom other channels the body's figures are drawn from, so the stamp ages the oldest reading among them
 * @param children rendered only in the ready state
 * @returns the framed tile
 */
export function Tile<T>({
  title,
  state,
  href,
  className,
  alsoFrom = DRAWS_FROM_ITSELF,
  children,
}: {
  title: string;
  state: LiveState<T>;
  href?: string;
  className?: string;
  alsoFrom?: readonly { readonly state: LiveState<unknown>; readonly subject: string }[];
  children: (value: T) => ReactNode;
}): ReactElement {
  let heading: ReactNode = title;
  if (href !== undefined) {
    heading = (
      <Link className="text-inherit no-underline hover:underline" href={href}>
        {title} <span className="font-normal text-muted-foreground">→</span>
      </Link>
    );
  }
  return (
    <Card
      className={cn(
        "gap-3 rounded-[12px] border-solid border-border px-[1.1rem] pt-4 pb-[0.85rem] shadow-none",
        className,
      )}
    >
      <CardHeader className="items-baseline gap-x-3 gap-y-0 px-0">
        <CardTitle>
          <h3 className="m-0 text-[0.95rem] leading-[1.5] font-bold tracking-[-0.01em]">{heading}</h3>
        </CardTitle>
        <CardAction className="row-span-1 self-baseline text-right text-[0.72rem] text-muted-foreground">
          {state.phase === "ready" && <Stamp state={state} subject={title} alsoFrom={alsoFrom} />}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0 [&>p]:m-0">
        <TileBody state={state} subject={title}>
          {children}
        </TileBody>
      </CardContent>
    </Card>
  );
}
