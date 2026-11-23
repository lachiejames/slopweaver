/**
 * Monitor seams over a temp home that RECORD both output channels apart — so a test can say which channel a pass
 * printed on, the property `hostedPassDeps` (`../cli/commands/monitor/deps.ts`) exists to hold. Every clock reads
 * one instant, every port is in memory, the macOS launcher is a plain function and Chrome is never opened.
 */

import type { MonitorDeps } from "../cli/commands/monitor/deps.js";
import { err } from "../lib/result.js";
import { memoryPlanHealthPorts } from "./claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "./codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "./orgHealthStoreFixture.js";
import { memoryPagesPublished } from "./pagesPublishedFixture.js";
import { memoryPlanRegisterPort } from "./planRegisterFixture.js";
import { NO_FSEVENTSD } from "./processesFake.js";

/** The seams, and what each output channel and the launcher received. */
export interface RecordingMonitorDeps {
  readonly deps: MonitorDeps;
  /** Every line the pass wrote on stdout. */
  readonly out: string[];
  /** Every line the pass wrote on stderr. */
  readonly diagnostics: string[];
  /** How many times the macOS note launcher ran. */
  readonly launches: () => number;
}

/**
 * Build recording monitor seams.
 *
 * @param nowIso the one instant every clock reads
 * @param onLaunch run after each counted launch — a test stamping the note's liveness files, say
 * @returns the seams and their recordings
 */
export function recordingMonitorDeps({
  nowIso,
  onLaunch = (): void => undefined,
}: {
  nowIso: string;
  onLaunch?: () => void;
}): RecordingMonitorDeps {
  const out: string[] = [];
  const diagnostics: string[] = [];
  let launches = 0;
  const quiet = (): void => undefined;
  const deps: MonitorDeps = {
    // Codex's, Claude's and cmux's own directories, none of them under the state home, so never joined onto it:
    // stand-ins that hold nothing, which every pass reads as absent.
    claudeProjectsDir: "/nonexistent/.claude/projects",
    fleetCapPort: memoryCodexFleetCapPort(),
    orgHealthPort: memoryOrgHealthPort(),
    pagePublished: memoryPagesPublished(),
    registerPort: memoryPlanRegisterPort(),
    ...memoryPlanHealthPorts(),
    cmuxConfigPath: "/nonexistent/.config/cmux/cmux.json",
    hand: {
      branchesDeclaring: () => [],
      consoleBase: () => "http://localhost:3000",
      lookAt: () => {
        throw new Error("the monitor lane posts through the store and looks at no page");
      },
      now: () => nowIso,
      platform: "darwin",
      rowPullRequests: () => ({ kind: "not-asked" }),
      run: () => {
        launches += 1;
        onLaunch();
      },
      writeDiagnostic: quiet,
      writeOut: quiet,
    },
    now: () => nowIso,
    openPage: async ({ url }) => err(`no page opens here: ${url}`),
    platform: "darwin",
    processes: NO_FSEVENTSD,
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, launches: () => launches, out };
}
