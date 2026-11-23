"use client";

import { GitPullRequest, GitPullRequestDraft } from "lucide-react";
import type { ReactElement } from "react";

import { seatTone, toneVariant } from "../../lib/consoleTone";
import type { LiveState } from "../../lib/liveState";
import { type Provenance, provenanceEntryOf } from "../../lib/provenance";
import { consolePullHref } from "../../lib/pullAddress";
import { type Seat, type SeatRead, seatLine, seatTitle } from "../../lib/seat";
import { cn } from "../../lib/utils";
import { Avatar } from "../console/Avatar";
import { useTeamLabel } from "../console/organisationState";
import { SlopweaverMark } from "../SlopweaverMark";
import { TeamMark } from "../TeamMark";
import { Badge } from "../ui/badge";
import { StateLabel } from "../ui/state-label";
import { ReadStandIn } from "./LiveMarks";
import { ChecksChip, ReviewChip } from "./PrStatus";
import type { LandingRow } from "./readLanding";

/** The letters glyph a review bot gets, on the bot's own orange; the rule behind it is on hover. */
const PROV_BOT =
  "inline-grid h-[1.3rem] min-w-[1.6rem] flex-none cursor-help place-items-center rounded-[6px] bg-[oklch(0.5_0.14_45)] px-[0.3rem] text-[0.62rem] font-extrabold tracking-[0.04em] text-[oklch(0.98_0_0)]";

/** A raiser's mark (Slopweaver's logo, the team's role mark), clipped to a rounded square with a hairline round it. */
const PROV_MARK = "inline-flex flex-none cursor-help overflow-hidden rounded-[5px] outline outline-border";

/**
 * The lead: repository, number and title on ONE line, in the text's own colours — no link teal, no labels. A
 * BLOCK box with inline content, because `text-overflow` only renders on one: an inline-flex lead once ended seven
 * of 29 titles mid-word with no mark. The whole title rides the element's `title`, one hover away.
 * Repro: `slopweaver browser shot --raw --full-page --url http://localhost:3100/pull-requests`.
 */
const LEAD = "block min-w-0 flex-1 truncate";

/** What each reading a seat is joined from is, for its spinner's label and its staleness mark's hover. */
const SEAT_READ_SUBJECTS: Readonly<Record<SeatRead, string>> = {
  depth: "the seats this card's seat is read from",
  sessions: "the open sessions this card's seat is joined to",
  watchers: "the watchers this card's seat is read from",
};

/** A pull request's summary: one line, the `open` press drawn only while the row is hovered, focused or unfolded. */
export const CALM_ROW =
  "[&>summary]:items-center [&>summary>button]:opacity-0 [&>summary:hover>button]:opacity-100 [&>summary>button:focus-visible]:opacity-100 [&[open]>summary>button]:opacity-100";

/**
 * How far a pull request's fold sits in from its line. The line leads with its title, with no tag column before it, so
 * the fold steps in a little rather than past a column (`./Row.tsx`'s `ROW_FOLD` steps past one on the other pages).
 */
export const PR_FOLD_INDENT = "pl-4";

/**
 * The fold's first lines: every chip the row used to carry on its own line, wrapping among themselves, then its ask
 * line and suggested reviewer, each a full line. Indented with the fold below it.
 */
export const ROW_CHIPS = cn("flex flex-wrap items-center gap-[0.4rem] pt-[0.45rem] text-[0.76rem]", PR_FOLD_INDENT);

/**
 * One group folded to its heading and count: the page reads in one glance, and a reader opens the group the owner wants.
 * The summary is a quiet line with a hairline under it, the count pushed to its far end like an open group's.
 */
export const FOLDED_GROUP =
  "mt-[0.35rem] [&>summary]:flex [&>summary]:cursor-pointer [&>summary]:items-baseline [&>summary]:justify-between [&>summary]:border-b [&>summary]:border-border/60 [&>summary]:py-[0.4rem] [&>summary]:text-[0.8rem] [&>summary]:font-semibold [&>summary]:text-muted-foreground [&[open]>summary]:text-foreground";

/**
 * A pull request's state in words, and how long it has been open, at the end of its line: a state
 * the owner would say out loud, never the all-caps machine verdict, with an age on every row. The page's ONE accent goes on
 * a row that needs the owner's word, and only there: every other row's state is a quiet outlined pill, so what needs the owner is the
 * only thing on the page that competes for attention, the opposite of visual competition.
 * The machine word stays on the hover; the slide-over draws the same words in the act's own tone (`./PrStatus.tsx`).
 *
 * @param state the row's state in words, from `plainStateOf`
 * @param tag the next-act word it was said from, from `tagOf`
 * @param age how long it has been open, from `openAgeOf`
 * @param needsOwner whether the row is waiting on the owner's word (`site/lib/prNeedsOwner.ts`)
 * @returns the state and the age
 */
export function RowTag({
  state,
  tag,
  age,
  needsOwner,
}: {
  state: string;
  tag: string;
  age: string;
  needsOwner: boolean;
}): ReactElement {
  const title = needsOwner ? `needs your word · next act: ${tag}` : `next act: ${tag}`;
  return (
    <span className="inline-flex flex-none items-center gap-[0.35rem]">
      <Badge
        variant={needsOwner ? "warning" : "outline"}
        size="sm"
        className={cn(
          "max-w-[18rem] truncate px-2 leading-[1.5] font-normal",
          needsOwner ? "border-0" : "text-muted-foreground",
        )}
        title={title}
      >
        {state}
      </Badge>
      <Badge
        variant="outline"
        size="sm"
        className="px-[0.45rem] leading-[1.5] font-normal text-muted-foreground tabular-nums"
        title="how long it has been open"
      >
        {age}
      </Badge>
    </span>
  );
}

