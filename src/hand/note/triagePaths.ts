/**
 * Where a floating note and the desktop shell meet over rapid triage: the shell writes whether
 * triage is on to `state.json` while it runs, and a note's Pause timer and Triage off buttons each drop one file into
 * `commands/`, which the shell takes and hands the voice's page. The shell spells the same two paths itself
 * (`desktop/src/triageClock.ts` § triagePathsOf), since it is its own project and imports nothing from here.
 */
import { join } from "node:path";

import { stateHomePaths } from "../../stateHome.js";

/** The two places a note reads and writes for triage. */
export interface TriageNotePaths {
  /** The shell's projection: `{"on":…,"paused":…,"writtenMs":…}`, rewritten every half second while triage is on. */
  readonly statePath: string;
  /** Where a press lands as `<13-digit ms>-<uuid>.pause|resume|off`. */
  readonly commandsDir: string;
}

/**
 * The triage paths under one state home.
 *
 * @param home the state home
 * @returns `<home>/hand-steps/triage/state.json` and `<home>/hand-steps/triage/commands`
 */
export function triageNotePaths({ home }: { home: string }): TriageNotePaths {
  const dir = join(stateHomePaths({ home }).handSteps, "triage");
  return { commandsDir: join(dir, "commands"), statePath: join(dir, "state.json") };
}
