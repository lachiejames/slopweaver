/**
 * The effectful half of `./fleetWhy.ts`: read the window's `machine capacity` readings and the newest `machine
 * capacity`, `fleet ceiling` and `session watch` readings off the readings ledger, decode each narrowly, and measure.
 *
 * Every source is a document a supervisor tick already recorded, so the report takes no live read — no `top`, no
 * `ps`, no plan probe — and replays exactly at `--now`. A selected capacity document that will not decode is named
 * in `problems` and left out of the window rather than failing the summary, because an older document can predate
 * a field; an index or document the ledger cannot read refuses outright.
 */
import { z } from "zod";

import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";
import { lastReading, readingsInWindow } from "../readings/store.js";
import type { Reading } from "../readings/types.js";
import {
  type FleetWhyCeiling,
  type FleetWhyError,
  FleetWhyErrors,
  type FleetWhyReport,
  measureFleetWhy,
} from "./fleetWhy.js";
import type { FleetWhyMachineSample, FleetWhySource } from "./fleetWhyWindow.js";

/** The producers this report reads, as the supervisor tick records them. */
const MACHINE_PRODUCER = "machine capacity";
const CEILING_PRODUCER = "fleet ceiling";
const WATCH_PRODUCER = "session watch";

/** The watch signal of a seat that is drawing a plan down. */
const WORKING_SIGNAL = "working";

/** The fields of one `machine capacity --json` document this report reads; every other field is ignored. */
const machineSchema = z.object({
  cpuHogs: z
    .object({
      cpuAttributed: z.boolean(),
      hogs: z.array(
        z.object({
          classification: z.string(),
          cpuPct: z.number(),
          label: z.string(),
          sessionId: z.string().optional(),
        }),
      ),
    })
    .optional(),
  fleet: z.object({ sessions: z.array(z.object({ cpuPct: z.number() })) }),
  hiddenCpu: z
    .object({
      busyCores: z.number().optional(),
      hiddenFromTop: z.array(z.string()),
      // Not read here, but declared so a capture whose idle is not a percentage is refused rather than stripped.
      idlePct: z.number().min(0).max(100).optional(),
      unattributedCores: z.number().optional(),
    })
    .optional(),
  hold: z.boolean(),
  holdSubjects: z.array(z.string()),
  load: z.object({ load1: z.number() }),
  loadHold: z.number(),
});

/** The working-seat ceiling inside one `fleet ceiling --json` document. */
const ceilingSchema = z.object({
  ceiling: z.discriminatedUnion("kind", [
    z.object({
      burnPerWorkingSeatHour: z.number(),
      kind: z.literal("measured"),
      seats: z.number().int(),
      sustainablePlanWeeksPerHour: z.number(),
    }),
    z.object({ kind: z.literal("unmeasurable"), reason: z.string() }),
  ]),
});

/** The rows of one `session watch --json-report` document, each with its signal. */
const watchSchema = z.object({ rows: z.array(z.object({ signal: z.string() })) });

/**
 * A metric a document may lack, as `null` rather than zero.
 *
 * @returns the value, or `null`
 */
function measuredOrNull({ value }: { value: number | undefined }): number | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * One capacity document, normalised.
 *
 * @returns the sample, or why it would not decode
 */
