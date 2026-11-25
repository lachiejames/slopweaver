"use client";

/**
 * The Fleet page's plan usage block under the state and its defence: one line for Claude and one for Codex, closed by
 * default, each opening onto its plans by alias — the account on hover — with its bars apiece and the burn. Native
 * `<details>`, so the keyboard and a screen reader open it with nothing added. Nothing here judges — every word is
 * `lib/planMeters.ts`'s derivation off the tick's recorded readings.
 */
import type { ReactElement } from "react";

import { actLineFor } from "../../lib/actVerbs";
import type { FleetUsage, HostFigure, HostUsage } from "../../lib/planMeters";
import type { PlanRail, PlanRow, PlanTone } from "../../lib/planMetersRails";
import {
  RAISE_USAGE_LIMIT_READS,
  RAISE_USAGE_LIMIT_SLUG,
  type RaiseRecord,
  raiseButtonHeldOf,
  type UsageLimitStop,
} from "../../lib/planUsageLimit";
import { cn } from "../../lib/utils";
import { BUTTON } from "../console/controls";
import { Outcome, usePress } from "../console/press";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";
import { ReadingAge } from "./ReadingAge";

/** Each plan tone's bar fill. */
const FILL: Readonly<Record<PlanTone, string>> = {
  open: "bg-success",
  stopped: "bg-warning",
  unread: "bg-muted-foreground",
};

/** One thin bar, drawn dashed and empty when nothing was measured rather than as a spent allowance. */
function Bar({
  percent,
  fill,
  measured,
  wide,
}: {
  percent: number | undefined;
  fill: string;
  measured: boolean;
  wide: boolean;
}): ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block h-[0.32rem] shrink-0 overflow-hidden rounded-full",
        wide ? "w-[5rem]" : "w-[3.6rem]",
        measured ? "bg-muted" : "border border-dashed border-muted-foreground/60",
      )}
    >
      {measured && percent !== undefined && (
        <span className={cn("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${String(percent)}%` }} />
      )}
    </span>
  );
}

/** One of a plan's bars, as a table row. */
function Rail({ rail, tone }: { rail: PlanRail; tone: PlanTone }): ReactElement {
  return (
    <tr data-rail={rail.key}>
      <th scope="row" className="py-[0.1rem] pr-2 text-left font-medium whitespace-nowrap">
        {rail.label}
      </th>
      <td className="py-[0.1rem] pr-2">
        <Bar percent={rail.barPercent} fill={FILL[tone]} measured={rail.measured} wide={false} />
      </td>
      <td className="py-[0.1rem] pr-2 tabular-nums whitespace-nowrap">{rail.figure}</td>
      <td className="py-[0.1rem] text-muted-foreground">{rail.detail}</td>
    </tr>
  );
}

/**
 * The raise under a plan stopped at its usage limit: one press writing the next step up through the act list, the verb
 * line it runs, and what the press came to. The row itself moves at the next capacity reading; routing reads the
 * register at its next pick, so the press is what lets the fleet continue.
 */
function RaiseUsageLimit({
  stop,
  held,
  record,
}: {
  stop: Extract<UsageLimitStop, { kind: "raise" }>;
  held: string | undefined;
  record: RaiseRecord;
}): ReactElement {
  const raise = usePress();
  const { readAtIso } = record;
  const pressed = raiseButtonHeldOf({ phase: raise.state.phase, pressedFrom: record.pressedFrom, readAtIso });
  return (
    <div className="grid justify-items-start gap-[0.2rem]" data-raise-usage-limit={String(stop.nextPercent)}>
      <button
        type="button"
        className={BUTTON}
        disabled={held !== undefined || pressed !== undefined}
        title={pressed}
        onClick={() => {
          if (readAtIso !== undefined) {
            record.onRaised(readAtIso);
          }
          void raise.press({ readsSlug: RAISE_USAGE_LIMIT_READS, slots: stop.slots, slug: RAISE_USAGE_LIMIT_SLUG });
        }}
      >
        {stop.label}
      </button>
      <span className="text-[0.74rem] text-muted-foreground">
        {held !== undefined && `${held}. `}
        {pressed !== undefined && `${pressed}. `}
        Routing reads the new limit at its next pick; this row moves at the next capacity reading.{" "}
        <code>{actLineFor({ slug: RAISE_USAGE_LIMIT_SLUG })}</code>
      </span>
      <Outcome state={raise.state} />
    </div>
  );
}

/**
 * One plan: its alias with the signed-in account on hover, its status, its bars and the Fable week — or, when
 * its own read failed, a staleness mark in their place.
 */
function Plan({
  row,
  raiseHeld,
  record,
}: {
  row: PlanRow;
  raiseHeld: string | undefined;
  record: RaiseRecord;
}): ReactElement {
  if (row.unread !== undefined) {
    return (
      <li className="flex flex-wrap items-baseline gap-x-[0.5rem]" data-plan={row.id}>
        <span
          className="cursor-help font-medium underline decoration-dotted underline-offset-2"
          title={row.accountTitle}
        >
          {row.alias}
        </span>
        <StaleMark facts={[row.unread]} />
      </li>
    );
  }
  return (
    <li className="grid gap-[0.15rem]" data-plan={row.id}>
      <div className="flex flex-wrap items-baseline gap-x-[0.5rem]">
        <span
          className="cursor-help font-medium underline decoration-dotted underline-offset-2"
          title={row.accountTitle}
        >
          {row.alias}
        </span>
        <span className="text-muted-foreground">{row.status}</span>
      </div>
      <table className="border-collapse">
        <tbody>
          {row.rails.map((rail) => (
            <Rail key={rail.key} rail={rail} tone={row.tone} />
          ))}
        </tbody>
      </table>
      {row.fable !== undefined && <span className="text-muted-foreground">{row.fable}</span>}
      {row.usageLimit?.kind === "raise" && (
        // Keyed on the limit shown, so a reading with a new limit draws a fresh, unpressed button.
        <RaiseUsageLimit
          key={`${row.id}:${String(row.usageLimit.limitPercent)}`}
          stop={row.usageLimit}
          held={raiseHeld}
          record={record}
        />
      )}
    </li>
  );
}

