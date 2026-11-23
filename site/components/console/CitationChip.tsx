"use client";

/*
 * A cited record as a chip: the link itself, drawn as a pill in its integration's colour with that integration's
 * app icon, and a hover card saying what it points at before the owner follows it.
 *
 * Citations are colour coded and carry the app icon of their integration, so a GitHub pull request reads as more
 * than a bare hyperlink. The archive's `citations/citation-chip.tsx` is the design taken: a rounded pill tinted from one brand colour (15%
 * fill, 30% border), the integration's mark beside the words, and a hover card whose header strip carries the same
 * tint, the mark and the integration's name, then the place, then "open the original". Colour and mark are the
 * registry's (`../../lib/citationKinds.ts`), the words the reference's own (`../../lib/citationDisplay.ts`).
 *
 * A CITATION is a record the page is talking about — a pull request, a ticket, a thread, a control, a board row.
 * Navigation (the sidebar, a tab, an "open" button, a help link) is not one and stays a plain link.
 *
 * The card's detail block, between the place and the footer, carries a kind's own live content. A pull request or
 * a Linear ticket fills it by itself (`./CitedDetail.tsx`): the title, and the pull-requests page's own state,
 * checks, next act and review, or the ticket's state, so the reader sees a title and whether checks pass and review
 * is needed rather than a bare link. It is mounted inside the hover card, so nothing is read until the card opens. A caller's own
 * `detail` replaces it, and `null` draws none.
 */

import { ExternalLink } from "lucide-react";
import { type CSSProperties, type MouseEvent, type ReactElement, type ReactNode, useRef, useState } from "react";

import { type CitationReference, citedSource, referenceHref } from "@/lib/citationDisplay";
import { type CitationFooterLink, citationFooterOf } from "@/lib/citationFooter";
import { citationKind } from "@/lib/citationKinds";
import { pagePreviewOf } from "@/lib/previewModal";
import { cn } from "@/lib/utils";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { CitationMark } from "./CitationMark";
import { CitedDetail, hasCitedDetail } from "./CitedDetail";
import { usePreviewModal } from "./PreviewModal";

/**
 * How the chip itself is drawn: a pill beside other chips, or a smaller one inside a sentence, baseline-aligned so
 * a line of prose keeps its rhythm.
 */
const LOOKS = {
  chip: "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 align-baseline text-xs font-medium",
  inline:
    "inline-flex max-w-full items-center gap-[0.28em] rounded-full border px-[0.45em] py-0 align-[-0.1em] text-[0.88em] leading-[1.35] font-medium",
} as const;

/** The mark's edge, in pixels, for each look. */
const MARK_SIZE = { chip: 12, inline: 11 } as const;

/**
 * How wide the hover card opens: the record's summary, or a window into the record itself — a channel's live
 * messages, wide enough to read as Slack desktop draws them and never wider than the page.
 */
const CARDS = {
  narrow: "w-72",
  wide: "w-[min(44rem,calc(100vw-2rem))]",
} as const;

/** The click handler a link inside the card takes to open its preview in the chip's own modal. */
export type CardPreviewClick = ReturnType<typeof usePreviewModal>["clickFor"];

/**
 * The chip's colours, every one mixed from the integration's own: a faint fill, a firmer border, and words mixed
 * mostly toward the page's ink so a dark brand (GitHub's) stays legible on a dark page and a bright one (a local
 * page's lime) on a light one — at 40% the lime read 4.35:1 on red light glass, so the brand is a quarter of the
 * words and the fill, border and mark carry the rest of it.
 *
 * @returns the inline style carrying the brand colour and the three mixes
 */
function tinted({ colour }: { colour: string }): CSSProperties {
  return {
    backgroundColor: `color-mix(in oklab, ${colour} 15%, transparent)`,
    borderColor: `color-mix(in oklab, ${colour} 38%, transparent)`,
    color: `color-mix(in oklab, ${colour} 25%, var(--foreground))`,
  };
}

/** One footer action of the hover card. */
function FooterLink({
  href,
  opens,
  onClick,
  children,
}: {
  href: string;
  opens: CitationFooterLink["opens"];
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <a
      href={href}
      {...opens}
      onClick={onClick}
      className="flex items-center gap-1.5 border-t bg-muted/30 px-3 py-2 text-muted-foreground no-underline hover:text-foreground"
    >
      <ExternalLink aria-hidden="true" className="size-3" />
      {children}
    </a>
  );
}

