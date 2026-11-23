"use client";

/*
 * The Fleet page's machine charts: the last hour of CPU (fleet stacked under everything else, in cores), the 1-minute
 * load against the line the capacity gate holds new sessions at, and physical memory against the machine's whole,
 * each off `slopweaver machine series`. The arithmetic and the owner's words asking for it are `../../lib/machineSeries.ts`;
 * this file only draws. One axis per chart: CPU and load measure different things and never share one.
 *
 * Two hues, identity only and never a state: blue for fleet (and for the one series of the load and memory charts),
 * orange for everything else, each stepped for the light and the dark console. Both pairs pass the dataviz palette
 * validator against its light and dark surfaces (adjacent CVD ΔE 24.7 light / 26.8 dark, normal-vision 33.6 / 31.8):
 * `node <dataviz skill>/scripts/validate_palette.js "#2a78d6,#eb6834" --mode light` and `"#3987e5,#d95926" --mode
 * dark`. The hold is a dashed reference line in muted ink, never a series hue. Every value a sample
 * draws is also in its hover title and the table behind the fold, so nothing rests on colour or on hovering.
 *
 * The SVG draws marks only; every figure and label is HTML in the console's own ink tokens, for the reason
 * `./SteersChart.tsx` gives (an SVG text fill escapes the theme's contrast tests). A hovered sample is marked by a
 * backdrop behind the marks across the chart's height, the crosshair.
 */

import type { ReactElement } from "react";

import { readerTimeZone } from "../../lib/dateTimeFormat";
import {
  ageWordsOf,
  clockLabel,
  coresWords,
  endWordOf,
  gbWords,
  joinWordsOf,
  type MachineOther,
  type MachineSeries,
  NOW_TICK_MS,
  startWordOf,
} from "../../lib/machineSeries";
import { useNow } from "../console/QueueSections";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";
import { CpuChart, LoadChart, MemoryChart } from "./MachineChartsPanels";
import type { LiveState } from "./useLive";

/**
 * The owner's browser's own zone, which every clock label is read in.
 *
 * @returns the IANA zone
 */
function browserZone(): string {
  return readerTimeZone();
}

/**
 * The heaviest other groups on one axis, as one line.
 *
 * @returns the phrase, or `undefined` when there are none
 */
function othersWords({
  others,
  figure,
}: {
  others: readonly MachineOther[];
  figure: (other: MachineOther) => string;
}): string | undefined {
  if (others.length === 0) {
    return undefined;
  }
  return others
    .map((other) => {
      let count = "";
      if (other.processCount > 1) {
        count = ` over ${String(other.processCount)} processes`;
      }
      return `${other.label} ${figure(other)}${count}`;
    })
    .join(" · ");
}

/** Everything the charts draw, sample by sample, newest first. */
function SampleTable({ series, timeZone }: { series: MachineSeries; timeZone: string }): ReactElement {
  return (
    <details className="text-[0.75rem]">
      <summary className="cursor-pointer text-muted-foreground">
        the numbers, sample by sample ({series.samples.length} in the last hour)
      </summary>
      <table className="mt-[0.3rem] w-full border-collapse text-left tabular-nums">
        <thead className="text-muted-foreground">
          <tr>
            <th className="font-semibold">at</th>
            <th className="font-semibold">fleet cpu</th>
            <th className="font-semibold">other cpu</th>
            <th className="font-semibold">load</th>
            <th className="font-semibold">hold</th>
            <th className="font-semibold">memory</th>
            <th className="font-semibold">compressor</th>
            <th className="font-semibold">swap</th>
          </tr>
        </thead>
        <tbody>
          {series.samples.toReversed().map((sample) => (
            <tr key={sample.observedAtIso}>
              <td>{clockLabel({ iso: sample.observedAtIso, timeZone })}</td>
              <td>{coresWords({ pct: sample.cpu.fleetPct })}</td>
              <td>{coresWords({ pct: sample.cpu.otherPct })}</td>
              <td>{sample.load.load1}</td>
              <td>{sample.load.holdAt}</td>
              <td>{gbWords({ bytes: sample.memory.usedBytes })}</td>
              <td>{sample.memory.compressorSegmentsPct}%</td>
              <td>{sample.memory.swapUsedGb} GB</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * The machine's last hour, charted on the Fleet page's Past view, with the newest sample's age said in one line. The
 * live figures, read every two seconds, are the Now view's Machine tile (`./LiveMachine.tsx`); these charts are the
 * history behind them.
 *
 * @param state the `machine-series` channel
 * @returns the section
 */
export function MachineCharts({ state }: { state: LiveState<MachineSeries> }): ReactElement {
  // The wall clock on a tick, so a reading that stops refreshing turns from "now" to dated without a new poll.
  const nowMs = useNow({ everyMs: NOW_TICK_MS });
  if (state.phase === "loading") {
    return <ReadingIndicator label="Sampling the machine" block />;
  }
  if (state.phase === "not-measured") {
    return <StaleMark facts={[{ subject: "the live machine sample the charts draw", why: state.why }]} block />;
  }
  const series = state.value;
  const timeZone = browserZone();
  const newest = series.samples.at(-1)!;
  const endWord = endWordOf({ nowMs, series, timeZone });
  const startWord = startWordOf({ series, timeZone });
  const cpuOthers = othersWords({ figure: (other) => coresWords({ pct: other.cpuPct }), others: newest.topOtherCpu });
  const memoryOthers = othersWords({
    figure: (other) => gbWords({ bytes: other.memoryBytes }),
    others: newest.topOtherMemory,
  });
  return (
    <section aria-label="The machine, last hour" className="grid gap-[0.5rem]" data-machine-charts="">
      <p className="m-0 text-[0.76rem] text-muted-foreground" data-machine-freshness="">
        newest sample {ageWordsOf({ iso: series.observedAtIso, nowMs, timeZone })}
        {state.stale !== undefined && (
          <>
            {" "}
            <StaleMark facts={[{ subject: "a newer machine sample", why: state.stale.why }]} />
          </>
        )}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <CpuChart series={series} timeZone={timeZone} startWord={startWord} endWord={endWord} />
        <LoadChart series={series} timeZone={timeZone} startWord={startWord} endWord={endWord} />
        <MemoryChart series={series} timeZone={timeZone} startWord={startWord} endWord={endWord} />
      </div>
      {(cpuOthers !== undefined || memoryOthers !== undefined) && (
        <ul className="m-0 grid list-none gap-0.5 p-0 text-[0.78rem]">
          {cpuOthers !== undefined && (
            <li>
              <span className="text-muted-foreground">heaviest outside the fleet by cpu, newest sample: </span>
              {cpuOthers}
            </li>
          )}
          {memoryOthers !== undefined && (
            <li>
              <span className="text-muted-foreground">heaviest outside the fleet by memory: </span>
              {memoryOthers}
            </li>
          )}
        </ul>
      )}
      <p className="m-0 text-[0.72rem] text-muted-foreground">
        Fleet is every process under a Claude Code session, cmux or a slopweaver worktree, children included, so a build
        cmux started counts as fleet. Samples are taken only while a page has this open, and a stretch of over{" "}
        {joinWordsOf({ series })} with none is a gap.
      </p>
      <SampleTable series={series} timeZone={timeZone} />
    </section>
  );
}