function machineSampleOf({ document }: { document: unknown }): Result<FleetWhyMachineSample> {
  const parsed = machineSchema.safeParse(document);
  if (!parsed.success) {
    return err([parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")]);
  }
  const doc = parsed.data;
  let foreignHogs: FleetWhyMachineSample["foreignHogs"] = null;
  let fleetCpuPct: number | null = null;
  if (doc.cpuHogs?.cpuAttributed === true) {
    foreignHogs = doc.cpuHogs.hogs
      .filter((hog) => hog.classification === "foreign")
      .map((hog) => ({ cpuPct: hog.cpuPct, label: hog.label }));
    // A session's cpu already sums its whole tree, so only a fleet hog no session owns is added beside it.
    const unowned = doc.cpuHogs.hogs.filter((hog) => hog.classification === "fleet" && hog.sessionId === undefined);
    fleetCpuPct =
      doc.fleet.sessions.reduce((sum, session) => sum + session.cpuPct, 0) +
      unowned.reduce((sum, hog) => sum + hog.cpuPct, 0);
  }
  return ok({
    busyCores: measuredOrNull({ value: doc.hiddenCpu?.busyCores }),
    fleetCpuPct,
    foreignHogs,
    hiddenFromTop: doc.hiddenCpu === undefined ? [] : doc.hiddenCpu.hiddenFromTop,
    hold: doc.hold,
    holdSubjects: doc.holdSubjects,
    load1: doc.load.load1,
    loadHold: doc.loadHold,
    unattributedCores: measuredOrNull({ value: doc.hiddenCpu?.unattributedCores }),
  });
}

/**
 * Wrap a decoded value as a source stamped with its ledger row.
 *
 * @returns the source
 */
function sourceOf<T>({ reading, value }: { reading: Reading; value: T }): FleetWhySource<T> {
  return { by: reading.record.by, observedAtIso: reading.record.observedAtIso, value };
}

/**
 * The newest reading one producer recorded by `nowIso`, decoded — absent, with a named problem, when there is none
 * or it will not decode; a ledger it cannot read refuses.
 *
 * @returns the source or `undefined`, or the refusal
 */
function latestOf<T>({
  producer,
  home,
  nowIso,
  decode,
  problems,
}: {
  producer: string;
  home: string;
  nowIso: string;
  decode: (args: { document: unknown }) => Result<T>;
  problems: string[];
}): Result<FleetWhySource<T> | undefined> {
  // Recorded AND observed by `nowIso`: a replay sees exactly the readings that were there then.
  const read = lastReading({ asOfIso: nowIso, home, observedByIso: nowIso, producer });
  if (read.isErr()) {
    if (read.error.code === "NO_READING") {
      problems.push(`no ${producer} reading is recorded`);
      return ok(undefined);
    }
    return err([read.error.message]);
  }
  const decoded = decode({ document: read.value.document });
  if (decoded.isErr()) {
    problems.push(
      `the latest ${producer} reading (${read.value.record.readingId}) will not decode: ${decoded.error.join("; ")}`,
    );
    return ok(undefined);
  }
  return ok(sourceOf({ reading: read.value, value: decoded.value }));
}

/**
 * The window's capacity readings, decoded, each one that will not decode named in `problems` and left out.
 *
 * @returns the sources, oldest first, or the refusal
 */
function windowSamplesOf({
  home,
  fromIso,
  nowIso,
  problems,
}: {
  home: string;
  fromIso: string;
  nowIso: string;
  problems: string[];
}): Result<readonly FleetWhySource<FleetWhyMachineSample>[]> {
  const series = readingsInWindow({ fromIso, home, producer: MACHINE_PRODUCER, toIso: nowIso });
  if (series.isErr()) {
    return err([series.error.message]);
  }
  const sources: FleetWhySource<FleetWhyMachineSample>[] = [];
  for (const reading of series.value) {
    const sample = machineSampleOf({ document: reading.document });
    if (sample.isErr()) {
      problems.push(
        `${reading.record.readingId} will not decode, so the window leaves it out: ${sample.error.join("; ")}`,
      );
      continue;
    }
    sources.push(sourceOf({ reading, value: sample.value }));
  }
  return ok(sources);
}

/**
 * Decode a `fleet ceiling` document's ceiling.
 *
 * @returns the ceiling, or why it would not decode
 */
function ceilingOf({ document }: { document: unknown }): Result<FleetWhyCeiling> {
  const parsed = ceilingSchema.safeParse(document);
  if (!parsed.success) {
    return err([parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")]);
  }
  return ok(parsed.data.ceiling);
}

/**
 * Count a `session watch` document's working seats.
 *
 * @returns the count, or why it would not decode
 */
function workingOf({ document }: { document: unknown }): Result<{ readonly working: number }> {
  const parsed = watchSchema.safeParse(document);
  if (!parsed.success) {
    return err([parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")]);
  }
  return ok({ working: parsed.data.rows.filter((row) => row.signal === WORKING_SIGNAL).length });
}

/**
 * Read the ledger and explain the fleet's working seats over the `minutes` before `nowIso`.
 *
 * @param home the state home whose readings ledger is read
 * @param minutes the window's length
 * @param nowIso the window's end; nothing recorded after it is read
 * @returns the report, or why the ledger could not be read
 */
export function readFleetWhyReport({
  home,
  minutes,
  nowIso,
}: {
  home: string;
  minutes: number;
  nowIso: string;
}): Result<FleetWhyReport, FleetWhyError> {
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (nowMs === undefined || !Number.isInteger(minutes) || minutes < 1) {
    return err(FleetWhyErrors.invalidWindow({ minutes, nowIso }));
  }
  const problems: string[] = [];
  const fromIso = new Date(nowMs - minutes * 60_000).toISOString();
  const window = windowSamplesOf({ fromIso, home, nowIso, problems });
  if (window.isErr()) {
    return err(FleetWhyErrors.ledgerUnreadable({ why: window.error }));
  }
  const latestMachine = latestOf({ decode: machineSampleOf, home, nowIso, problems, producer: MACHINE_PRODUCER });
  const ceiling = latestOf({ decode: ceilingOf, home, nowIso, problems, producer: CEILING_PRODUCER });
  const workingSeats = latestOf({ decode: workingOf, home, nowIso, problems, producer: WATCH_PRODUCER });
  if (latestMachine.isErr() || ceiling.isErr() || workingSeats.isErr()) {
    const why = [latestMachine, ceiling, workingSeats].flatMap((read) => (read.isErr() ? read.error : []));
    return err(FleetWhyErrors.ledgerUnreadable({ why }));
  }
  return measureFleetWhy({
    ceiling: ceiling.value,
    latestMachine: latestMachine.value,
    machineReadings: window.value,
    minutes,
    nowIso,
    problems,
    workingSeats: workingSeats.value,
  });
}
