"use client";

import { ChevronRight } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { ageOf } from "../../lib/ageOf";
import type { CardCurrency, CurrencyReading } from "../../lib/cardCurrency";
import { cardCurrencyOf } from "../../lib/cardCurrencyMark";
import { inlinePlain } from "../../lib/inlineCitations";
import { isLifted, LIFTED_HEADINGS, type QueueSection } from "../../lib/queueFocus";
import { reviewLineFor } from "../../lib/queueReviewLine";
import { collapsedPriorityOf, KIND_WORD } from "../../lib/queueRowMeta";
import type { QueueRow } from "../../lib/queueRows";
import { triagePillWords } from "../../lib/triageWords";
import { cn } from "../../lib/utils";
import { TIER_WORDS } from "../../lib/waitingRank";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import { ProvenanceGlyph } from "../live/PrCard";
import { readCurrencyReading } from "../live/readCurrency";
import type { Reading } from "../live/reading";
import { readyValueOf, useLive } from "../live/useLive";
import { Badge } from "../ui/badge";
import { CardLapsLine } from "./CardLaps";
import { useCardReferences } from "./InlineText";
import { ProofGapLead } from "./ProofGapLead";
import { useSettling } from "./press";
import { StoppingLines } from "./QueueStoppingLines";
import { kindHue } from "./queueKinds";
import { InsideControl, StaleMark } from "./StaleMark";
import { FAST_POLL_MS } from "./useQueueRows";
import { FindingMark } from "./workContextState";

/*
 * The queue card's two halves, the row button and the confidence mark it carries — lifted out of `Queue.tsx` so that
 * file stays under the line cap. Why each exists is on each one.
 */

/**
 * A queue row's frame: THREE children, three columns — the provenance glyph, the text and the meta. A fourth child
 * would wrap onto an implicit second grid row and overlap. No kind tile leads the row, nor any other label that
 * piles up before the question ("Post", then "posts as you", then "six", then "reply" is too much). The provenance glyph sits a nudge lower, level with the question's first line.
 */
export const QUEUE_ROW =
  "grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-[0.7rem] gap-y-[0.6rem] px-[1.1rem] py-[0.85rem] text-left hover:bg-muted/55 focus-visible:bg-muted/55 focus-visible:outline-none aria-[current=true]:bg-primary/10 [&_[data-prov]]:mt-[0.2rem] [&_[data-prov]]:ml-0";

/** The row's edge between rows; the last row of a section closes on the card's own border. */
export const QUEUE_ROW_EDGE = "border-0 border-b border-b-border/70 last:border-b-0";

/** The row's text column, which clips to its column so a long line never pushes the meta off the card. */
export const QUEUE_TEXT = "grid min-w-0 gap-[0.2rem] overflow-hidden";

/**
 * The question. Nothing in the row clips with an ellipsis: the question WRAPS, because the page never truncates
 * (`skills/supervisor/reference/fleet-briefing-shape.md`).
 */
export const QUEUE_TITLE = "block min-w-0 text-[0.9rem] leading-[1.45] font-[550]";

/** The row's right-hand column: the kind, the priority, the currency mark and the chevron. */
export const QUEUE_META =
  "flex flex-none items-start gap-[0.4rem] pt-[0.15rem] text-[0.74rem] whitespace-nowrap text-muted-foreground";

/**
 * The wall clock, re-read on a fixed tick, for judging a row's freshness.
 *
 * Read in an effect rather than in render, because render must be pure. And it is the wall clock rather than
 * the newest register reading: when every fast-lane register goes unmeasured, that reading freezes at page
 * open and a row would stay unmarked however long the page sat — the counterexample the review of this
 * change found. A mark trails the truth by one tick at most.
 *
 * @param everyMs how often to re-read the clock
 * @returns the last instant read, in epoch milliseconds
 */
export function useNow({ everyMs }: { everyMs: number }): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, everyMs);
    return () => {
      clearInterval(timer);
    };
  }, [everyMs]);
  return now;
}

/**
 * The badge tone each currency state draws in: green only where both halves were rechecked and passed, the warning hue
 * on every card that is not fresh, so the two read apart at a glance.
 */
const CURRENCY_VARIANT: Readonly<Record<CardCurrency["kind"], "warning" | "success" | "outline">> = {
  "facts-only": "warning",
  fresh: "success",
  "looks-answered": "outline",
  reacted: "outline",
  ruled: "outline",
  "steers-only": "warning",
  unchecked: "warning",
};