/** One figure on a host's line: its words, a spinner while its reading is in flight, or a staleness mark. */
function Figure({ figure, className }: { figure: HostFigure; className: string }): ReactElement {
  if (figure.kind === "reading") {
    return <ReadingIndicator label={`Reading ${figure.subject}`} />;
  }
  if (figure.kind === "unread") {
    const fact = { subject: figure.subject, why: figure.why };
    if (figure.shortWords === undefined) {
      return <StaleMark facts={[fact]} />;
    }
    return <StaleMark facts={[{ ...fact, shortWords: figure.shortWords }]} />;
  }
  return <span className={className}>{figure.words}</span>;
}

/**
 * One host's line, the plans it opens onto, and, outside that fold, why its burn is a lower bound: a reading problem is
 * a warning about the number on the line, so folding the plans never hides it.
 */
function Host({
  usage,
  raiseHeld,
  record,
}: {
  usage: HostUsage;
  raiseHeld: string | undefined;
  record: RaiseRecord;
}): ReactElement {
  return (
    <div className="grid gap-[0.2rem]" data-host={usage.host}>
      <HostPlans usage={usage} raiseHeld={raiseHeld} record={record} />
      {usage.burnProblems.length > 0 && (
        <ul
          aria-label={`Why ${usage.name}'s burn is a lower bound`}
          className="m-0 list-disc pl-[2.1rem] text-muted-foreground"
        >
          {usage.burnProblems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One host's line, and the plans it opens onto. */
function HostPlans({
  usage,
  raiseHeld,
  record,
}: {
  usage: HostUsage;
  raiseHeld: string | undefined;
  record: RaiseRecord;
}): ReactElement {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-[0.55rem] gap-y-[0.1rem] [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">
          ›
        </span>
        <span className="font-semibold">{usage.name}</span>
        <Bar percent={usage.remainingPercent} fill="bg-success" measured={usage.remainingPercent !== undefined} wide />
        <Figure figure={usage.average} className="tabular-nums" />
        <span className="text-muted-foreground">·</span>
        <Figure figure={usage.sessions} className="tabular-nums" />
        <span className="basis-full pl-[1.1rem]">
          <Figure figure={usage.burn} className="text-muted-foreground tabular-nums" />
        </span>
      </summary>
      <div className="grid gap-[0.45rem] pt-[0.35rem] pb-[0.2rem] pl-[1.1rem]">
        {usage.plans.kind === "reading" && <ReadingIndicator label={`Reading the ${usage.name} plans`} />}
        {usage.plans.kind === "unread" && (
          <StaleMark
            facts={[{ subject: `the ${usage.name} plans`, why: usage.plans.why }]}
            className="justify-self-start"
          />
        )}
        {usage.plans.kind === "read" && usage.plans.rows.length === 0 && (
          <p className="m-0 text-muted-foreground">the reading carries no {usage.name} plan</p>
        )}
        {usage.plans.kind === "read" && usage.plans.rows.length > 0 && (
          <ul
            aria-label={`Each ${usage.name} plan's usage against its limits`}
            className="m-0 grid list-none gap-[0.45rem] p-0"
          >
            {usage.plans.rows.map((row) => (
              <Plan key={row.id} row={row} raiseHeld={raiseHeld} record={record} />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/**
 * Claude's line, then Codex's, then whatever is on neither, under a heading saying how old the reading is and who took
 * it: plan usage is the supervisor's tick reading, never the page's own two-second read.
 *
 * @param record the readings this page pressed a raise from, held by the tile above, since a press can unmount these rows
 * @param readAtIso when the supervisor's capacity reading the plans come from was taken, when one is held
 * @returns the block
 */
export function PlanUsage({
  usage,
  record,
  readAtIso,
}: {
  usage: FleetUsage;
  record: RaiseRecord;
  readAtIso: string | undefined;
}): ReactElement {
  return (
    <div className="grid gap-[0.3rem] text-[0.8rem]" aria-label="Plan usage by provider">
      <p className="m-0 text-[0.74rem] text-muted-foreground" data-plan-usage-age="">
        Plan usage by provider · {readAtIso === undefined && <>reading not in hand</>}
        {readAtIso !== undefined && (
          <>
            read <ReadingAge iso={readAtIso} /> · by the supervisor
          </>
        )}
      </p>
      {usage.hosts.map((host) => (
        <Host key={host.host} usage={host} raiseHeld={usage.raiseHeld} record={record} />
      ))}
      {usage.unattributedWords !== undefined && (
        <p className="m-0 text-[0.74rem] text-muted-foreground" data-unattributed="">
          {usage.unattributedWords}
        </p>
      )}
    </div>
  );
}
