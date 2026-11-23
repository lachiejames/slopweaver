/**
 * The fleet's memory on disk, applied to Electron: the episode and its one automatic attempt, read once at start and
 * saved, one save after another, each time `fleetShell.ts` changes it. The file and its shape are `fleetProcess.ts`.
 */
import { join } from "node:path";

import { app } from "electron";

import type { FleetAutomation } from "./fleetAutomationEpisode";
import { readFleetAutomation, writeFleetAutomation } from "./fleetProcess";

/** What the memory tells the rest of the shell. */
export interface FleetMemoryHost {
  /** A saved-state problem for the menu bar. */
  readonly reportProblem: (options: { readonly problem: string }) => void;
}

let host: FleetMemoryHost | undefined;
/** The newest save of the fleet's memory; the next one waits for it. */
let saving: Promise<boolean> = Promise.resolve(true);

/**
 * The host, once `startFleetMemory` has run.
 *
 * @returns the host
 */
function hostOf(): FleetMemoryHost {
  if (host === undefined) {
    throw new Error("the fleet memory was used before startFleetMemory");
  }
  return host;
}

/** The fleet's file, beside the window's own state. */
function automationPath(): string {
  return join(app.getPath("userData"), "fleet.json");
}

/**
 * Give the memory the shell it reports to. Nothing is read yet.
 *
 * @param memoryHost what the memory tells the rest of the shell
 */
export function startFleetMemory({ memoryHost }: { memoryHost: FleetMemoryHost }): void {
  host = memoryHost;
}

/**
 * Read the saved episode, reporting a failure.
 *
 * @returns the saved memory, or `undefined` when it could not be read
 */
export async function readFleetMemory(): Promise<FleetAutomation | undefined> {
  const read = await readFleetAutomation({ path: automationPath() });
  if (read.isErr()) {
    hostOf().reportProblem({ problem: read.error.message });
    return undefined;
  }
  return read.value;
}

/**
 * Write the fleet's memory to disk, reporting a failure. Saves run one after another in the order the memory changed,
 * so the last one to finish is always the newest memory: a dismissal saved beside a launch can never land after it
 * and leave a launch typed that the disk does not count.
 *
 * @param next the memory to write
 * @returns whether it is on disk
 */
export async function saveFleetMemory({ next }: { readonly next: FleetAutomation }): Promise<boolean> {
  const queued = saving.then(async () => {
    const written = await writeFleetAutomation({ automation: next, path: automationPath() });
    if (written.isErr()) {
      hostOf().reportProblem({ problem: written.error.message });
      return false;
    }
    return true;
  });
  saving = queued;
  return queued;
}