/**
 * A row's currency mark, the archive's right-hand badge: whether the card is fresh — its facts AND the owner's steers
 * rechecked — or which half was, and when — "fresh · checked 3m ago", "facts checked 4s ago · not your steers", "looks
 * answered", "you ruled on it", or what each half needs when neither passed, "not re-confirmed · you said things
 * since" — with the hover saying each half, against what, what the owner has said since, and
 * what done means for this card.
 *
 * The mark says what was rechecked, never a register's internal threshold (the board reconcile pass's 6h), which means nothing to the owner. The
 * row's own age (when it first reached their screen) is not drawn beside it, because it does not matter to them. What
 * the words may claim is `../../lib/cardCurrencyMark.ts`'s.
 *
 * @param row the row
 * @param nowMs the page's ticking clock: passed so the mark re-renders and its ages move, read through `ageOf`
 * @returns the mark
 */
export function ConfidenceMark({ row }: { row: QueueRow; nowMs: number }): ReactElement {
  const currency = useLive<Reading<CurrencyReading>>({
    everyMs: FAST_POLL_MS,
    read: readCurrencyReading,
    slug: "currency-reading",
  });
  const mark = cardCurrencyOf({
    ageOf,
    card: row,
    reading: readyValueOf({ state: currency })?.value,
  });
  // A ruled card's badge never reads the check; any other card's would say "unchecked" over a read in flight or failed.
  if (row.ruledIso === undefined && currency.phase !== "ready") {
    return <ReadStandIn state={currency} subject="the check of what you have said since" />;
  }
  return (
    <>
      <Badge
        size="sm"
        variant={CURRENCY_VARIANT[mark.kind]}
        className="border-solid"
        title={mark.title}
        data-currency={mark.kind}
      >
        {mark.words}
      </Badge>
      {mark.unread.length > 0 && <StaleMark facts={mark.unread} />}
      {row.ruledIso === undefined && currency.phase === "ready" && currency.stale !== undefined && (
        <ReadMark state={currency} subject="the check of what you have said since" />
      )}
    </>
  );
}

/**
 * The heading over one section of the card: what the section is and how many cards it shows. Every word on the page
 * earns its place, so the badge's bookkeeping lives in the fold at the bottom, not on every heading.
 *
 * @param section a lifted section — blocking the owner's priorities, the owner's priorities, stopped automations
 *   (`../../lib/queueFocus.ts`) — a tier of the one ranking, or `deferred` for the cards the owner put off, drawn last
 * @param count how many cards the section shows under the view the owner is on
 * @returns the heading
 */
export function SectionHead({ section, count }: { section: QueueSection | "deferred"; count: number }): ReactElement {
  let heading = DEFERRED_HEADING;
  if (isLifted(section)) {
    heading = LIFTED_HEADINGS[section];
  } else if (section !== "deferred") {
    heading = TIER_WORDS[section].heading;
  }
  return (
    <h3
      className="m-0 px-[0.9rem] pt-[0.55rem] pb-[0.35rem] text-[0.74rem] font-medium text-muted-foreground"
      data-tier={section}
    >
      {heading} · <b>{String(count)}</b>
    </h3>
  );
}

/** The heading over the cards the owner put off with "Come back to it", in the owner's own voice. */
const DEFERRED_HEADING = "You said you'd come back to these";

/**
 * One queue row, drawn as the archive's queue card: the register's stripe, who raised it, the question with its
 * place in the list, the subject, the draft's opening when pressing sends a message, and in the meta column which
 * kind of request it is, its priority when there is a read on one, the currency mark saying whether it is fresh and
 * when it was last checked, and a chevron saying it opens. The collapsed card shows the title, the kind, the
 * priority and when it was last checked — never when it first reached the owner's screen. No kind tile, action or
 * pill stands in front of the question: the kind and band are one short word each, at the right.
 *
 * @param number the row's place in the list the owner is looking at, or nothing when the drawn list does not hold it
 * @param current whether this row's panel is the open one
 * @param nowMs the clock the confidence mark judges against
 * @param onOpen what opening does, handed the row
 * @returns the row
 */
