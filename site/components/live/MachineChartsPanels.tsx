/**
 * The three machine charts: CPU in cores with fleet stacked under everything else, the 1-minute load against the hold's
 * line, and memory in use against the machine's whole.
 */
import type { ReactElement } from "react";

import {
  bandPath,
  coresWords,
  cpuTopOf,
  frameOf,
  gbWords,
  holdMarkerOf,
  linePath,
  loadTopOf,
  type MachineSeries,
  memoryTopOf,
  runsOf,
  xOf,
  yOf,
} from "../../lib/machineSeries";
import {
  ChartBox,
  FLEET_FILL,
  FLEET_SWATCH,
  GAP,
  HEIGHT,
  LINE,
  OTHER_FILL,
  OTHER_SWATCH,
  SampleSlots,
  WIDTH,
} from "./MachineChartsFrame";

/** CPU in cores: fleet at the foot, everything else stacked on it. */
export function CpuChart({
  series,
  timeZone,
  startWord,
  endWord,
}: {
  series: MachineSeries;
  timeZone: string;
  startWord: string;
  endWord: string;
}): ReactElement {
  const frame = frameOf({ height: HEIGHT, series, width: WIDTH });
  const top = cpuTopOf({ series });
  const newest = series.samples.at(-1)!;
  const bands = runsOf({ series }).map((run) => {
    const xs = run.map((sample) => xOf({ frame, iso: sample.observedAtIso }));
    const floor = xs.map((x) => ({ x, y: HEIGHT }));
    const fleet = run.map((sample, at) => ({ x: xs[at], y: yOf({ frame, top, value: sample.cpu.fleetPct / 100 }) }));
    const both = run.map((sample, at) => ({
      x: xs[at],
      y: yOf({ frame, top, value: (sample.cpu.fleetPct + sample.cpu.otherPct) / 100 }),
    }));
    // The other band starts a surface gap above fleet, so the two never touch; a band thinner than the gap draws none.
    const otherFloor = fleet.map((point, at) => ({ x: point.x, y: Math.max(both[at].y, point.y - GAP) }));
    return {
      fleet: bandPath({ lower: floor, upper: fleet }),
      key: run[0].observedAtIso,
      other: bandPath({ lower: otherFloor, upper: both }),
    };
  });
  const words = `CPU ${endWord}: fleet ${coresWords({ pct: newest.cpu.fleetPct })}, everything else ${coresWords({ pct: newest.cpu.otherPct })}, of ${String(newest.cores)} cores`;
  return (
    <ChartBox
      title="CPU, in cores"
      startWord={startWord}
      endWord={endWord}
      ceiling={`${top.toFixed(0)} cores`}
      label={words}
      under={
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 pl-0 text-[0.76rem]">
          <li className="flex items-center gap-1">
            <span aria-hidden className={`inline-block h-[0.6rem] w-[0.6rem] rounded-[2px] ${FLEET_SWATCH}`} />
            fleet <span className="text-muted-foreground tabular-nums">{coresWords({ pct: newest.cpu.fleetPct })}</span>
          </li>
          <li className="flex items-center gap-1">
            <span aria-hidden className={`inline-block h-[0.6rem] w-[0.6rem] rounded-[2px] ${OTHER_SWATCH}`} />
            everything else{" "}
            <span className="text-muted-foreground tabular-nums">{coresWords({ pct: newest.cpu.otherPct })}</span>
          </li>
        </ul>
      }
    >
      {bands.map((band) => (
        <g key={band.key}>
          <path d={band.fleet} className={FLEET_FILL} />
          <path d={band.other} className={OTHER_FILL} />
        </g>
      ))}
      <SampleSlots frame={frame} samples={series.samples} timeZone={timeZone} />
    </ChartBox>
  );
}