/**
 * The repository a row belongs to, as the name after the owner.
 *
 * @returns the repository name without its owner
 */
export function repoNameOf({ slug }: { slug: string }): string {
  return slug.slice(slug.lastIndexOf("/") + 1);
}

/**
 * The provenance glyph: a drawn mark where the raiser has one (Slopweaver's logo, the team's role mark), the letters where it
 * does not (a review bot), and the rule that put the row in that class on its title.
 *
 * @returns the glyph
 */
export function ProvenanceGlyph({ provenance }: { provenance: Provenance }): ReactElement {
  const entry = provenanceEntryOf({ provenance, teamLabel: useTeamLabel() });
  const title = `${entry.label}: ${entry.rule}`;
  if (provenance === "bot") {
    return (
      <span className={PROV_BOT} data-prov={provenance} title={title}>
        {entry.glyph}
      </span>
    );
  }
  return (
    <span className={PROV_MARK} data-prov={provenance} title={title} role="img" aria-label={entry.label}>
      {provenance === "team" ? <TeamMark size={20} /> : <SlopweaverMark size={20} />}
    </span>
  );
}

/**
 * One pull request's line above the fold: repository, number and title, and nothing else. A page of
 * every colour and every chip overwhelms, so every chip moves into the
 * row's fold ({@link PrChips}), and this line is what a row is.
 *
 * The number links GitHub at the head the row was read at, so a row that has moved since shows a different head
 * there; the title opens this console's own view of the pull request.
 *
 * @returns the lead
 */
export function PrLead({ row }: { row: LandingRow }): ReactElement {
  return (
    <span className={LEAD} title={row.title}>
      <span className="text-[0.72rem] text-muted-foreground">{repoNameOf({ slug: row.repoSlug })}</span>{" "}
      <a
        className="font-mono text-[0.76rem] text-muted-foreground no-underline hover:underline"
        href={`${row.url}/commits/${row.headOid}`}
        rel="noreferrer"
      >
        #{String(row.number)}
      </a>{" "}
      <a className="text-foreground no-underline hover:underline" href={consolePullHref({ url: row.url })}>
        {row.title}
      </a>
    </span>
  );
}

/**
 * Every chip a pull request carries, the way GitHub draws them — who raised it, its state, its labels, its author
 * with their picture, checks, open review — and the seat cell, which GitHub cannot draw because only this machine
 * knows who is on it. Drawn inside the row's fold, never on its line: nothing is dropped, only deferred.
 *
 * @param seat who is on the row, from `site/lib/seat.ts`
 * @param seatReads the three readings the seat is joined from: an unknown seat draws the spinner or staleness mark of
 *   the one it waits on, in the seat's place, never its "unknown" words
 * @param avatarOf the picture the roster has for a GitHub login — the author's and each reviewer's
 * @returns the chips
 */
export function PrChips({
  row,
  seat,
  seatReads,
  avatarOf,
  provenance,
}: {
  row: LandingRow;
  seat: Seat;
  seatReads: Readonly<Record<SeatRead, LiveState<unknown>>>;
  avatarOf: (login: string) => string | undefined;
  provenance: Provenance;
}): ReactElement {
  let seatStandIn: ReactElement | undefined;
  const waitedOn = seat.kind === "unknown" ? seatReads[seat.read] : undefined;
  if (seat.kind === "unknown" && waitedOn !== undefined && waitedOn.phase !== "ready") {
    seatStandIn = <ReadStandIn state={waitedOn} subject={SEAT_READ_SUBJECTS[seat.read]} />;
  }
  let seatCell: ReactElement = (
    <Badge
      variant={toneVariant({ tone: seatTone({ kind: seat.kind }) })}
      size="sm"
      className={cn(
        "max-w-full truncate px-[0.55rem] text-[0.74rem] font-semibold",
        // The seats that draw a dashed outline keep its 1px, so every seat stands as tall as it did.
        seat.kind !== "nobody" && seat.kind !== "unknown" && seat.kind !== "stale-history" && "border-0",
      )}
      title={seatTitle({ seat })}
    >
      {seatLine({ seat })}
    </Badge>
  );
  if (seatStandIn !== undefined) {
    seatCell = seatStandIn;
  }
  return (
    <>
      <ProvenanceGlyph provenance={provenance} />
      <StateLabel
        status={row.draft ? "draft" : "open"}
        icon={row.draft ? GitPullRequestDraft : GitPullRequest}
        title={row.draft ? "draft" : "open"}
        iconOnly
      />
      {row.labels.map((label) => (
        <Badge
          key={label}
          variant="outline"
          size="sm"
          className="px-2 text-[0.66rem] leading-5 font-normal text-muted-foreground"
        >
          {label}
        </Badge>
      ))}
      <span className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-[0.4rem] text-[0.74rem] text-muted-foreground">
        <span className="inline-flex items-center gap-[0.35rem]" title={`opened by ${row.authorLogin}`}>
          <Avatar url={avatarOf(row.authorLogin)} name={row.authorLogin} size="sm" />
          <span className="font-semibold text-foreground">{row.authorLogin}</span>
        </span>
        <ChecksChip row={row} />
        <ReviewChip row={row} avatarOf={avatarOf} />
        {seatCell}
      </span>
    </>
  );
}
