"use client";

/**
 * The ask line in a pull request's summary and the ask trail in its fold — who was asked, where, how long
 * ago, and whether to ask again. The words are `site/lib/reviewHook.ts`'s; this file only draws them.
 *
 * Its own file because `PullRequests.tsx` is near the 300-line cap, and because the line is drawn in
 * three places — the row, its fold and the slide-over — that must never disagree about a name.
 */

import type { ReactElement } from "react";

import { ageOf } from "../../lib/ageOf";
import { toneVariant } from "../../lib/consoleTone";
import { type AgainChip, type AgoWords, askLineOf, trailLinesOf } from "../../lib/reviewHook";
import type { PersonLabel, SlackPeople } from "../../lib/slackPeople";
import { Badge } from "../ui/badge";
import { ROW_DETAIL } from "./Row";
import type { LandingRow } from "./readLanding";

/** The page's own age wording, as the seam `reviewHook` takes. */
const ago: AgoWords = (iso) => ageOf({ iso });

/** The ask line: full width under the card, so it is read before the fold, its names in ink. */
const ASK =
  "flex flex-[1_1_100%] flex-wrap items-center gap-x-[0.55rem] gap-y-[0.35rem] text-[0.76rem] text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground";

/** A confident "nobody asked" is the one line that reads in ink: it is the one a reader acts on. */
const ASK_NOBODY = "font-semibold text-foreground";

/** The messages a read could not settle, as numbered links rather than a wall of URLs. */
const UNSETTLED = "inline-flex gap-[0.4rem]";

/**
 * The people an ask named, comma-separated, each with its Slack id on hover.
 *
 * @returns the names
 */
function Who({ who }: { who: readonly PersonLabel[] }): ReactElement {
  return (
    <>
      {who.map((label, index) => (
        <span key={label.title}>
          {index > 0 ? ", " : ""}
          <b title={label.title}>{label.text}</b>
        </span>
      ))}
    </>
  );
}

/**
 * The messages the verb could not settle, as numbered links — each opens one, and none toggles the row.
 *
 * @returns the links, or nothing when there are none
 */
function Unsettled({ links }: { links: readonly string[] }): ReactElement | null {
  if (links.length === 0) {
    return null;
  }
  return (
    <span className={UNSETTLED}>
      {links.map((href, index) => (
        <a
          key={href}
          href={href}
          rel="noreferrer"
          target="_blank"
          title={href}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          {String(index + 1)}
        </a>
      ))}
    </span>
  );
}

/**
 * The ask line drawn in a row's summary, full width under the card. Its message link stops the click from
 * also toggling the row, as the `open` button does.
 *
 * @param people the names the reading resolved
 * @returns the line
 */
export function PrAskLine({ row, people }: { row: LandingRow; people: SlackPeople }): ReactElement {
  const line = askLineOf({ ago, people, row });
  let lead: ReactElement = <span className={line.kind === "nobody-asked" ? ASK_NOBODY : undefined}>{line.text}</span>;
  if (line.kind === "asked") {
    lead = (
      <span>
        asked <Who who={line.who} /> {line.text}
      </span>
    );
  }
  // The shared state leads with its clock: the badge is what the owner reads first, the post and the reason follow.
  const badgeFirst = line.kind === "shared";
  const badge = line.again === undefined ? null : <AgainBadge chip={line.again} />;
  return (
    <span className={ASK} data-hook={line.kind}>
      {badgeFirst ? badge : null}
      {lead}
      {line.permalink === undefined ? null : (
        <a
          href={line.permalink}
          rel="noreferrer"
          target="_blank"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          message
        </a>
      )}
      <Unsettled links={line.unsettled} />
      {badgeFirst ? null : badge}
      {line.note === undefined ? null : <span className={NOTE}>{line.note}</span>}
    </span>
  );
}

/** The line under a shared badge: full width, so it sits beneath the badge rather than beside it. */
const NOTE = "flex-[1_1_100%]";

/**
 * The chip beside an ask line — whether to ask again, or the shared state's clock.
 *
 * @returns the badge
 */
function AgainBadge({ chip }: { chip: AgainChip }): ReactElement {
  return (
    <Badge
      variant={toneVariant({ tone: chip.tone })}
      size="sm"
      className="border-0 px-[0.45rem] text-[0.7rem] leading-[1.5] font-normal"
      title={chip.title}
    >
      {chip.text}
    </Badge>
  );
}

/**
 * Every ask on the row, newest first, each with its message. With none it draws nothing: the ask line is
 * always drawn above it, already saying why, and a second copy of that sentence is noise.
 *
 * @param people the names the reading resolved
 * @returns the trail, or nothing when the row has no ask
 */
export function PrAskTrail({ row, people }: { row: LandingRow; people: SlackPeople }): ReactElement | null {
  const lines = trailLinesOf({ ago, people, row });
  if (lines.length === 0) {
    return null;
  }
  return (
    <ul className={ROW_DETAIL}>
      {lines.map((line) => (
        <li key={line.key}>
          asked <Who who={line.who} /> {line.text} ·{" "}
          <a href={line.permalink} rel="noreferrer" target="_blank">
            message
          </a>
        </li>
      ))}
    </ul>
  );
}
