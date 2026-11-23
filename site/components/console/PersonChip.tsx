"use client";

/*
 * A person a card names, drawn as an identity chip: their face and name inline in the sentence, and a hover card
 * with their picture, name, role and handle, and which of the owner's workstreams have open rows naming them.
 *
 * The What section names a person as an identity chip, never a raw Slack id. Every field is the roster's or the board's
 * (`../../lib/personMentions.ts`); a field neither holds is no line, never a sentence about the gap. The org chart
 * block — title, team, org unit, Vanta groups and status, each naming its store — is `../../lib/personOrg.ts`'s.
 *
 * Never drawn inside a Slack draft's preview: `./SlackDraft.tsx` draws a mention as Slack itself would, because that
 * preview is the exact message the owner is approving.
 *
 * Identity chips live ONLY in a card's properties — who a message tags, who is in its thread —
 * and a name anywhere else on the card is words (`../../lib/cardPeopleDisplay.ts`). A person Slack says has left is
 * drawn DEACTIVATED: the chip greyed — muted ink, no tint, a dashed edge — and "(deactivated)" beside the name on hover,
 * the org chart block, Google Admin org unit included, kept as it was.
 */

import type { CSSProperties, ReactElement } from "react";

import { citationKind } from "@/lib/citationKinds";
import type { CardPerson } from "@/lib/personMentions";
import { orgLines, positionOf } from "@/lib/personOrg";
import { cn } from "@/lib/utils";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { Avatar } from "./Avatar";
import { CitationMark } from "./CitationMark";

/** The chip's colours, mixed from Slack's own like any Slack citation, so a person reads as a Slack identity. */
function tinted({ colour }: { colour: string }): CSSProperties {
  return {
    backgroundColor: `color-mix(in oklab, ${colour} 15%, transparent)`,
    borderColor: `color-mix(in oklab, ${colour} 38%, transparent)`,
    color: `color-mix(in oklab, ${colour} 25%, var(--foreground))`,
  };
}

/**
 * The hover card's workstreams: each of the owner's streams whose open rows name this person, with those rows, so a match
 * the owner doubts is named by the row that made it. The rows are words, never linked: a Queue card never cites a board
 * row, and a board row has no page of its own to open.
 *
 * @returns the list, or nothing when no open row names them
 */
function Workstreams({ person }: { person: CardPerson }): ReactElement | null {
  if (person.workstreams.length === 0) {
    return null;
  }
  const rowOf = ({ slug }: { slug: string }): ReactElement => (
    <span key={slug} className="break-all">
      {slug}
    </span>
  );
  return (
    <div className="grid gap-1 border-t px-3 py-2">
      <p className="m-0 text-[0.65rem] font-bold tracking-[0.06em] text-muted-foreground uppercase">
        your workstreams with open rows naming them
      </p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {person.workstreams.map((stream) => (
          <li key={stream.name} className="grid gap-0.5">
            <span className="font-medium text-foreground">{stream.name}</span>
            <span className="flex flex-wrap gap-x-2 text-muted-foreground">
              {stream.rows.map((slug) => rowOf({ slug }))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The hover card's org-chart block: people's titles, and which Vanta group and team they are in. Each line names the store it came from, so a wrong team is traceable.
 *
 * @returns the block, or nothing when the CLI joined them to neither store
 */
function OrgChartBlock({ person }: { person: CardPerson }): ReactElement | null {
  const lines = orgLines({ person });
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-1 border-t px-3 py-2">
      <p className="m-0 text-[0.65rem] font-bold tracking-[0.06em] text-muted-foreground uppercase">org chart</p>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        {lines.map((line) => (
          <div key={line.label} className="contents">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="m-0 min-w-0 text-foreground">
              {line.value} <span className="text-[0.65rem] text-muted-foreground">· {line.source}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * A deactivated member's chip: no Slack tint, the muted ink token and a dashed edge. Never an opacity or a filter —
 * the avatar's initials are text, and fading them is the faded text the theme's contrast gate refuses.
 */
const LEFT = "border-dashed border-border bg-transparent text-muted-foreground";

/**
 * One person as an identity chip in a card's properties, previewing who they are on hover or focus.
 *
 * @param person what the roster and the board hold for them
 * @param label the words the chip draws — the roster's name for an id, the words as written for a name
 * @returns the chip
 */
export function PersonChip({ person, label }: { person: CardPerson; label: string }): ReactElement {
  const kind = citationKind({ id: "slack" });
  // The hover card says who the chip resolved to in full, so "Sophie" in a sentence reads "Sophie G" on hover.
  let whole = label;
  const rostered = person.name?.trim();
  if (rostered !== undefined && rostered.length > 0) {
    whole = rostered;
  }
  const left = person.deactivated === true;
  let chipStyle: CSSProperties | undefined = tinted({ colour: kind.colour });
  let bandStyle: CSSProperties | undefined = {
    backgroundColor: `color-mix(in oklab, ${kind.colour} 14%, transparent)`,
  };
  if (left) {
    chipStyle = undefined;
    bandStyle = undefined;
  }
  const position = positionOf({ person });
  return (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        {/* A person has no page of their own here, so the chip is a button rather than a link: focusing it opens the
            same card hovering does. Never inside a link or a button — a place that is one folds to `inlinePlain`. */}
        <button
          type="button"
          data-citation="person"
          data-person={person.id}
          data-deactivated={left ? "" : undefined}
          className={cn(
            "inline-flex max-w-full cursor-default items-center gap-[0.3em] rounded-full border py-0 pr-[0.45em] pl-[0.12em] align-[-0.12em] font-[inherit] text-[0.88em] leading-[1.35] font-medium",
            left && LEFT,
          )}
          style={chipStyle}
        >
          <span className="inline-grid [&_[data-slot=avatar]]:size-[1.15em] [&_[data-slot=avatar]]:text-[0.5em]">
            <Avatar url={person.avatarUrl} name={label} muted={left} />
          </span>
          <span className="truncate">{label}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" collisionPadding={16} className="w-80 overflow-hidden p-0 text-xs">
        <p className="m-0 flex items-center gap-2 border-b px-3 py-2 font-medium text-foreground" style={bandStyle}>
          <CitationMark kind={kind} size={14} />
          {kind.source} member
        </p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3 py-2">
          <Avatar url={person.avatarUrl} name={whole} size="md" muted={left} />
          <div className="grid min-w-0 gap-0.5">
            <p className="m-0 text-[0.85rem] font-semibold text-foreground">
              {whole}
              {left && <span className="font-normal text-muted-foreground"> (deactivated)</span>}
            </p>
            {position !== undefined && <p className="m-0 text-foreground">{position}</p>}
            {person.handle !== undefined && <p className="m-0 text-muted-foreground">@{person.handle}</p>}
          </div>
        </div>
        <OrgChartBlock person={person} />
        <Workstreams person={person} />
      </HoverCardContent>
    </HoverCard>
  );
}
