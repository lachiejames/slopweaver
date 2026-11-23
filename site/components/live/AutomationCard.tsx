"use client";

/**
 * One automation as a collapsed card: a health chip, its plain name, why it is down or else what it is for, and
 * the few words a glance wants — how long it usually takes, how many recent runs worked, when it last broke. Its id
 * is the anchor, never the title.
 *
 * Opening one leads with ONE plain sentence saying what it is and what the owner gets from it, then — when it is broken or
 * paused — the five answers the owner asked for (`./BrokenAnswers.tsx`), then what it produced and how to steer it, which
 * speaks to the supervisor through the page's one steer box (`./AutomationDetail.tsx`). Everything operational folds
 * below that: how long it takes, how often it works and its recent runs; the requests already sent and the row's
 * dated timeline; and the verb's technical records — cadence, destination, firings, the row id.
 *
 * Every field is `automation status`'s (`src/automations/card.ts`).
 */
import { type ReactElement, useEffect, useRef } from "react";

import { ageOf } from "../../lib/ageOf";
import { cn } from "../../lib/utils";
import {
  DETAIL_HEAD,
  type OnAutomationOpen,
  Outputs,
  RecentRuns,
  SteerNote,
  Steers,
  Timeline,
} from "./AutomationDetail";
import { LedgerMark, TechnicalDetail } from "./AutomationTechnical";
import { Answer, BrokenAnswers } from "./BrokenAnswers";
import type { Automation } from "./readAutomationsCard";

/** Health → chip colour. Precedence is the verb's; this only paints it. */
const HEALTH_TONE: Readonly<Partial<Record<string, string>>> = {
  failed: "bg-danger/15 text-danger border-danger/50",
  healthy: "bg-success/10 text-success border-success/40",
  "not-measured": "border-dashed border-muted-foreground/50 text-muted-foreground",
  off: "border-dashed border-muted-foreground/50 text-muted-foreground",
  paused: "bg-muted text-muted-foreground border-muted-foreground/50",
  running: "bg-info/10 text-info border-info/40",
  stopped: "bg-warning/15 text-warning border-warning/50",
  stuck: "bg-warning/15 text-warning border-warning/50",
  waiting: "bg-warning/10 text-warning border-warning/40",
};

/** The chip colour for a health; one this page has no colour for is drawn neutral. */
function healthTone({ health }: { health: string }): string {
  const tone = HEALTH_TONE[health];
  if (tone === undefined) {
    return "border-border text-muted-foreground";
  }
  return tone;
}

/**
 * The health chip.
 *
 * @returns the chip
 */
export function HealthChip({ health }: { health: string }): ReactElement {
  return (
    <span
      className={cn(
        "w-24 flex-none rounded-full border px-2 py-[0.1rem] text-center font-mono text-[0.66rem] tracking-[0.03em] uppercase",
        healthTone({ health }),
      )}
    >
      {health}
    </span>
  );
}

/** "last broke 3.0d ago", or that the ledger holds no break. */
function brokeWords({ automation }: { automation: Automation }): string | ReactElement {
  if (automation.lastBrokeIso === undefined && automation.firingsGap !== undefined) {
    return (
      <>
        last break <LedgerMark gap={automation.firingsGap} />
      </>
    );
  }
  if (automation.lastBrokeIso === undefined) {
    return "no break on record";
  }
  return `last broke ${ageOf({ iso: automation.lastBrokeIso })}`;
}

/**
 * The card's title: its plain name, or its id only when this build names it nothing — the id stays as the
 * element's anchor either way.
 */
function titleOf({ automation }: { automation: Automation }): string {
  if (automation.name === undefined) {
    return automation.recipeId;
  }
  return automation.name;
}

/**
 * The line under the title: what went wrong and what fixes it when the record says, else why it is down when it is,
 * else what it is for, else what it is doing. The verb's own `why` is a technical record, so it sits in the Technical
 * detail fold and never here.
 */
function subtitleOf({ automation }: { automation: Automation }): string {
  const { account } = automation;
  if (account?.plainly !== undefined) {
    return account.plainly;
  }
  if (account !== undefined) {
    return account.why;
  }
  if (automation.forWhat !== undefined) {
    return automation.forWhat;
  }
  return automation.nowDoing;
}

/**
 * Words read off the firing history, with the slot ledger's staleness mark beside them when it did not read whole —
 * the verb leaves a zero that ledger may hide unsaid, so the mark alone is drawn where nothing else is.
 */