/** The 1-minute load, the hold's line across it, and where the current hold began. */
export function LoadChart({
  series,
  timeZone,
  startWord,
  endWord,
}: {
  series: MachineSeries;
  timeZone: string;
  startWord: string;
  endWord: string;
}): ReactElement {
  const frame = frameOf({ height: HEIGHT, series, width: WIDTH });
  const top = loadTopOf({ series });
  const newest = series.samples.at(-1)!;
  const holdY = yOf({ frame, top, value: newest.load.holdAt });
  const marker = holdMarkerOf({ frame, series, timeZone });
  const lines = runsOf({ series }).map((run) => ({
    d: linePath({
      points: run.map((sample) => ({
        x: xOf({ frame, iso: sample.observedAtIso }),
        y: yOf({ frame, top, value: sample.load.load1 }),
      })),
    }),
    key: run[0].observedAtIso,
  }));
  let held = `under the hold at ${String(newest.load.holdAt)}`;
  if (marker !== undefined) {
    held = `${marker.words}, at or over ${String(newest.load.holdAt)}`;
  }
  return (
    <ChartBox
      title="Load, 1-minute average"
      startWord={startWord}
      endWord={endWord}
      ceiling={String(top)}
      label={`Load ${endWord} ${String(newest.load.load1)}, ${held}`}
      under={
        <p className="m-0 text-[0.76rem]">
          {endWord} <span className="tabular-nums">{newest.load.load1}</span>
          <span className="text-muted-foreground">
            {" "}
            · the dashed line is the hold, {newest.load.holdAt} on {newest.cores} cores · {held}
          </span>
        </p>
      }
    >
      {lines.map((line) => (
        <path key={line.key} d={line.d} className={LINE} strokeWidth={2} strokeLinejoin="round" />
      ))}
      <line
        x1={0}
        x2={WIDTH}
        y1={holdY}
        y2={holdY}
        className="stroke-muted-foreground"
        strokeDasharray="4 3"
        strokeWidth={1}
      />
      {marker?.x !== undefined && (
        <line
          x1={marker.x}
          x2={marker.x}
          y1={0}
          y2={HEIGHT}
          className="stroke-foreground"
          strokeDasharray="2 2"
          strokeWidth={1}
        />
      )}
      <SampleSlots frame={frame} samples={series.samples} timeZone={timeZone} />
    </ChartBox>
  );
}

/** Memory in use as Activity Monitor sums it, against the machine's whole, with the compressor and swap beside it. */
export function MemoryChart({
  series,
  timeZone,
  startWord,
  endWord,
}: {
  series: MachineSeries;
  timeZone: string;
  startWord: string;
  endWord: string;
}): ReactElement {
  const frame = frameOf({ height: HEIGHT, series, width: WIDTH });
  const top = memoryTopOf({ series });
  const newest = series.samples.at(-1)!;
  const bands = runsOf({ series }).map((run) => {
    const xs = run.map((sample) => xOf({ frame, iso: sample.observedAtIso }));
    return {
      d: bandPath({
        lower: xs.map((x) => ({ x, y: HEIGHT })),
        upper: run.map((sample, at) => ({ x: xs[at], y: yOf({ frame, top, value: sample.memory.usedBytes }) })),
      }),
      key: run[0].observedAtIso,
    };
  });
  const used = `${gbWords({ bytes: newest.memory.usedBytes })} of ${gbWords({ bytes: newest.memory.totalBytes })}`;
  return (
    <ChartBox
      title="Memory in use"
      startWord={startWord}
      endWord={endWord}
      ceiling={gbWords({ bytes: top })}
      label={`Memory ${endWord} ${used}`}
      under={
        <p className="m-0 text-[0.76rem]">
          {endWord} <span className="tabular-nums">{used}</span>
          <span className="text-muted-foreground">
            {" "}
            · compressor segments {newest.memory.compressorSegmentsPct}% of their limit · swap{" "}
            {newest.memory.swapUsedGb} of {newest.memory.swapTotalGb} GB
          </span>
        </p>
      }
    >
      {bands.map((band) => (
        <path key={band.key} d={band.d} className={FLEET_FILL} />
      ))}
      <SampleSlots frame={frame} samples={series.samples} timeZone={timeZone} />
    </ChartBox>
  );
}