export function QueueRowButton({
  row,
  number,
  current,
  nowMs,
  onOpen,
}: {
  row: QueueRow;
  number: number | undefined;
  current: boolean;
  nowMs: number;
  onOpen: (row: QueueRow) => void;
}): ReactElement {
  const review = reviewLineFor({ row });
  const priority = collapsedPriorityOf({
    own: row.record.kind === "ask" ? row.record.row.priority : undefined,
    tags: row.tags,
  });
  const references = useCardReferences();
  // Pressed in its panel and not yet re-read: drawn on its way out at once, rather than unchanged for the two child
  // processes a press takes (`./press.tsx` § usePress). A dashed outline, never a fade: a faded row is faded text,
  // which the contrast rule refuses (`site/__tests__/unit/theme/contrastOpacity.test.ts`, "fades no text").
  const settling = useSettling({ rowKey: row.key });
  // The stripe is an inset shadow so the row's grid and padding are exactly what they would be without it. The
  // pull request's near-black hue carries a whole border instead of the rule between rows.
  let edge = QUEUE_ROW_EDGE;
  if (row.kind === "pr") {
    edge = "";
  }
  return (
    <button
      type="button"
      className={cn(
        QUEUE_ROW,
        edge,
        "bg-transparent shadow-[inset_3px_0_0_var(--sw-kind,var(--c-border))]",
        kindHue({ kind: row.kind }),
        settling && "outline-dashed outline-1 -outline-offset-2 outline-primary",
      )}
      data-kind={row.kind}
      // The card's key, which `desktop e2e --call-card all` inventories the open cards by (`src/desktop/e2eCardInventory.ts`).
      data-card-key={row.key}
      data-settling={settling ? "true" : undefined}
      aria-busy={settling ? "true" : undefined}
      onClick={() => {
        onOpen(row);
      }}
      aria-current={current ? "true" : undefined}
    >
      {/* The row is one button, so every warning mark inside it draws as a labelled image, never a nested button. */}
      <InsideControl value={true}>
        <ProvenanceGlyph provenance={row.provenance} />
        <span className={QUEUE_TEXT}>
          {/* The owner's unmet proof ask on a pull request this card is about leads, ahead of a question that could skip it. */}
          <ProofGapLead row={row} opened={false} />
          <span className={QUEUE_TITLE}>
            {/* The row's number, so the owner can say "answer 3" — the briefing numbers its cards for the same reason. */}
            {number !== undefined && (
              <span className="mr-[0.45rem] inline-grid h-[1.25rem] min-w-0 place-items-center rounded-[5px] bg-primary/22 px-[0.25rem] align-[0.08rem] text-[0.68rem] font-bold text-foreground">
                {String(number)}
              </span>
            )}
            {/* The row is a link already, so a pull request reads as its number and a person as their name. */}
            {inlinePlain({ references, text: row.card.question })}
          </span>
          {/* The row's SUBJECT, never a second copy of the question: that made every row two long unreadable lines. */}
          {/* An ask's and a hand step's subject is its slug, an id line that is clutter, so neither draws it. */}
          {row.kind !== "ask" && row.kind !== "hand" && (
            <span className="mt-[0.1rem] block overflow-hidden text-[0.76rem] wrap-anywhere text-muted-foreground">
              {row.card.subject}
            </span>
          )}
          {/* A card stopping the owner's work shows its decision and options on the row itself, never folded. */}
          <StoppingLines row={row} />
          {/* The row's placement mark, so a card the default rule placed says so before the owner opens it. */}
          <FindingMark placement={row.placement} />
          {review !== undefined && <span className="text-[0.78rem] wrap-anywhere text-warning">{review}</span>}
          {/* The owner's triage ruling, so a card parked below the rest says where it went and the owner's label beside it. */}
          {row.triage !== undefined && (
            <Badge size="sm" variant="muted" data-meta="triage">
              {triagePillWords({ triage: row.triage })}
            </Badge>
          )}
          <CardLapsLine rowKey={row.key} />
        </span>
        <span className={QUEUE_META}>
          <span data-meta="kind">{KIND_WORD[row.kind]}</span>
          {priority !== undefined && (
            <span data-meta="priority" className="font-semibold text-foreground">
              {priority}
            </span>
          )}
          <ConfidenceMark row={row} nowMs={nowMs} />
          <ChevronRight className="size-[0.95rem] flex-none text-muted-foreground" aria-hidden="true" />
        </span>
      </InsideControl>
    </button>
  );
}
