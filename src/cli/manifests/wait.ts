/**
 * Lazy manifest for the `wait` noun — one call that waits on a process or a file, so a session never writes
 * the poll loop the poll gate refuses. A bare noun: `slopweaver wait --pid <n>`. Loads only when dispatched.
 */
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const waitMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // `runWaitWithDeps` refuses a bare run (`targetOf` finds no --pid or --file) and an unknown flag before it waits on anything.
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver wait --pid 4242 --timeout-seconds 300",
  parseRejectIsIoFree: true,
  summary:
    "Wait with ONE call until a process exits or a file exists (or carries some text) — stepped backoff, change-only output, --timeout-seconds",
  usage: "usage: slopweaver wait (--pid <n> | --file <path> [--contains <text>]) [--timeout-seconds <n>]",
} as const;

const loadWait = () => import("../commands/wait/run.js").then((m) => m.waitCommand);

export const waitManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadWait, meta: waitMeta }),
};
