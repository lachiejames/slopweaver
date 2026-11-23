/**
 * Lazy manifest for the `session-start` noun — the ranked list of what is tasked to the owner.
 *
 * The only hyphenated noun in the registry, and deliberately so. `session` is already the supervisor's own
 * session ledger (`close`, `depth`, `list`, `watch`, `standing`, `respawn`), so `session start` would read
 * as "start a session" — a different act entirely. The owner named this thing `session-start` and it keeps
 * that name rather than being bent to fit a convention nothing enforces.
 *
 * `effect: "external-read"`: it reads the board, each doc's repository probes and the Linear corpus, and
 * writes nothing at all. It ALSO re-reads every row live through the door before ranking it — the only
 * traffic that leaves the machine, and the default, because an opt-in flag plus a printed
 * caveat shipped the owner three rows of finished work. `--no-verify` turns that leg off.
 */
import { LOCK_IN_USAGE } from "../commands/sessionStart/lockInUsage.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

/** Shared meta for the bare noun and the `run` verb, which are the same handler. */
const runMeta = {
  createsWorkItem: false,
  // Read-only: it scans the handover board, evaluates probes and prints. Nothing is written or posted.
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  example: "slopweaver session-start",
  parseRejectIsIoFree: true,
  summary:
    "The ranked list of what is actually waiting on you, each row carrying who asked, where it lives and what would count as done",
  usage:
    "usage: slopweaver session-start [--json] [--probe] [--no-verify] [--no-record] [--top <n>] [--now <iso>] [--deadline <iso>] [--home <dir>] [--dir <dir>] [--base <ref>] [--out <path>]",
} as const;

/**
 * Meta for `lock-in`, the walk's only write.
 *
 * `effect: "local-state"`: one append to the home's own ledger. It reaches no provider, so it is not door
 * business — every action a resolution implies is a separate verb the owner chooses.
 */
const lockInMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example:
    'slopweaver session-start lock-in --item linear:INFR-1513 --against 2026-08-29T06:45:56.267Z --proposed "close it, the work shipped" --reply do --outcome approved-as-proposed',
  parseRejectIsIoFree: true,
  summary: "Record one thing the owner said while walking the list, so tomorrow's ranking answers to it",
  usage: LOCK_IN_USAGE,
} as const;

/** Lazy loader for the shared handler. */
const loadRun = () => import("../commands/sessionStart/run.js").then((m) => m.sessionStartCommand);

/** Lazy loader for the lock-in handler. */
const loadLockIn = () => import("../commands/sessionStart/lockInRun.js").then((m) => m.sessionStartLockInCommand);

/** The `session-start` noun's verbs as lazy manifest entries. */
export const sessionStartManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadRun, meta: runMeta }),
  "lock-in": lazy({ load: loadLockIn, meta: lockInMeta }),
  run: lazy({ load: loadRun, meta: runMeta }),
};
