/*
 * The shared harness for the `automation run-due` test files: throwaway homes seeded with definition files, and the
 * recording edges a tick runs over.
 *
 * The seams injected — `runVerb`, `runAlertSummaryRead`, `runAlertDigestRead`, `runSlackPost` and
 * `runGithubLandingRead` — are plain functions that record what they were handed. None is a mock: the
 * shell's whole contract is which argv reaches the dispatcher, what the read
 * leg was asked for, and what each does with the exit code — and a recording function is how that is observed
 * without running an arbitrary verb, or reaching Slack, inside a unit test.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FleetCeilingReport } from "../../../../../../capacity/seatCeiling.js";
import type { RecipeRunDueDeps } from "../../../../../../cli/commands/automation/rowRunners.js";
import { ok, type Result } from "../../../../../../lib/result.js";
import type { ProcessAlive } from "../../../../../../live/automation/holderLiveness.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { measuredFleetCeilingReport } from "../../../../../fleetCeilingReportFixture.js";
import { UNREACHED_FLEET_CEILING_SEAMS } from "../../../../../fleetCeilingSeamsFake.js";
import { writeRegisteredRow } from "../../../../../registeredRowFake.js";
import { DIGEST_FORM, POST_REPORT, PROMPT_CHANNEL, READ_FORM } from "./fixtures.js";

// Every home the run-due tests have minted, so each test file's `afterEach` can remove them.
const homes: string[] = [];

/**
 * Remove every home minted since the last call; each run-due test file registers it with `afterEach`.
 *
 * @returns nothing
 */
export function removeHomes(): void {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
}

/**
 * A home carrying one definition file, written as the store reads them.
 *
 * @returns the new home's path, removed by `removeHomes`
 */
export function homeWith({ rows }: { rows: readonly Record<string, unknown>[] }): string {
  const home = mkdtempSync(join(tmpdir(), "rd-"));
  homes.push(home);
  const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(dir, { recursive: true });
  // Each row at its CANONICAL `<recipeId>.json`, where a failure hold is written; a second row claiming the
  // same id (or one with no id) keeps a positional name so both still reach the roster.
  const named = new Set<string>();
  rows.forEach((entry, index) => {
    const recipeId = entry["recipeId"];
    let file = `row-${String(index)}.json`;
    if (typeof recipeId === "string" && !named.has(recipeId)) {
      named.add(recipeId);
      file = `${recipeId}.json`;
    }
    writeFileSync(join(dir, file), JSON.stringify(entry), "utf8");
  });
  return home;
}

/**
 * A home a card-runner case owns and removes.
 *
 * @returns the new, empty home's path, removed by `removeHomes`
 */
export function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "rd-card-"));
  homes.push(home);
  return home;
}

/** What a case may vary about the recording edges, every field resolved to its default in {@link DEFAULTS}. */
interface ResolvedOptions {
  /** What a dispatched verb exits with. */
  readonly exitCode: number;
  /** Whether `handover register` leaves its row on the board; it does unless a case says not. */
  readonly registerWritesRow: boolean;
  /** What a dispatched verb wrote to stderr while it ran; nothing unless a case says so. */
  readonly verbDiagnostics: string;
  /** Each kept-diagnostics leg's receipt, in dispatch order; a leg past the list answers the two above. */
  readonly verbRuns: readonly { readonly exitCode: number; readonly diagnostics: string }[];
  /** What a card row's read leg wrote to stderr. */
  readonly readDiagnostics: string;
  /** What `slack post` wrote to stderr on an `investigate` row's ask leg. */
  readonly postDiagnostics: string;
  readonly readExitCode: number;
  readonly readLines: readonly string[];
  readonly digestReadExitCode: number;
  readonly digestReadLines: readonly string[];
  readonly postExitCode: number;
  readonly postLines: readonly string[];
  /** What `slackBot.promptChannel` resolves to; `undefined` is an install that has configured none. */
  readonly promptChannel: string | undefined;
  /** Whether a stored attempt's holder pid still runs; every holder reads alive unless a case says not. */
  readonly processAlive: ProcessAlive;
  /** What a `fleet-ceiling-report` row's read answers; a measured week unless a case says not. */
  readonly ceilingReport: Result<FleetCeilingReport>;
}

/** Every edge answering as a healthy tick would: each leg exits 0, reads its fixture form and writes no stderr. */
const DEFAULTS: ResolvedOptions = {
  ceilingReport: ok(measuredFleetCeilingReport()),
  digestReadExitCode: 0,
  digestReadLines: [DIGEST_FORM],
  exitCode: 0,
  postDiagnostics: "",
  postExitCode: 0,
  postLines: [POST_REPORT],
  processAlive: () => true,
  promptChannel: PROMPT_CHANNEL,
  readDiagnostics: "",
  readExitCode: 0,
  readLines: [READ_FORM],
  registerWritesRow: true,
  verbDiagnostics: "",
  verbRuns: [],
};

