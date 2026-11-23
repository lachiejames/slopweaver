/** The pill a sidebar count draws, and the mark standing in its place while there is no number to print. */
import type { ReactElement } from "react";
import { ageOf } from "../../lib/ageOf";
import type { ReasonWords } from "../../lib/quotedReason";
import {
  countStandInOf,
  failedCountFactsOf,
  type SidebarReading,
  sidebarReadOf,
  staleCountFactsOf,
  type UnmeasuredStandIn,
  updatingCountLabelOf,
  withheldCountFactsOf,
} from "../../lib/sidebarCountsBasis";
import { cn } from "../../lib/utils";
import { ReadStandIn } from "../live/LiveMarks";
import type { LiveState } from "../live/useLive";
import { CounterLabel } from "../ui/counter-label";
import { ReadingIndicator } from "./ReadingIndicator";
import { WarningMark } from "./WarningMark";

/**
 * What a badge over polled readings is doing about a failed one: each of them polls on the sidebar's cadence while the
 * window is in view (`./ShellBadges.tsx` `SIDEBAR_POLL_MS`), and a hidden window holds its polls (`../live/useLive.ts`).
 */
const POLLED_NEXT = "The console reads it again on its next poll, within a minute while this window is in view";

/**
 * The icon rail draws a count as a bare dot at the glyph's corner: primary when something waits, the border
 * colour when nothing does or nothing was measured. Written once, so every badge shrinks the same way.
 */
const RAIL_DOT =
  "group-data-[sidebar=icons]/console:absolute group-data-[sidebar=icons]/console:top-[0.15rem] group-data-[sidebar=icons]/console:right-[0.35rem] group-data-[sidebar=icons]/console:size-[0.55rem] group-data-[sidebar=icons]/console:min-w-0 group-data-[sidebar=icons]/console:overflow-hidden group-data-[sidebar=icons]/console:p-0 group-data-[sidebar=icons]/console:text-[0px] group-data-[sidebar=icons]/console:text-transparent";

/** The rail dot's fill, hot or not. */
const RAIL_HOT = "group-data-[sidebar=icons]/console:bg-primary";
const RAIL_COLD = "group-data-[sidebar=icons]/console:bg-border";

/**
 * A stale count: the mark, then the number. The icon rail prints no number at all, so there the mark takes the dot's
 * corner in its place — a rail that dropped the mark would draw an older count as a current one. The mark is always
 * the warning glyph, carrying the reading's age and cause, never the page's Connect chip, which would drop both and
 * spill a chip's width across the rail.
 */
const STALE_COUNT =
  "ml-auto inline-flex items-center gap-[0.25rem] group-data-[sidebar=icons]/console:absolute group-data-[sidebar=icons]/console:top-0 group-data-[sidebar=icons]/console:right-[0.15rem]";

/**
 * A measured count in the sidebar: the exact number, primary when something waits.
 *
 * The cap is lifted to the count itself — a sidebar number is a measured claim, and turning 301 into `99+`
 * would print a number the reading never said.
 *
 * @param title what the number means, in words a reader can see on hover
 * @returns the pill
 */
export function SideCount({
  attention,
  n,
  title,
}: {
  /**
   * Whether a nonzero count is drawn as something waiting — false keeps a plain count in the neutral colour. The
   * entry's decision in `SIDEBAR_ENTRIES` says which, never the badge itself.
   */
  attention: boolean;
  n: number;
  title: string;
}): ReactElement {
  const hot = attention && n > 0;
  return (
    <CounterLabel
      count={n}
      max={Math.max(99, n)}
      scheme={hot ? "primary" : "secondary"}
      className={cn("ml-auto px-[0.4rem] font-normal", RAIL_DOT, hot ? RAIL_HOT : RAIL_COLD)}
      title={title}
    />
  );
}

/**
 * The mark standing where a count would sit while there is none to print.
 *
 * A badge still being read is a spinner, and one that could not be read — or whose latest read failed over an
 * earlier reading — is a staleness mark whose hover says why, in the same place a number would sit: an empty badge
 * reads as zero, and zero is a measured claim this cannot make. A current reading its caller has not yet placed
 * draws the spinner too, never a number.
 *
 * @returns the pill
 */
