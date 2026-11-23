/**
 * Nights and sweeps for the `backupRun*.test.ts` files: a destination at a test folder, a reachable target straight
 * into it under the test key, and one-destination wrappers over the list-shaped `runBackup` and `runSweepOnly`, so a
 * test about ONE destination reads like one. A list of destinations is driven directly, in
 * `backupRunDestinations.test.ts`.
 */
import { err, ok, type Result, unwrap } from "../../../lib/result.js";
import {
  type ConfiguredDestination,
  configuredDestination,
  type DestinationId,
} from "../../../store/backup/destinationConfig.js";
import { NO_PROTECTION } from "../../../store/backup/protectedPaths.js";
import {
  type BackupDeps,
  type BackupReport,
  type BackupTarget,
  reachableTarget,
  runBackup,
} from "../../../store/backup/run.js";
import type { DestinationSendReport } from "../../../store/backup/sendStaging.js";
import {
  type DestinationSweep,
  reachableSweepTarget,
  runSweepOnly,
  type SweepTarget,
} from "../../../store/backup/sweepRun.js";
import type { BackupTransport } from "../../../store/backup/transport.js";

import { besideHome, FAKE_STACK, KEY, STORE_URL } from "./backupRunWorld.js";
import { directoryTransport } from "./directoryTransport.js";

/**
 * A configured destination at a test's folder, read the way the list file's addresses are.
 *
 * @param root the destination directory
 * @returns the configured destination
 */
export function destinationAt({ root }: { root: string }): ConfiguredDestination {
  return unwrap(configuredDestination({ address: root }));
}

/**
 * The ids a list of destination roots owes, for a run's `obligations`.
 *
 * @param roots the destination directories
 * @returns their ids, in order
 */
export function idsOf({ roots }: { roots: readonly string[] }): readonly DestinationId[] {
  return roots.map((root) => destinationAt({ root }).id);
}

/**
 * A night's reachable target straight into a directory, or the transport given.
 *
 * @param root the destination directory, and its configured root
 * @param transport the plain destination, when not the directory itself
 * @param key the backup key, when not the test key
 * @param masterPassword the password the key is wrapped under, when one is set
 * @returns the target
 */
export function nightTarget({
  root,
  transport = directoryTransport({ root }),
  key = KEY,
  masterPassword = null,
}: {
  root: string;
  transport?: BackupTransport;
  key?: Buffer;
  masterPassword?: string | null;
}): BackupTarget {
  return reachableTarget({
    destination: destinationAt({ root }),
    key,
    masterPassword,
    transport,
  });
}

/**
 * A sweep's reachable target straight into a directory, or the transport given.
 *
 * @param home the sandbox home
 * @param root the destination directory
 * @param transport the plain destination, when not the directory itself
 * @param key the backup key, when not the test key
 * @param masterPassword the password the key is wrapped under, when one is set
 * @returns the target
 */
export function sweepTarget({
  home,
  root,
  transport = directoryTransport({ root }),
  key = KEY,
  masterPassword = null,
}: {
  home: string;
  root: string;
  transport?: BackupTransport;
  key?: Buffer;
  masterPassword?: string | null;
}): SweepTarget {
  return reachableSweepTarget({
    destination: destinationAt({ root }),
    home,
    key,
    masterPassword,
    transport,
  });
}

/**
 * One night to the ONE destination beside the home — sent, or staged and stopped while still owing it.
 *
 * @param home the sandbox home
 * @param nowIso the night's instant
 * @param transport the plain destination, when not the directory beside the home
 * @param localOnly stage and stop, the way `--local-only` does
 * @param key the backup key, `null` for a night with no Vault leg
 * @param masterPassword the password, when one is set
 * @param deps the stack, when not the fake one
 * @param keepLocal how many stagings to keep, when not the default
 * @returns the run's report
 */
export async function oneNight({
  home,
  nowIso,
  transport,
  localOnly = false,
  key = KEY,
  masterPassword = null,
  deps = FAKE_STACK,
  keepLocal,
}: {
  home: string;
  nowIso: string;
  transport?: BackupTransport;
  localOnly?: boolean;
  key?: Buffer | null;
  masterPassword?: string | null;
  deps?: BackupDeps;
  keepLocal?: number;
}): Promise<Result<BackupReport>> {
  const root = besideHome({ home });
  const targets: BackupTarget[] = [];
  if (!localOnly && key !== null) {
    targets.push(nightTarget({ key, masterPassword, root, ...(transport === undefined ? {} : { transport }) }));
  }
  return runBackup({
    deps,
    home,
    key,
    masterPassword,
    nowIso,
    obligations: idsOf({ roots: [root] }),
    owes: [destinationAt({ root })],
    protection: NO_PROTECTION,
    storeUrl: STORE_URL,
    targets,
    ...(keepLocal === undefined ? {} : { keepLocal }),
  });
}

/**
 * The ONE destination's send report, or its failure lines.
 *
 * @param report the run's report
 * @returns what sending did, or why that destination did not get the staging
 */
export function sentReport({ report }: { report: BackupReport }): Result<DestinationSendReport> {
  const outcome = report.destinations[0]!;
  if (outcome.status === "succeeded") {
    return ok(outcome.report);
  }
  if (outcome.status === "failed") {
    return err(outcome.errors);
  }
  return err([`${outcome.destination.root} was not plugged in`]);
}

/**
 * One sweep of the ONE destination beside the home, as the old single-destination result: what it swept and what
 * finishing pruned, or why it stopped.
 *
 * @param home the sandbox home
 * @param transport the plain destination, when not the directory beside the home
 * @param key the backup key, when not the test key
 * @param masterPassword the password, when one is set
 * @param keepLocal how many stagings to keep
 * @returns what it swept and pruned, or its failure lines
 */
export async function sweepOnce({
  home,
  transport,
  key = KEY,
  masterPassword = null,
  keepLocal,
}: {
  home: string;
  transport?: BackupTransport;
  key?: Buffer;
  masterPassword?: string | null;
  keepLocal?: number;
}): Promise<Result<DestinationSweep & { readonly pruned: readonly string[]; readonly released: readonly string[] }>> {
  const root = besideHome({ home });
  const swept = await runSweepOnly({
    home,
    obligations: idsOf({ roots: [root] }),
    targets: [sweepTarget({ home, key, masterPassword, root, ...(transport === undefined ? {} : { transport }) })],
    ...(keepLocal === undefined ? {} : { keepLocal }),
  });
  const outcome = swept.destinations[0]!;
  if (outcome.status === "swept") {
    return ok({ ...outcome.report, pruned: swept.pruned, released: swept.released });
  }
  if (outcome.status === "failed") {
    return err(outcome.errors);
  }
  return err([`${outcome.destination.root} was not plugged in`]);
}
