/**
 * The one injected seam the supervisor-scratch verb tests share: a child launcher that writes what a `slopweaver`
 * child would have written, beside a fixed clock and a readings ledger that keeps what it is handed. A plain fake,
 * never a mock, so what is under test is every file the verb creates, refuses to overwrite, or leaves alone.
 */
import { writeFileSync } from "node:fs";

import type { AutonomyLedgerPort } from "../../../../../autonomy/port.js";
import type { BuiltState } from "../../../../../builtCli/builtState.js";
import type { ScratchDeps } from "../../../../../cli/commands/supervisor/scratchDeps.js";
import { err, ok } from "../../../../../lib/result.js";
import { memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";

/** One readings-ledger append the fake kept. */
interface AppendedReading {
  readonly by: string;
  readonly producer: string;
  readonly document: string;
  readonly home: string | undefined;
}

/** What each child writes to stdout, and its exit code, keyed by the argv's first two words. */
type ChildAnswers = Readonly<Record<string, { stdout: string | readonly string[]; exit: number | "timed-out" }>>;

/**
 * A rebuild of the built tree crossing the capture: the child launched `staleAtLaunch`-th (1-based) moves the source
 * under itself and refuses, as does every child launched while the tree reads stale; a wait either lands a fresh
 * build after `waitedMs` or runs out.
 */
interface RebuildScript {
  readonly staleAtLaunch: number;
  readonly lands: boolean;
  readonly waitedMs: number;
}

/** The built tree every child shares, as the fake sees it. */
interface BuildWorld {
  state: BuiltState;
  readonly waits: number[];
}

/** The `[stale-build]` refusal's first words, written to a refused child's stderr. */
const STALE_REFUSAL = "slopweaver <any verb> blocked because the built CLI in this checkout no longer describes";

/**
 * A child launcher that answers from the table, keeping every argv it launched and the budget each was given.
 *
 * @returns the launcher
 */
function answeringLauncher({
  answers,
  launched,
  budgets,
  rebuild,
  world,
}: {
  answers: ChildAnswers;
  launched: string[];
  budgets: number[];
  rebuild: RebuildScript | undefined;
  world: BuildWorld;
}): ScratchDeps["runChild"] {
  return ({ argv, stdoutPath, stderrPath, bin, timeoutMs }) => {
    launched.push(`${bin} ${argv.join(" ")}`);
    budgets.push(timeoutMs);
    if (rebuild !== undefined && launched.length === rebuild.staleAtLaunch) {
      world.state = { evidence: "src/a.ts moved", kind: "stale", manifestText: "manifest-1" };
    }
    if (world.state.kind === "stale") {
      writeFileSync(stdoutPath, "");
      writeFileSync(stderrPath, STALE_REFUSAL);
      return Promise.resolve({ durationMs: 5, exitCode: 1, kind: "exited" });
    }
    const answer = answers[argv.slice(0, 2).join(" ")];
    const launches = launched.filter((line) => line === `${bin} ${argv.join(" ")}`).length;
    const stdouts = typeof answer?.stdout === "string" ? [answer.stdout] : answer?.stdout;
    writeFileSync(stdoutPath, stdouts === undefined ? "{}" : stdouts[Math.min(launches, stdouts.length) - 1]!);
    writeFileSync(stderrPath, "");
    if (answer?.exit === "timed-out") {
      return Promise.resolve({ durationMs: timeoutMs + 3, kind: "timed-out", signal: "SIGKILL", timeoutMs });
    }
    return Promise.resolve({ durationMs: 5, exitCode: answer === undefined ? 0 : answer.exit, kind: "exited" });
  };
}

/**
 * A rebuild wait that records which launch it followed, then lands the scripted fresh build or runs out.
 *
 * @param launched the argvs launched so far, whose count dates each wait
 * @returns the wait
 */
function scriptedWait({
  rebuild,
  world,
  launched,
}: {
  rebuild: RebuildScript | undefined;
  world: BuildWorld;
  launched: readonly string[];
}): ScratchDeps["waitForBuild"] {
  return () => {
    world.waits.push(launched.length);
    if (rebuild?.lands === true) {
      world.state = { kind: "fresh", manifestText: "manifest-2" };
      return Promise.resolve({ kind: "fresh", waitedMs: rebuild.waitedMs });
    }
    return Promise.resolve({ kind: "timed-out", waitedMs: 30_000 });
  };
}

/**
 * Seams whose children answer from a table keyed by the argv's first two words, and whose output is kept.
 *
 * @param answers what each child writes to stdout, and its exit code — or `"timed-out"` for a child its budget
 *   killed; an argv not in the table exits 0 with `{}`. A list of stdouts answers one per launch of the SAME
 *   argv, the last repeating, so a reading taken twice can come back different the second time
 * @param autonomy the autonomy ledger the verbs read; an empty in-memory one unless a test seeds its own
 * @param rebuild a rebuild that crosses the capture, when the test stages one; the built tree is fresh otherwise
 * @returns the seams, the lines printed, the argvs launched, the budget each was given and every wait taken
 */
export function fakeDeps({
  answers = {},
  autonomy = memoryAutonomyLedgerPort(),
  rebuild,
}: {
  answers?: ChildAnswers;
  autonomy?: AutonomyLedgerPort;
  rebuild?: RebuildScript;
} = {}): {
  deps: ScratchDeps;
  out: string[];
  diagnostics: string[];
  launched: string[];
  budgets: number[];
  appended: AppendedReading[];
  waits: number[];
} {
  const world: BuildWorld = { state: { kind: "fresh", manifestText: "manifest-1" }, waits: [] };
  const out: string[] = [];
  const diagnostics: string[] = [];
  const launched: string[] = [];
  const budgets: number[] = [];
  const appended: AppendedReading[] = [];
  // The first call is the tick start, the last is the capture instant; every reading between reads the latter.
  const instants = ["2026-09-16T01:00:00.000Z", "2026-09-16T01:02:00.000Z"];
  let clockReads = 0;
  return {
    deps: {
      autonomy,
      defaultBin: () => "/checkout/bin/slopweaver",
      defaultRepo: () => ok("o/r"),
      now: () => {
        clockReads += 1;
        return instants[Math.min(clockReads, instants.length) - 1]!;
      },
      recordReading: ({ by, producer, document, home }) => {
        appended.push({ by, document, home, producer });
        return producer === "velocity"
          ? err("the readings ledger is busy")
          : ok(`${producer}-row-${String(appended.length)}`);
      },
      readBuild: () => world.state,
      runChild: answeringLauncher({ answers, budgets, launched, rebuild, world }),
      waitForBuild: scriptedWait({ launched, rebuild, world }),
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    appended,
    budgets,
    diagnostics,
    launched,
    out,
    waits: world.waits,
  };
}
