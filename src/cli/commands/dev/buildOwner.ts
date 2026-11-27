/**
 * The pure half of running `dev build`'s esbuild under `scripts/tsc-owner.sh`: its bounds, the owner argv, and what
 * the owner's records on stderr MEAN.
 *
 * ## Why esbuild runs under the compiler owner
 *
 * An esbuild process grew to about 28 GB and froze a machine while four seats ran the seat lint lane and a dev
 * build at once. Which process it was was never identified; this is one of the two candidates, and the other is the
 * `runtime-dependencies` gate's esbuild service (soft-limited in `src/devLint/gateGroups.ts`). Before this, nothing
 * bounded `dev build`'s esbuild at all: it is a Go binary no V8 flag reaches, it took no lock, and every ref-move
 * hook, worktree provision, lap and console shot could start one beside the others. The owner already gives a
 * native Go compiler what that needs: the machine's one compile LEASE (one heavy compile at a time per OS user,
 * inherited by a descendant of the holder, so a lap's own build never deadlocks on the lap), a HARD ceiling on the
 * process group's summed resident memory, a timeout, and a Go soft memory limit.
 *
 * ## The two memory numbers, and why they are far apart
 *
 * - The HARD ceiling, {@link DEV_BUILD_RSS_CEILING_MIB} = 16,384 MiB, sits ABOVE the largest legitimate build canon
 *   has measured (14,902,345,728 bytes, about 14,212 MiB, docs/toolchain/build.md) and well under the 28 GB
 *   event. Below that measurement it would be a bet of every seat's dist-cli on two unreconciled readings a factor of
 *   three apart, and a fleet silently falling back to source is its own load problem.
 * - The SOFT limit, `ESBUILD_GO_MEMORY_LIMIT_MIB` = 4,096 MiB (`src/lib/esbuildBounds.ts`), does the real work: the
 *   Go collector works harder as the heap nears it and exceeds it rather than fail, so a build that really needs
 *   more slows down rather than dies. It has not been measured under that limit yet; once it has, the ceiling can
 *   come down toward what it reads.
 *
 * The `heap-ceiling-ratchet` gate does not pin either number: it reads package scripts, the lint gate registry and
 * one budget constant, and a ceiling held in a TypeScript constant is outside its readers by construction
 * (`src/devLint/heapCeilingSubjects.ts` names this blind spot).
 *
 * ## The time numbers
 *
 * {@link DEV_BUILD_LOCK_TIMEOUT_SECONDS} bounds the lease wait so a `post-merge` hook never holds a pull for the whole
 * length of a lap; {@link DEV_BUILD_TIMEOUT_SECONDS} bounds the emit, MEASURED at 3.8 s to 15.7 s unlimited. With the
 * owner's grace and settle, both fit inside {@link DEV_BUILD_SPAWN_TIMEOUT_MS}, which fits inside worktree
 * provisioning's own five-minute bound on the whole verb (`src/worktree/shell.ts` `DEV_BUILD_TIMEOUT_MS`).
 */
import { join } from "node:path";

import { ESBUILD_GO_MEMORY_LIMIT_MIB } from "#lib/esbuildBounds.js";

/** The hard bound on esbuild's process group's summed resident memory, in MiB. */
export const DEV_BUILD_RSS_CEILING_MIB = 16_384;

/** How long a build waits for the machine's compile lease before it is refused, in seconds. */
export const DEV_BUILD_LOCK_TIMEOUT_SECONDS = 120;

/** How long the emit itself may run, in seconds. */
export const DEV_BUILD_TIMEOUT_SECONDS = 120;

/** The owner's grace between TERM and KILL, in seconds; the owner refuses more than five. */
const DEV_BUILD_GRACE_SECONDS = 5;

/**
 * The bound on the owner's whole spawn, in milliseconds: the lease wait, the emit, the grace and the owner's own
 * five-second settle, with room for its setup, and still under provisioning's 300 s on the whole verb.
 */
export const DEV_BUILD_SPAWN_TIMEOUT_MS = 270_000;

/** The owner script and the esbuild binary, repo-relative. */
const OWNER_SCRIPT = "scripts/tsc-owner.sh";
const ESBUILD_BIN = "node_modules/.bin/esbuild";