/**
 * One cited record: a colour-coded chip with its integration's icon that opens the record, and previews it on
 * hover or focus.
 *
 * Every card link is drawn here, so this is where an address becomes one a browser will follow: a local page's
 * `file://` address — which Chrome refuses from an `http://` page, click and Command-click alike — links the
 * console's own route to it (`consoleHref`), and opens in a new tab like an external record. The hover card names the place, never the raw
 * address: links render one way on a card, and a URL is not it.
 *
 * A GitHub pull request opens in GitHub, at the address as cited, the way a Slack chip opens the message in Slack,
 * and its hover card carries the console's own view of it on the same tab and that view's diff too — the `/files`
 * tab every named PR links — so a sentence can name the PR once by its number and still reach the diff
 * (`citationFooterOf`, `../../lib/citationFooter.ts`). Every link opens in a new tab.
 *
 * @param reference what the chip points at — an address, or a board row, queue card or talk turn by its id
 * @param children the words the chip reads as — a draft's `[1]`, an act link's `owner/repo#N` pull-request reference
 * @param look `chip` draws a pill among other chips; `inline` a smaller one inside a sentence, the pull-request
 *   number a card's what text names
 * @param detail replaces the hover card's live detail — a pull request's or ticket's own, drawn under the place;
 *   `null` draws none. Given as a function, it is handed the chip's own preview click, so a picture inside the card
 *   opens full size in a modal that outlives the card closing under it
 * @param place replaces the place the address alone gives, when the caller knows more — a Slack channel's name
 * @param card how wide the hover card opens — `wide` for a window into the record rather than a summary of it
 * @returns the chip
 */
export function CitationChip(props: ChipProps): ReactElement {
  const href = referenceHref({ reference: props.reference });
  if (href === undefined) {
    // A board row opens nowhere (`referenceHref`): the row's words, no link, no hover card.
    return <span className={props.className}>{props.children}</span>;
  }
  return <LinkedChip {...props} href={href} />;
}

/** What a chip is drawn from — {@link CitationChip}'s parameters. */
interface ChipProps {
  reference: CitationReference;
  children: ReactNode;
  className?: string;
  look?: keyof typeof LOOKS;
  detail?: ReactNode | ((opener: { clickFor: CardPreviewClick }) => ReactNode);
  place?: string;
  card?: keyof typeof CARDS;
}

/**
 * The chip itself, linked, with its hover card — {@link CitationChip} wherever it links.
 *
 * @returns the chip
 */
function LinkedChip({
  reference,
  href,
  children,
  className,
  look = "chip",
  detail,
  place,
  card = "narrow",
}: ChipProps & { href: string }): ReactElement {
  const read = citedSource({ reference });
  const cited = place === undefined ? read : { ...read, place };
  const kind = citationKind({ id: cited.kind });
  const footer = citationFooterOf({ cited, href });
  const chip = footer.at(0)!;
  // The hover card closes as a preview opens, so it never sits over the modal; focus then returns to the chip.
  const [cardOpen, setCardOpen] = useState(false);
  const anchor = useRef<HTMLAnchorElement>(null);
  const { clickFor, modal } = usePreviewModal({
    onOpen: () => {
      setCardOpen(false);
    },
    returnFocus: anchor,
  });
  let drawn: ReactNode;
  if (typeof detail === "function") {
    drawn = detail({ clickFor });
  } else if (detail === undefined && hasCitedDetail({ reference })) {
    drawn = <CitedDetail reference={reference} />;
  } else {
    drawn = detail;
  }
  const preview = pagePreviewOf({ href: chip.href, title: cited.place });
  return (
    <>
      <HoverCard open={cardOpen} onOpenChange={setCardOpen} openDelay={150} closeDelay={150}>
        <HoverCardTrigger asChild>
          <a
            ref={anchor}
            href={chip.href}
            {...chip.opens}
            onClick={clickFor({ preview })}
            data-citation={kind.id}
            className={cn(LOOKS[look], "no-underline hover:underline", className)}
            style={tinted({ colour: kind.colour })}
          >
            <CitationMark kind={kind} size={MARK_SIZE[look]} />
            <span className="truncate">{children}</span>
          </a>
        </HoverCardTrigger>
        <HoverCardContent side="top" collisionPadding={16} className={cn(CARDS[card], "overflow-hidden p-0 text-xs")}>
          <p
            className="m-0 flex items-center gap-2 border-b px-3 py-2 font-medium text-foreground"
            style={{ backgroundColor: `color-mix(in oklab, ${kind.colour} 14%, transparent)` }}
          >
            <CitationMark kind={kind} size={14} />
            {cited.source}
          </p>
          <div className="grid gap-1 px-3 py-2">
            <p className="m-0 font-medium text-foreground">{cited.place}</p>
          </div>
          {drawn !== undefined && drawn !== null && <div className="border-t px-3 py-2">{drawn}</div>}
          {footer.map((link) => (
            <FooterLink
              key={link.href}
              href={link.href}
              onClick={clickFor({ preview: pagePreviewOf({ href: link.href, title: cited.place }) })}
              opens={link.opens}
            >
              {link.words}
            </FooterLink>
          ))}
        </HoverCardContent>
      </HoverCard>
      {modal}
    </>
  );
}