/** Everything the recording edges were handed, in the order they were handed it. */
interface Recording {
  readonly ceilingReads: { readonly home: string; readonly days: number; readonly nowIso: string }[];
  readonly out: string[];
  readonly diag: string[];
  readonly dispatched: (readonly string[])[];
  readonly reads: (readonly string[])[];
  readonly digestReads: (readonly string[])[];
  readonly posts: (readonly string[])[];
  readonly registered: (readonly string[])[];
}

/** A fresh, empty set of the arrays the recording edges push into. */
function emptyRecording(): Recording {
  return {
    ceilingReads: [],
    diag: [],
    digestReads: [],
    dispatched: [],
    out: [],
    posts: [],
    reads: [],
    registered: [],
  };
}

/** The edges that answer the same way whatever a case varies, bar the prompt channel and the holder probe. */
function fixedSeams({
  options,
}: {
  options: ResolvedOptions;
}): Pick<RecipeRunDueDeps, "checkoutFor" | "doorEnv" | "promptChannel" | "mintId" | "now" | "processAlive"> {
  let minted = 0;
  return {
    checkoutFor: () => ok("/checkouts/slopweaver"),
    doorEnv: () => ({}),
    promptChannel: () => options.promptChannel,
    mintId: () => {
      minted += 1;
      return `tok-${String(minted)}`;
    },
    now: () => "2026-09-08T12:05:00.000Z",
    processAlive: options.processAlive,
  };
}

/** The fleet-ceiling read, recorded; spread AFTER `UNREACHED_FLEET_CEILING_SEAMS` so it overrides that one seam. */
function fleetReadSeam({
  options,
  recording,
}: {
  options: ResolvedOptions;
  recording: Recording;
}): Pick<RecipeRunDueDeps, "readFleetCeilingReport"> {
  return {
    readFleetCeilingReport: (read) => {
      recording.ceilingReads.push(read);
      return Promise.resolve(options.ceilingReport);
    },
  };
}

/** The read and post legs and the registrar, each recording what it was asked before it answers. */
function legSeams({
  options,
  recording,
}: {
  options: ResolvedOptions;
  recording: Recording;
}): Pick<
  RecipeRunDueDeps,
  "register" | "runGithubLandingRead" | "runSlackPost" | "runAlertDigestRead" | "runAlertSummaryRead"
> {
  return {
    register: ({ argv }) => {
      recording.registered.push(argv);
      if (options.registerWritesRow) {
        writeRegisteredRow({ argv });
      }
      return Promise.resolve(0);
    },
    // No `hygiene-sweep` row reaches this suite's ticks — that kind is seated, and `seat/hygieneSweep.test.ts`
    // and `hygieneRowRunner.test.ts` drive it — so a read here would be a dispatch bug, answered as a failure.
    runGithubLandingRead: () => Promise.resolve({ diagnostics: "", exitCode: 1, lines: [] }),
    runSlackPost: ({ rest }) => {
      recording.posts.push(rest);
      return Promise.resolve({
        diagnostics: options.postDiagnostics,
        exitCode: options.postExitCode,
        lines: options.postLines,
      });
    },
    runAlertDigestRead: ({ rest }) => {
      recording.digestReads.push(rest);
      return Promise.resolve({
        diagnostics: options.readDiagnostics,
        exitCode: options.digestReadExitCode,
        lines: options.digestReadLines,
      });
    },
    runAlertSummaryRead: ({ rest }) => {
      recording.reads.push(rest);
      return Promise.resolve({
        diagnostics: options.readDiagnostics,
        exitCode: options.readExitCode,
        lines: options.readLines,
      });
    },
  };
}

/** The dispatcher and the two output channels, each recording what it was handed. */
function verbSeams({
  options,
  recording,
}: {
  options: ResolvedOptions;
  recording: Recording;
}): Pick<RecipeRunDueDeps, "runVerbKeepingDiagnostics" | "writeDiagnostic" | "writeOut"> {
  const queued = [...options.verbRuns];
  return {
    runVerbKeepingDiagnostics: (argv) => {
      recording.dispatched.push(argv);
      // A case naming its legs one by one is answered in that order; past them, every leg answers the defaults.
      const next = queued.shift();
      if (next !== undefined) {
        return Promise.resolve(next);
      }
      return Promise.resolve({ diagnostics: options.verbDiagnostics, exitCode: options.exitCode });
    },
    writeDiagnostic: (line) => recording.diag.push(line),
    writeOut: (line) => recording.out.push(line),
  };
}

/**
 * Recording edges, plus the argv every dispatch was handed and every read tail that was asked for.
 *
 * @returns the edges a tick runs over, carrying the arrays each one records into
 */
export function deps(over: Partial<ResolvedOptions> = {}): RecipeRunDueDeps & Recording {
  const options: ResolvedOptions = { ...DEFAULTS, ...over };
  const recording = emptyRecording();
  return {
    ...recording,
    ...fixedSeams({ options }),
    ...UNREACHED_FLEET_CEILING_SEAMS,
    ...fleetReadSeam({ options, recording }),
    ...legSeams({ options, recording }),
    ...verbSeams({ options, recording }),
  };
}