/**
 * The argv after `bash` that runs one esbuild emit under the owner.
 *
 * @param root the checkout whose owner and esbuild are run
 * @param esbuildArgs the argv after the esbuild binary
 * @returns the owner script, its bounds, `--`, then esbuild and its arguments
 */
export function ownedEsbuildArgv({
  root,
  esbuildArgs,
}: {
  root: string;
  esbuildArgs: readonly string[];
}): readonly string[] {
  return [
    join(root, OWNER_SCRIPT),
    "--timeout-seconds",
    String(DEV_BUILD_TIMEOUT_SECONDS),
    "--grace-seconds",
    String(DEV_BUILD_GRACE_SECONDS),
    "--rss-ceiling-mib",
    String(DEV_BUILD_RSS_CEILING_MIB),
    "--lock-timeout-seconds",
    String(DEV_BUILD_LOCK_TIMEOUT_SECONDS),
    "--go-memory-limit-mib",
    String(ESBUILD_GO_MEMORY_LIMIT_MIB),
    "--",
    join(root, ESBUILD_BIN),
    ...esbuildArgs,
  ];
}

/** What one owned esbuild run came to. Only `built` and `waited-out` emitted anything a build may smoke or stamp. */
export type DevBuildOwnerVerdict =
  | { readonly kind: "built"; readonly lockMode: "acquired" | "inherited" }
  | { readonly kind: "waited-out"; readonly lockMode: "acquired" | "inherited"; readonly waitedSeconds: number }
  | { readonly kind: "refused" }
  | { readonly kind: "killed"; readonly peakRssKiB: number }
  | { readonly kind: "timed-out" }
  | { readonly kind: "cancelled"; readonly outcome: string }
  | { readonly kind: "owner-error"; readonly detail: string }
  | { readonly kind: "esbuild-failed"; readonly commandExit: number; readonly detail: string }
  | { readonly kind: "spawn-failed"; readonly detail: string }
  | { readonly kind: "invalid-owner-report"; readonly detail: string };

/** The exit the owner gives each outcome other than `exited`, whose exit is the command's own. */
const OUTCOME_EXITS: ReadonlyMap<string, number> = new Map([
  ["cancelled-hup", 129],
  ["cancelled-int", 130],
  ["cancelled-term", 143],
  ["lock-timed-out", 75],
  ["owner-error", 125],
  ["rss-ceiling", 126],
  ["timed-out", 124],
]);

/** How the owner held the compile lease: it took it, or an ancestor (a lap) already held it. */
type LeaseMode = "acquired" | "inherited";

/** Whether a LOCK record's `mode` is one the owner writes. */
function isLeaseMode(value: string | undefined): value is LeaseMode {
  return value === "acquired" || value === "inherited";
}

/**
 * One record's fields, or an EMPTY map when the record is malformed: a field with no `=` or no key, or a key written
 * twice. A `Map` keeps the last of two equal keys, so `outcome=rss-ceiling outcome=exited` would otherwise read as a
 * clean exit; empty, every field check below fails it closed.
 */
function recordFields({ line }: { line: string }): Map<string, string> {
  const fields = new Map<string, string>();
  for (const pair of line.split(" ").slice(1)) {
    const equals = pair.indexOf("=");
    const key = pair.slice(0, equals);
    if (equals <= 0 || fields.has(key)) {
      return new Map();
    }
    fields.set(key, pair.slice(equals + 1));
  }
  return fields;
}

/** Every `TSC_OWNER_<kind>` record on stderr, its fields read as `key=value` pairs. */
function ownerRecords({
  stderr,
  kind,
}: {
  stderr: string;
  kind: "LOCK" | "START" | "RESULT";
}): readonly Map<string, string>[] {
  return stderr
    .split("\n")
    .filter((line) => line.startsWith(`TSC_OWNER_${kind} `))
    .map((line) => recordFields({ line }));
}

/** The owner's own prose lines on stderr (a refusal, the one waiting line) all open with this. */
const OWNER_PROSE = "tsc-owner: ";