export function CountStandIn({ state }: { state: LiveState<unknown> | UnmeasuredStandIn }): ReactElement {
  const pill = cn("ml-auto inline-flex min-w-[1.4rem] justify-center rounded-full", RAIL_DOT, RAIL_COLD);
  // A count judges by the latest read (`latestReadOf`): one drawn over a failed read is not a current number, and
  // the sidebar sits nowhere near the page mark that would say so (`countStandInOf`).
  const standIn = countStandInOf({ state });
  if (standIn.phase === "stale") {
    // Not the rail's dot: a dot reads as a quiet count, and this is a read that failed. The warning glyph itself, never
    // `StaleMark`'s Connect chip, so the age and cause always travel and the rail stays a dot's width.
    return (
      <span className={STALE_COUNT}>
        <WarningMark facts={[{ observedAtIso: standIn.observedAtIso, subject: "this count", why: standIn.why }]} />
      </span>
    );
  }
  return (
    <span className={pill}>
      <ReadStandIn state={standIn} subject="this count" />
    </span>
  );
}

/**
 * The mark standing where a count would sit while the console WITHHOLDS its number on purpose — nothing failed, so it
 * says "This count is not shown: <why>.", never "could not be read" (`withheldCountFactsOf`).
 *
 * @param reason why the count is withheld: the console's own words, or the read reasons it quotes
 * @param next what the console is doing about it, from the refresh's own state (`landingRefreshPlanOf`)
 * @returns the pill
 */
export function WithheldCount({ reason, next }: { reason: ReasonWords; next: string }): ReactElement {
  return (
    <span className={STALE_COUNT}>
      <WarningMark facts={withheldCountFactsOf({ next, reason })} />
    </span>
  );
}

/**
 * A count in the sidebar off one live reading, or the reason there is none.
 *
 * @param measure the count and what it means, derived together from the same value — never a constant title, because
 *   a reading old enough to have lost a field cannot support the sentence a newer one can — or why the value read
 *   supports no number, such as a row of a kind the count cannot place
 * @returns the pill
 */
export function LiveCountBadge<T>({
  state,
  measure,
  attention,
}: {
  state: LiveState<T>;
  measure: (value: T) => SidebarReading;
  /** Whether a nonzero count is drawn as something waiting on the owner — false for a plain count, such as how many agents are working. */
  attention: boolean;
}): ReactElement {
  // A reading handed over on mount (`refreshing`) is provisional until the read it started lands (`sidebarReadOf`).
  if (sidebarReadOf({ state }).phase !== "ready" || state.phase !== "ready") {
    return <CountStandIn state={state} />;
  }
  return <ReadingCountBadge attention={attention} next={POLLED_NEXT} reading={measure(state.value)} />;
}

/**
 * A count in the sidebar made from several readings: printed once every one has read, else the mark for why not. A
 * number taken off an older reading prints with a mark beside it, never bare; the icon rail, which prints no number,
 * draws the mark where its dot would sit. The mark says which of two things it is, since a count merely being updated
 * that reads "It failed with a technical error" reads as broken:
 *
 * - **being updated** — nothing failed: the console's one progress indicator, its hover saying how old the number is and
 *   what is being read now (`updatingCountLabelOf`), never the warning glyph;
 * - **a read failed** — the warning glyph, each failed read said in plain words with its raw message folded, then what
 *   the console is doing about it, `next` (`staleCountFactsOf`, `failedCountFactsOf`).
 *
 * @param next what the console is doing about a failed read, off its runner's real state, never a promise an age implies
 * @returns the pill
 */
export function ReadingCountBadge({
  reading,
  attention,
  next,
}: {
  reading: SidebarReading;
  attention: boolean;
  next: string;
}): ReactElement {
  if (reading.phase !== "measured") {
    if ("failures" in reading) {
      return (
        <span className={STALE_COUNT}>
          <WarningMark facts={failedCountFactsOf({ failures: reading.failures, next })} />
        </span>
      );
    }
    return <CountStandIn state={reading} />;
  }
  const count = <SideCount attention={attention} n={reading.count.count} title={reading.count.title} />;
  if (reading.stale === undefined) {
    return count;
  }
  let mark = <WarningMark facts={staleCountFactsOf({ next, reading })} />;
  if (reading.stale.kind === "updating") {
    mark = <ReadingIndicator label={updatingCountLabelOf({ age: (iso) => ageOf({ iso }), stale: reading.stale })} />;
  }
  return (
    <span className={STALE_COUNT}>
      {mark}
      <span className="group-data-[sidebar=icons]/console:hidden">{count}</span>
    </span>
  );
}
