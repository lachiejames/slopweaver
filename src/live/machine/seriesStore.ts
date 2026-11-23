/**
 * The ring `slopweaver machine series` keeps at `$SLOPWEAVER_HOME/live/machine/series.jsonl`: one sample per line,
 * oldest first, at most an hour of them. Read whole and rewritten whole on every new sample, which the bound keeps
 * small (121 rows); a row is parsed and written one at a time all the same, per the `whole-file-json` rule.
 *
 * Its absence is the one empty ring there is, a first run on this home. Every other failure to read it, and every
 * line that is not a sample, is a typed error: a ring with a bad line skipped would chart a gap as if nothing
 * happened in it. Owner-only, because its rows name session ids and process names.
 */
import { existsSync } from "node:fs";

import { z } from "zod";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomicStream } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import type { MachineSeriesSample } from "./series.js";
import { type MachineSeriesStoreError, MachineSeriesStoreErrors } from "./seriesErrors.js";

/** A figure that cannot be negative. */
const amount = z.number().nonnegative();

/** One consumer group or session tree. */
const consumerSchema = z
  .object({ cpuPct: amount, label: z.string().min(1), memoryBytes: amount, processCount: z.number().int().positive() })
  .strict();

/** One stored sample: exactly {@link MachineSeriesSample}, and nothing else. */
const sampleSchema = z
  .object({
    cores: z.number().int().positive(),
    // Optional, never defaulted: a row written before the field existed carries no idle and re-reads as written.
    cpu: z.object({ fleetPct: amount, idlePct: z.number().min(0).max(100).optional(), otherPct: amount }).strict(),
    load: z.object({ holdAt: amount, load1: amount }).strict(),
    memory: z
      .object({
        compressorSegmentsPct: amount,
        swapTotalGb: amount,
        swapUsedGb: amount,
        totalBytes: amount,
        usedBytes: amount,
      })
      .strict(),
    observedAtIso: z.iso.datetime(),
    sessions: z.array(
      z
        .object({
          cpuPct: amount,
          memoryBytes: amount,
          processCount: z.number().int().positive(),
          sessionId: z.string().min(1),
        })
        .strict(),
    ),
    topOtherCpu: z.array(consumerSchema).max(3),
    topOtherMemory: z.array(consumerSchema).max(3),
  })
  .strict() satisfies z.ZodType<MachineSeriesSample>;

/** The mode the ring and its directory are written with: the owner's alone. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/**
 * The ring's path under a home.
 *
 * @returns the path
 */
export function machineSeriesPath({ home }: { home: string }): string {
  return stateHomePaths({ home }).live.machine.seriesJsonl;
}

/**
 * Every sample the ring holds, in file order. A missing file is an empty ring; anything else that stops a read, a
 * line that is not JSON, or a line that is not a sample, is the error naming it. A blank line, the one after the
 * final newline included, is no row.
 *
 * @returns the samples, or why they could not be read
 */
export function readMachineSeries({
  home,
}: {
  home: string;
}): Result<readonly MachineSeriesSample[], MachineSeriesStoreError> {
  const path = machineSeriesPath({ home });
  if (!existsSync(path)) {
    return ok([]);
  }
  const samples: MachineSeriesSample[] = [];
  let failure: MachineSeriesStoreError | undefined;
  try {
    readJsonlLines({
      noFollow: true,
      onChunk: () => failure === undefined,
      onLine: ({ line, index }) => {
        if (failure !== undefined || line.trim().length === 0) {
          return;
        }
        let parsed: unknown;
        try {
          parsed = safeJsonParse({ label: "a machine series row", text: line });
        } catch (cause: unknown) {
          failure = MachineSeriesStoreErrors.rowMalformed({ cause, line: index + 1 });
          return;
        }
        const sample = sampleSchema.safeParse(parsed);
        if (!sample.success) {
          failure = MachineSeriesStoreErrors.rowInvalid({ line: index + 1, why: sample.error.message });
          return;
        }
        samples.push(sample.data);
      },
      path,
    });
  } catch (cause: unknown) {
    return err(MachineSeriesStoreErrors.unreadable({ cause, path }));
  }
  if (failure !== undefined) {
    return err(failure);
  }
  return ok(samples);
}

/**
 * Replace the ring with these samples, one line each, atomically: a failure part-way leaves the earlier ring whole.
 *
 * @returns nothing on success, or the write failure
 */
export function writeMachineSeries({
  home,
  samples,
}: {
  home: string;
  samples: readonly MachineSeriesSample[];
}): Result<void, MachineSeriesStoreError> {
  const path = machineSeriesPath({ home });
  try {
    writeFileAtomicStream({
      dirMode: DIR_MODE,
      exactMode: true,
      fileMode: FILE_MODE,
      path,
      produce: ({ write }) => {
        for (const sample of samples) {
          write({ text: `${safeJsonStringify({ label: "a machine series row", value: sample })}\n` });
        }
      },
    });
  } catch (cause: unknown) {
    return err(MachineSeriesStoreErrors.writeFailed({ cause, path }));
  }
  return ok(undefined);
}