/**
 * One non-empty stderr line that is not an owner record: the command's FIRST (esbuild's opening error), or the owner's
 * LAST (why it stopped — its waiting line, when it waited, comes earlier).
 *
 * @param owner true for the owner's prose, false for the command's
 * @returns the line, or `""` when there is none
 */
function proseLine({ stderr, owner }: { stderr: string; owner: boolean }): string {
  const lines = stderr
    .split("\n")
    .filter((text) => text.trim() !== "" && !text.startsWith("TSC_OWNER_") && text.startsWith(OWNER_PROSE) === owner);
  const line = owner ? lines.at(-1) : lines[0];
  if (line === undefined) {
    return "";
  }
  return line;
}

/** A whole non-negative number written in decimal, or `undefined`. */
function wholeNumber({ text }: { text: string | undefined }): number | undefined {
  return text !== undefined && /^\d+$/u.test(text) ? Number(text) : undefined;
}

/** The verdict for a command the owner ran to its own exit: one LOCK record names how the lease was held. */
function exitedVerdict({
  status,
  stderr,
  result,
}: {
  status: number;
  stderr: string;
  result: Map<string, string>;
}): DevBuildOwnerVerdict {
  const commandExit = wholeNumber({ text: result.get("commandExit") });
  if (commandExit !== status) {
    return {
      detail: `the owner reported commandExit=${String(result.get("commandExit"))} but exited ${String(status)}`,
      kind: "invalid-owner-report",
    };
  }
  if (commandExit !== 0) {
    return { commandExit, detail: proseLine({ owner: false, stderr }), kind: "esbuild-failed" };
  }
  const locks = ownerRecords({ kind: "LOCK", stderr });
  const lock = locks[0];
  const waitedSeconds = wholeNumber({ text: lock?.get("waitedSeconds") });
  const lockMode = lock?.get("mode");
  const holderKnown = wholeNumber({ text: lock?.get("holderPid") }) !== undefined;
  if (locks.length !== 1 || waitedSeconds === undefined || !isLeaseMode(lockMode) || !holderKnown) {
    return {
      detail: `a command that ran must follow exactly one well-formed lease record, not ${String(locks.length)}`,
      kind: "invalid-owner-report",
    };
  }
  // A clean exit with no START record is an exit the owner never forked a job for: nothing it can vouch ran. The
  // owner prints START and RESULT from the same `pid`, `pgid` and `start_hex` variables, so a RESULT naming another
  // job is a report about a different process, never this one.
  const starts = ownerRecords({ kind: "START", stderr });
  const start = starts[0];
  const startKnown =
    wholeNumber({ text: start?.get("pid") }) !== undefined && wholeNumber({ text: start?.get("pgid") }) !== undefined;
  const sameJob = ["pid", "pgid", "startHex"].every(
    (field) => start?.get(field) !== undefined && start.get(field) !== "" && start.get(field) === result.get(field),
  );
  if (starts.length !== 1 || !startKnown || !sameJob) {
    return {
      detail: `a command that ran must follow exactly one well-formed start record, not ${String(starts.length)}`,
      kind: "invalid-owner-report",
    };
  }
  if (waitedSeconds > 0) {
    return { kind: "waited-out", lockMode, waitedSeconds };
  }
  return { kind: "built", lockMode };
}

/**
 * What one owned esbuild run came to, read off the owner's own records and exit — never inferred from esbuild's.
 *
 * Fails CLOSED: a missing, repeated or malformed result record, or an exit that disagrees with the outcome it
 * records, is `invalid-owner-report`, never a success. A spawn error outranks every record, because a spawn that
 * failed or was killed at its own bound has no report the owner stood behind.
 *
 * @param status the owner's exit status, `null` when a signal ended it
 * @param stderr everything the owner and esbuild wrote to stderr
 * @param spawnError the spawn's own error, when it failed to start or ran past its bound
 * @returns the verdict
 */
