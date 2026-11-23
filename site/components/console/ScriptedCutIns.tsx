"use client";

/**
 * The cut-ins chart on the Alignment page: each time what reads as the console's own progress line cut into an answer
 * the voice was already giving, one point per week, so the owner can see it going away.
 *
 * The failure it counts: the voice starts one answer, cuts off halfway and gives a different one. The console's
 * progress line was spoken 15s into a delegated turn, then every 30s, and could not be withdrawn once written, so when
 * the turn finished inside that second the line could land inside the answer, the most likely cause of what the owner
 * heard: a call records the words, never which of the two said them. This counts it rather than fixing it. The console
 * no longer speaks the line and plays a sound instead, so the count reads history and takes nothing from
 * `PROGRESS_SPEECH_RETIRED_ISO` (`src/talk/progressLine.ts`) on. No bars under the line: there is no baseline here
 * that a quiet week could be mistaken for.
 *
 * Counts come from `slopweaver talk cut-ins --json` (`src/talk/scriptedCutIns.ts`).
 */

import { type ReactElement, useState } from "react";

import { readerTimeZone } from "../../lib/dateTimeFormat";
import { perDay, weekly, windowDays } from "../../lib/slackSteers";
import { cn } from "../../lib/utils";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import { ReadingAge } from "../live/ReadingAge";
import { readScriptedCutIns, type ScriptedCutIns } from "../live/readScriptedCutIns";
import { readyValueOf, useLive } from "../live/useLive";
import { BUTTON } from "./controls";
import { StaleMark } from "./StaleMark";
import { WeeklyChart } from "./WeeklyChart";

const CARD = "sw-glass-plane mb-3 rounded-[14px] border border-solid px-[1.1rem] py-[0.9rem]";

/**
 * How often an open page re-reads the cut-ins, so the total follows a call the owner has just finished rather than the
 * one the page opened on (numbers that change between loads are live). Five minutes,
 * the `fleet history` cadence: one read is a cold CLI start over every call file in sixty days, 1.33s over 146 calls
 * measured (`/usr/bin/time -p slopweaver talk cut-ins --json`) — cheap at that cadence, and a call lasts
 * longer than five minutes.
 */
const CUT_INS_POLL_MS = 300_000;

/** The line's colour, identity only — never a state. */
const CUT_IN_COLOUR = "oklch(0.66 0.17 330)";

/** A date as the page prints it, day then short month. */
function shortDay({ iso }: { iso: string }): string {
  return new Date(Date.parse(iso)).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** The owner's browser zone: the calendar their days are counted on. */
function ownerZone(): string {
  return readerTimeZone();
}

/** The reading drawn: the line, its total, and each occurrence behind a press. */
function Drawn({ reading }: { reading: ScriptedCutIns }): ReactElement {
  const [open, setOpen] = useState(false);
  const zone = ownerZone();
  const days = windowDays({ nowIso: reading.observedAtIso, sinceIso: reading.sinceIso, timeZone: zone });
  const counts = weekly({ counts: perDay({ days, isos: reading.cutIns.map((cut) => cut.atIso), timeZone: zone }) });
  const newest = reading.cutIns.toReversed();
  return (
    <>
      <WeeklyChart
        series={[{ colour: CUT_IN_COLOUR, counts, key: "cut-ins" }]}
        reviewed={undefined}
        width={640}
        height={80}
      />
      <p className="mt-[0.2rem] mb-0 flex justify-between text-[0.7rem] text-muted-foreground">
        <span>{shortDay({ iso: reading.sinceIso })}</span>
        <span>one point per week</span>
        <span>{shortDay({ iso: reading.observedAtIso })}</span>
      </p>
      <p
        className="mt-[0.5rem] mb-0 flex items-center gap-[0.35rem] text-[0.8rem]"
        data-testid="scripted-cut-ins-total"
      >
        {String(reading.cutIns.length)} cut into an answer, across {String(reading.calls)} voice calls
        {/* A call or line that did not read may hold a cut-in, so the total is marked short, with each on hover. */}
        {reading.gaps.length > 0 && (
          <StaleMark facts={reading.gaps.map((why) => ({ subject: "part of your calls", why }))} />
        )}
      </p>
      {newest.length > 0 && (
        <button
          type="button"
          className={cn(BUTTON, "mt-[0.4rem]")}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? "hide each one" : "each one"}
        </button>
      )}
      {open && (
        <ul className="my-[0.5rem] list-none pl-0 text-[0.82rem]" data-testid="scripted-cut-ins-list">
          {newest.map((cut) => (
            <li key={cut.anchor} className="mb-[0.45rem]">
              <span className="text-muted-foreground">{shortDay({ iso: cut.atIso })}</span> …{cut.before.slice(-100)}{" "}
              <strong>{cut.line}</strong>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The cut-ins section, under Slack steers on the Alignment page.
 *
 * @returns the section
 */
export function ScriptedCutInsSection(): ReactElement {
  const cutIns = useLive<ScriptedCutIns>({
    everyMs: CUT_INS_POLL_MS,
    read: readScriptedCutIns,
    slug: "scripted-cut-ins",
  });
  const reading = readyValueOf({ state: cutIns });
  return (
    <section className={CARD} data-testid="scripted-cut-ins" aria-label="Voice cut-ins">
      <div className="mb-[0.6rem] flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[0.95rem] font-[650]">Voice cut-ins</h2>
        {cutIns.phase === "ready" && (
          <ReadingAge iso={cutIns.observedAtIso} className="text-[0.72rem] text-muted-foreground" />
        )}
      </div>
      {cutIns.phase === "ready" ? (
        <ReadMark state={cutIns} subject="your calls" row />
      ) : (
        <ReadStandIn state={cutIns} subject="your calls" block />
      )}
      {reading !== undefined && <Drawn reading={reading} />}
    </section>
  );
}
