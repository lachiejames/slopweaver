"use client";

/*
 * The right-hand panel on an Alignment act card: the guidance related to that act, the way a Queue card's sidebar
 * names its related work. What counts as related is `../../lib/relatedGuidance.ts`; this only draws it. The closest
 * few show and the rest fold, so a kind that many rules mention never turns the card into a wall.
 */
import type { ReactElement } from "react";

import type { GuidanceView } from "../../lib/alignmentGuidance";
import { type RelatedEntry, relatedGuidance } from "../../lib/relatedGuidance";
import { ReadStandIn } from "../live/LiveMarks";
import type { LiveState } from "../live/useLive";

/** How many mentions show before the rest fold. */
const SHOWN = 3;

/** One related entry: its words, clamped, where to check them, and — for a mention — which kind words it names. */
function Entry({ entry, named }: { entry: RelatedEntry; named?: readonly string[] }): ReactElement {
  return (
    <li className="min-w-0" title={entry.source}>
      <span className="line-clamp-2 break-words">{entry.text}</span>
      <code className="text-[0.68rem] text-muted-foreground">{entry.citation}</code>
      {named !== undefined && (
        <span className="block text-[0.68rem] text-muted-foreground">names {named.join(", ")}</span>
      )}
    </li>
  );
}

/** A stacked list of entries. */
const LIST = "m-0 grid list-none gap-[0.35rem] p-0";

/**
 * The panel, or the guidance read's spinner or staleness mark until it has read.
 *
 * @param guidance the guidance read, shared with the page's guidance section
 * @param kind the act's kind
 * @param subject the act's subject, which a scoped standing rule must admit
 * @returns the panel
 */
export function RelatedGuidancePanel({
  guidance,
  kind,
  subject,
}: {
  guidance: LiveState<GuidanceView>;
  kind: string;
  subject: string;
}): ReactElement {
  if (guidance.phase !== "ready") {
    return (
      <aside className="text-[0.75rem]" data-testid="related-guidance">
        <ReadStandIn state={guidance} subject="your guidance" />
      </aside>
    );
  }
  const { settles, mentions, unread } = relatedGuidance({ kind, subject, view: guidance.value });
  return (
    <aside className="grid content-start gap-[0.45rem] text-[0.75rem]" data-testid="related-guidance">
      <p className="m-0 text-[0.72rem] text-muted-foreground">Related guidance</p>
      {settles.length > 0 && (
        <div>
          <p className="m-0 mb-[0.2rem] font-semibold">Settles this kind</p>
          <ul className={LIST}>
            {settles.map((entry) => (
              <Entry key={`${entry.citation}:${entry.text}`} entry={entry} />
            ))}
          </ul>
        </div>
      )}
      {mentions.length > 0 && (
        <div>
          <p className="m-0 mb-[0.2rem] font-semibold">Mentions its words</p>
          <ul className={LIST}>
            {mentions.slice(0, SHOWN).map((entry) => (
              <Entry key={`${entry.citation}:${entry.text}`} entry={entry} named={entry.named} />
            ))}
          </ul>
          {mentions.length > SHOWN && (
            <details className="mt-[0.3rem]">
              <summary className="cursor-pointer text-muted-foreground">{String(mentions.length - SHOWN)} more</summary>
              <ul className={`${LIST} mt-[0.3rem]`}>
                {mentions.slice(SHOWN).map((entry) => (
                  <Entry key={`${entry.citation}:${entry.text}`} entry={entry} named={entry.named} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {settles.length === 0 && mentions.length === 0 && (
        <p className="m-0 text-muted-foreground italic">Nothing in your guidance settles or mentions {kind}.</p>
      )}
      {unread.length > 0 && <p className="m-0 text-warning">not read: {unread.join(", ")}</p>}
    </aside>
  );
}