export function devBuildOwnerVerdict({
  status,
  stderr,
  spawnError,
}: {
  status: number | null;
  stderr: string;
  spawnError: Error | undefined;
}): DevBuildOwnerVerdict {
  if (spawnError !== undefined) {
    return { detail: spawnError.message, kind: "spawn-failed" };
  }
  if (status === null) {
    return {
      detail: "the owner was ended by a signal, so it reported nothing it stood behind",
      kind: "invalid-owner-report",
    };
  }
  const results = ownerRecords({ kind: "RESULT", stderr });
  const result = results[0];
  if (results.length !== 1 || result === undefined) {
    return {
      detail: `the owner must write exactly one result record, not ${String(results.length)}`,
      kind: "invalid-owner-report",
    };
  }
  const outcome = result.get("outcome");
  if (outcome === "exited") {
    return exitedVerdict({ result, status, stderr });
  }
  if (outcome === undefined || OUTCOME_EXITS.get(outcome) !== status) {
    return {
      detail: `the owner reported outcome=${String(outcome)} but exited ${String(status)}`,
      kind: "invalid-owner-report",
    };
  }
  switch (outcome) {
    case "lock-timed-out":
      return { kind: "refused" };
    case "rss-ceiling": {
      const peakRssKiB = wholeNumber({ text: result.get("peakRssKiB") });
      if (peakRssKiB === undefined) {
        return { detail: "the owner reported rss-ceiling with no peak it measured", kind: "invalid-owner-report" };
      }
      return { kind: "killed", peakRssKiB };
    }
    case "timed-out":
      return { kind: "timed-out" };
    case "owner-error":
      return { detail: proseLine({ owner: true, stderr }), kind: "owner-error" };
    default:
      // Only the three `cancelled-*` outcomes reach here: every other key of the exit table is a case above.
      return { kind: "cancelled", outcome };
  }
}

/**
 * Whether esbuild ran to a clean exit under the owner, so its output may be smoke-run and stamped.
 *
 * @returns true for `built` and `waited-out` only
 */
export function ownerEmitted({ verdict }: { verdict: DevBuildOwnerVerdict }): boolean {
  return verdict.kind === "built" || verdict.kind === "waited-out";
}

/** The tail every failure line shares: what the checkout runs on now, and how it comes back. */
const UNSTAMPED =
  "dist-cli is left unstamped and this checkout runs from source until a `slopweaver dev build` succeeds";

/**
 * The ONE stderr line a run that emitted nothing usable prints, naming which way it ended.
 *
 * @returns the line, or `undefined` for a run that emitted — a success prints no stderr line at all
 */
export function ownerFailureLine({ verdict }: { verdict: DevBuildOwnerVerdict }): string | undefined {
  switch (verdict.kind) {
    case "built":
    case "waited-out":
      return undefined;
    case "refused":
      return `dev build: refused — the machine's compile lease stayed held past ${String(DEV_BUILD_LOCK_TIMEOUT_SECONDS)}s, so esbuild never ran; ${UNSTAMPED}`;
    case "killed":
      return `dev build: killed — esbuild's process group passed the ${String(DEV_BUILD_RSS_CEILING_MIB)} MiB resident-memory ceiling (peak ${String(Math.round(verdict.peakRssKiB / 1024))} MiB sampled); ${UNSTAMPED}`;
    case "timed-out":
      return `dev build: timed out — esbuild ran past ${String(DEV_BUILD_TIMEOUT_SECONDS)}s and was stopped; ${UNSTAMPED}`;
    case "cancelled":
      return `dev build: cancelled — the owner was sent a stop signal (${verdict.outcome}); ${UNSTAMPED}`;
    case "owner-error":
      return `dev build: owner error — ${verdict.detail === "" ? "the owner refused without saying why" : verdict.detail}; ${UNSTAMPED}`;
    case "esbuild-failed":
      return `dev build: esbuild exited ${String(verdict.commandExit)} — ${verdict.detail === "" ? "it printed nothing" : verdict.detail}; ${UNSTAMPED}`;
    case "spawn-failed":
      return `dev build: the owner could not be run — ${verdict.detail}; ${UNSTAMPED}`;
    case "invalid-owner-report":
      return `dev build: the owner's report could not be read — ${verdict.detail}; ${UNSTAMPED}`;
    default: {
      const unreachable: never = verdict;
      return unreachable;
    }
  }
}