function HistoryWords({ words, gap }: { words: string; gap: string | undefined }): ReactElement {
  if (gap === undefined) {
    return <>{words}</>;
  }
  if (words === "") {
    return <LedgerMark gap={gap} />;
  }
  return (
    <>
      {words} <LedgerMark gap={gap} />
    </>
  );
}

/**
 * The ONE plain sentence an open card leads with: what the automation is and what the owner gets from it. A card that opens on
 * detail and never says what it is tells the reader much and nothing they care about. Every registered kind declares one (`src/automations/purposeNames.ts`), so the gap line is only ever a row
 * of a kind this build no longer registers.
 */
function PurposeSentence({ automation }: { automation: Automation }): ReactElement {
  if (automation.forWhat === undefined) {
    return (
      <p className="m-0 text-[0.86rem] text-warning">
        This build does not say what this automation is: its kind, {automation.kind}, is not one it registers.
      </p>
    );
  }
  return <p className="m-0 text-[0.86rem] leading-snug">{automation.forWhat}</p>;
}

/** How long it takes and how often it works, the two answers every card owes the owner whether or not it is broken. */
function RunAnswers({ automation }: { automation: Automation }): ReactElement {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-solid border-border p-2">
      <Answer question="How long does it take?">
        <HistoryWords words={automation.durationWords} gap={automation.firingsGap} />
      </Answer>
      <Answer question="How often does it work?">
        <HistoryWords words={automation.reliabilityWords} gap={automation.firingsGap} />
      </Answer>
    </section>
  );
}

/**
 * One automation.
 *
 * @param automation the row, as `readAutomations` read it
 * @param nowIso the page's reading instant, which every clock on the card is said against
 * @param newBreaks its failures since the owner last looked, `undefined` on a first look with no mark to count from
 * @param onOpen told when the owner opens or folds the card, so a word in the call names the open card the owner is reading and
 *   never one the owner has closed
 * @returns the card
 */
export function AutomationCard({
  automation,
  nowIso,
  newBreaks,
  onOpen,
}: {
  automation: Automation;
  nowIso: string;
  newBreaks: number | undefined;
  onOpen: OnAutomationOpen;
}): ReactElement {
  const card = useRef<HTMLDetailsElement>(null);
  // `/automations#<recipe-id>` opens that card, so a Queue card or a reply can link straight to one row.
  useEffect(() => {
    if (card.current !== null && window.location.hash === `#${automation.recipeId}`) {
      card.current.open = true;
      card.current.scrollIntoView({ block: "start" });
    }
  }, [automation.recipeId]);
  return (
    <details
      ref={card}
      className="group rounded-[10px] border border-solid sw-glass-plane px-3 py-2 text-[0.8rem] open:pb-3"
      id={automation.recipeId}
      onToggle={(event) => {
        const key = automation.steering.key;
        if (key === undefined) {
          return;
        }
        onOpen({ about: key, open: event.currentTarget.open });
      }}
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-3">
        <HealthChip health={automation.health} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{titleOf({ automation })}</span>
          <span className="truncate text-[0.74rem] text-muted-foreground">{subtitleOf({ automation })}</span>
        </span>
        {newBreaks !== undefined && newBreaks > 0 && (
          <span className="flex-none rounded-full border border-danger/50 bg-danger/15 px-2 font-mono text-[0.66rem] text-danger">
            {newBreaks} failed since you looked
          </span>
        )}
        <span className="flex-none text-right font-mono text-[0.68rem] text-muted-foreground">
          <HistoryWords words={automation.glanceWords} gap={automation.firingsGap} /> · {brokeWords({ automation })}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2">
        <PurposeSentence automation={automation} />
        <BrokenAnswers automation={automation} nowIso={nowIso} />
        <h4 className={DETAIL_HEAD}>What it produced</h4>
        <Outputs outputs={automation.outputs} />
        <h4 className={DETAIL_HEAD}>Steer it</h4>
        <SteerNote automation={automation} />
        <details className="mt-2 text-[0.72rem]">
          <summary className="cursor-pointer text-muted-foreground">How it has been running</summary>
          <div className="mt-1 flex flex-col gap-1">
            <RunAnswers automation={automation} />
            <RecentRuns automation={automation} nowIso={nowIso} />
          </div>
        </details>
        <details className="text-[0.72rem]">
          <summary className="cursor-pointer text-muted-foreground">Requests and changes</summary>
          <div className="mt-1 flex flex-col gap-1">
            <Steers gap={automation.steering.storeGap} steers={automation.steering.steers} />
            <Timeline gap={automation.steering.storeGap} timeline={automation.steering.timeline} />
          </div>
        </details>
        <TechnicalDetail automation={automation} />
      </div>
    </details>
  );
}
