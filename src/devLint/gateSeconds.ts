/**
 * The per-gate seconds `dev lint` recorded on its last run, which orders the next run's pool longest-first
 * (`lintSchedule` in `./gateRunner.ts`).
 *
 * It lives under `$SLOPWEAVER_HOME` rather than in the checkout, because a lap runs in a fresh checkout and a
 * record inside one would be cold every time, while every checkout on a machine shares one home. It is a
 * SCHEDULING HINT and nothing reads it as a verdict: an absent record is plan order, and a record that will
 * not parse is reported in one line and also gives plan order — never a failed lap, because a wrong order
 * costs seconds and a refused lap costs the lap.
 *
 * Only a run of the whole lane writes it. An `--only` run is a narrow re-check, often from a test with its
 * own sandbox home, and the seconds a gate takes alone are not the seconds it takes beside seven others.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

import { z } from "zod";

import { slopweaverHome } from "../homeDir.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

/** The record's shape on disk: each gate's last elapsed seconds, by gate name. */
const GateSecondsFile = z.object({ seconds: z.record(z.string(), z.number().nonnegative()), version: z.literal(1) });

/** The record exists and is not JSON at all. */
interface GateSecondsNotJsonError {
  readonly code: "GATE_SECONDS_NOT_JSON";
  readonly message: string;
  readonly path: string;
}

/** The record is not a regular file, or is JSON but not the gate-seconds shape. */
interface GateSecondsMalformedError {
  readonly code: "GATE_SECONDS_MALFORMED";
  readonly message: string;
  readonly path: string;
}

/** The filesystem refused to stat or read the record, a permission denied on its directory for one. */
interface GateSecondsUnreadableError {
  readonly code: "GATE_SECONDS_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Why a recorded gate-seconds file could not be read. */
export type GateSecondsError = GateSecondsNotJsonError | GateSecondsMalformedError | GateSecondsUnreadableError;

/** The one constructor per {@link GateSecondsError} variant. */
const GateSecondsErrors = {
  unreadable: ({ path, cause }: { path: string; cause: unknown }): GateSecondsUnreadableError => ({
    code: "GATE_SECONDS_UNREADABLE",
    message: `${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  malformed: ({ path, detail }: { path: string; detail: string }): GateSecondsMalformedError => ({
    code: "GATE_SECONDS_MALFORMED",
    message: `${path} is not a gate-seconds record: ${detail}`,
    path,
  }),
  notJson: ({ path, cause }: { path: string; cause: unknown }): GateSecondsNotJsonError => ({
    code: "GATE_SECONDS_NOT_JSON",
    message: `${path} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;

/**
 * Where the record lives under a home.
 *
 * @param home the Slopweaver home the record belongs to
 * @returns the record's absolute path
 */
export function gateSecondsPath({ home }: { home: string }): string {
  return stateHomePaths({ home }).live.devLintGateSecondsJson;
}

/**
 * Read the previous run's per-gate seconds.
 *
 * @param home the Slopweaver home to read from; the ambient one when omitted
 * @returns the seconds by gate name — empty when nothing is recorded — or why the record would not parse
 */
export function readGateSeconds({ home = slopweaverHome() }: { home?: string } = {}): Result<
  ReadonlyMap<string, number>,
  GateSecondsError
> {
  const path = gateSecondsPath({ home });
  let text: string;
  let fd: number | undefined;
  try {
    // Opened non-blocking and judged by the OPEN descriptor, so a FIFO renamed in after a check can never block
    // the read: only a regular file is ever a record.
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) {
      return err(GateSecondsErrors.malformed({ detail: "not a regular file", path }));
    }
    text = readFileSync(fd, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok(new Map());
    }
    return err(GateSecondsErrors.unreadable({ cause: error, path }));
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return err(GateSecondsErrors.notJson({ cause: error, path }));
  }
  const parsed = GateSecondsFile.safeParse(raw);
  if (!parsed.success) {
    return err(GateSecondsErrors.malformed({ detail: parsed.error.message, path }));
  }
  return ok(new Map(Object.entries(parsed.data.seconds)));
}

/**
 * The previous run's seconds for the runner to order by: {@link readGateSeconds}, with an unreadable record
 * said in one line on stderr and answered as no record, so the lap runs in plan order rather than not at all.
 *
 * @returns the seconds by gate name; empty when nothing usable is recorded
 */
export function previousGateSeconds(): ReadonlyMap<string, number> {
  const read = readGateSeconds();
  if (read.isOk()) {
    return read.value;
  }
  // devlint: not-a-refusal -- a scheduling hint that could not be read; the lap still runs, in plan order
  process.stderr.write(`dev lint: ordering gates in plan order — ${read.error.message}\n`);
  return new Map();
}

/**
 * Merge this run's per-gate seconds over the previous record and write it atomically. A gate this run did not
 * time keeps its previous entry, so a lane that runs a subset does not erase the rest. A write that fails is
 * said in one line on stderr and never thrown: the lap's verdict is already decided, and a hint must not undo it.
 *
 * @param home the Slopweaver home to write under; the ambient one when omitted
 * @param previous the record this run read, which the new seconds are merged over
 * @param results this run's outcomes; one without an elapsed time leaves its gate's entry as it was
 */
export function recordGateSeconds({
  home = slopweaverHome(),
  previous,
  results,
}: {
  home?: string;
  previous: ReadonlyMap<string, number>;
  results: readonly { readonly name: string; readonly elapsedMs?: number }[];
}): void {
  const seconds: Record<string, number> = Object.fromEntries(previous);
  for (const result of results) {
    if (result.elapsedMs !== undefined) {
      seconds[result.name] = Math.round(result.elapsedMs / 100) / 10;
    }
  }
  const path = gateSecondsPath({ home });
  const written = safeFs({
    execute: () => {
      writeFileAtomic({
        contents: `${JSON.stringify({ seconds, version: 1 } satisfies z.infer<typeof GateSecondsFile>, null, 2)}\n`,
        path,
      });
    },
    operation: "record gate seconds",
    path,
  });
  if (written.isErr()) {
    // devlint: not-a-refusal -- a scheduling hint that could not be saved; the lap's verdict is already decided
    process.stderr.write(
      `dev lint: gate seconds not recorded, the next run orders by plan — ${written.error.message}\n`,
    );
  }
}
