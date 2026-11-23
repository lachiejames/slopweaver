/**
 * One backup, start to finish — staged ONCE, then sent to every destination on the list in order — with every effect
 * behind a seam a test can replace. One destination's send is `./sendStaging.ts`; the sweep is `./sweepRun.ts`.
 *
 * ## The order, and why it is this order
 *
 * 1. `pg_dump --version` — reaches the container before anything is written, so a stopped stack is the
 *    first line of the report rather than an empty dump file.
 * 2. The dump, then the tar, into a fresh staging directory named for the instant, then the Vault leg sealed
 *    under the backup key into `vault.enc` (`./vault.ts`) — `null` in the manifest only when no key was given.
 * 3. Digest both, cut the dump into its chunks (`./chunks.ts`), and write the dump manifest — a staging
 *    directory with no `manifest.json` is by construction an unfinished backup, and a restore refuses it.
 * 4. Record which destinations the staging owes (`./stagingDestinations.ts`), then the files leg's prepare half —
 *    every file frozen once — whose `files.json` is therefore the LAST file a staging gains before it is sent.
 *    `staging.ts`'s `isStranded` selects on exactly that, so the writes cannot be reordered without breaking the sweep.
 * 5. For EACH destination, in list order: the backup key's wrap under the master password BEFORE any object
 *    (`./keyWrapStep.ts`), the files it lacks, the staged artefacts manifest-last, and its own receipt. A destination
 *    that fails, throws or whose drive is out is recorded and the next one is still sent.
 * 6. Once every destination has been tried: name what each still lacks, release the frozen copies every destination
 *    now holds, and prune (`./finishStagings.ts`).
 *
 * ## Who decides how each destination is reached
 *
 * Not this file. A destination arrives as a {@link BackupTarget}: out (its pinned drive is not plugged in), failed
 * before anything was attempted, or reachable with a `send` the CLI built — and the CLI's `send` is what routes that
 * one destination's write through its own door (`cli/commands/store/backupRun.ts`). So the door sees one write per
 * destination, and an out drive enters none.
 *
 * ## A run does not sweep
 *
 * An EARLIER staging a destination never got is sent by `store backup --sweep-only`, never by the nightly run. A
 * stranded staging carries a whole dump, and MEASURED each was 0.9–1.5 GB (`find
 * "$SLOPWEAVER_HOME/backups/store" -name store.dump -exec ls -l {} +`) against an uplink of 645 KiB/s, where the
 * recipe's 1700-second budget holds about 1.07 GB in all. A strand is a recovery, run on purpose.
 *
 * What the attempt is RECORDED as is `./lastOutcome.ts`.
 */
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import type { RetryPolicy } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";
import type { ConfiguredDestination, DestinationId } from "./destinationConfig.js";
import { backupErrorLines } from "./errors.js";
import { walkBackedUpFiles } from "./files.js";
import { prepareFilesLeg } from "./filesPrepare.js";
import { finishStagings, type StrandedFor, type UnremovedStaging } from "./finishStagings.js";
import { type BackupManifest, backupDirectoryName } from "./plan.js";
import { prepareStaging } from "./prepareStaging.js";
import type { BackupProtection, SkippedProtectedPath } from "./protectedPaths.js";
import { BackupSendErrors } from "./sendErrors.js";
import { type DestinationSendReport, type PreparedBackup, sendPreparedBackup } from "./sendStaging.js";
import { digestFile, dumpDatabase, pgDumpVersion, tarStorage } from "./stack.js";
import { listExtensions } from "./stackDatabase.js";
import { stagingRoot } from "./staging.js";
import { writeStagingDestinations } from "./stagingDestinations.js";
import type { BackupTransport } from "./transport.js";
import { sealVault } from "./vault.js";
import type { VolumePin } from "./volumePin.js";

/** How many staging directories every destination holds stay on disk after a run. */
export const DEFAULT_KEEP_LOCAL = 1;

/** The effects a backup runs through, so a test can replace the stack and the destination. */
export interface BackupDeps {
  readonly walkBackedUpFiles: typeof walkBackedUpFiles;
  readonly pgDumpVersion: typeof pgDumpVersion;
  readonly listExtensions: typeof listExtensions;
  readonly dumpDatabase: typeof dumpDatabase;
  readonly tarStorage: typeof tarStorage;
  readonly digestFile: typeof digestFile;
  readonly sealVault: typeof sealVault;
}

/** The production effects. */
const PRODUCTION_BACKUP_DEPS: BackupDeps = {
  digestFile,
  dumpDatabase,
  listExtensions,
  pgDumpVersion,
  sealVault,
  tarStorage,
  walkBackedUpFiles,
};

/** What became of one destination on one night. */
export type DestinationOutcome =
  | {
      readonly status: "succeeded";
      readonly destination: ConfiguredDestination;
      readonly report: DestinationSendReport;
    }
  | {
      readonly status: "drive-not-plugged-in";
      readonly destination: ConfiguredDestination;
      readonly pin: VolumePin;
      /** Whether the drive was pulled during the send, rather than absent from the start. */
      readonly ejected: boolean;
    }
  | { readonly status: "failed"; readonly destination: ConfiguredDestination; readonly errors: readonly string[] };

/** One destination as a night finds it, before anything is sent. */
export type BackupTarget =
  | {
      readonly kind: "reachable";
      readonly destination: ConfiguredDestination;
      /** Send the prepared staging to this destination — through its own door — and say what became of it. */
      readonly send: (args: { prepared: PreparedBackup }) => Promise<DestinationOutcome>;
    }
  | { readonly kind: "not-plugged-in"; readonly destination: ConfiguredDestination; readonly pin: VolumePin }
  | { readonly kind: "failed"; readonly destination: ConfiguredDestination; readonly errors: readonly string[] };

/** What one backup did. */
export interface BackupReport {
  readonly directory: string;
  readonly manifest: BackupManifest;
  /**
   * What the night's files measured — what each destination was sent is in its own outcome — and every protected
   * path the walk pruned, with the owner's reason, so a source left out is named rather than silently absent.
   */
  readonly files: {
    readonly count: number;
    readonly bytes: number;
    readonly vanished: number;
    readonly skippedProtectedPaths: readonly SkippedProtectedPath[];
  };
  /** One per destination, in list order. */
  readonly destinations: readonly DestinationOutcome[];
  /** Earlier stagings each destination never got, left for `--sweep-only` and NAMED so the run never hides one. */
  readonly stranded: readonly StrandedFor[];
  readonly released: readonly string[];
  readonly pruned: readonly string[];
  /** What finishing could not remove, reported rather than thrown so `last.json` is still written. */
  readonly unremoved: readonly UnremovedStaging[];
}

/**
 * Stage one night: dump, tar, Vault, manifest, what it owes, and every file frozen once.
 *
 * @param home the Slopweaver home the staging root lives under
 * @param storeUrl the store selection, whose database is what gets dumped
 * @param key the backup key that seals the Vault leg; `null` stages with no Vault leg
 * @param masterPassword the password that seals `secrets.enc`, or `null` when none is set
 * @param nowIso the backup's own instant
 * @param destinations every destination this staging is to be sent to, recorded as what it owes
 * @param protection the owner's protected paths, pruned from the files leg before it lists them
 * @param deps the stack effects
 * @returns the prepared staging, or every reason it could not be made
 */
async function prepareBackup({
  home,
  storeUrl,
  key,
  masterPassword,
  nowIso,
  destinations,
  protection,
  deps,
}: {
  home: string;
  storeUrl: string;
  key: Buffer | null;
  masterPassword: string | null;
  nowIso: string;
  destinations: readonly ConfiguredDestination[];
  protection: BackupProtection;
  deps: BackupDeps;
}): Promise<Result<PreparedBackup>> {
  const directory = join(stagingRoot({ home }), backupDirectoryName({ createdAtIso: nowIso }));
  const manifest = await prepareStaging({ deps, directory, home, key, masterPassword, nowIso, storeUrl });
  if (manifest.isErr()) {
    return err(backupErrorLines({ error: manifest.error }));
  }
  writeStagingDestinations({ destinations, directory });
  const files = prepareFilesLeg({ deps, directory, home, nowIso, protection });
  if (files.isErr()) {
    return err(files.error);
  }
  return ok({ directory, files: files.value, manifest: manifest.value, nowIso });
}

/**
 * Run one backup: stage once, send to every target in order, then name, release and prune.
 *
 * @param home the Slopweaver home the staging root lives under
 * @param storeUrl the store selection
 * @param key the backup key, or `null` for a run that stages and stops
 * @param masterPassword the password, read once by the verb, or `null` when none is set
 * @param nowIso the backup's own instant
 * @param targets every destination sent tonight, in list order — empty for `--local-only`
 * @param owes every configured destination, recorded as what tonight's staging owes — the targets' destinations on
 *   a night that sends, the whole list on a `--local-only` one, so `--sweep-only` still sends it later
 * @param obligations the ids pruning reads each staging against (`pruneObligations`)
 * @param keepLocal how many staging directories every destination holds to keep on disk
 * @param protection the owner's protected paths, read once by the verb before anything was touched
 * @param deps the stack effects
 * @returns the report, or every reason the staging could not be made — one destination failing is in the report
 */
export async function runBackup({
  home,
  storeUrl,
  key,
  masterPassword,
  nowIso,
  targets,
  owes,
  obligations,
  protection,
  keepLocal = DEFAULT_KEEP_LOCAL,
  deps = PRODUCTION_BACKUP_DEPS,
}: {
  home: string;
  storeUrl: string;
  key: Buffer | null;
  masterPassword: string | null;
  nowIso: string;
  targets: readonly BackupTarget[];
  owes: readonly ConfiguredDestination[];
  obligations: readonly DestinationId[];
  protection: BackupProtection;
  keepLocal?: number;
  deps?: BackupDeps;
}): Promise<Result<BackupReport>> {
  if (key === null && targets.length > 0) {
    return err([BackupSendErrors.keyless().message]);
  }
  const prepared = await prepareBackup({
    deps,
    destinations: owes,
    home,
    key,
    masterPassword,
    nowIso,
    protection,
    storeUrl,
  });
  if (prepared.isErr()) {
    return err(prepared.error);
  }
  const outcomes: DestinationOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await attempt({ prepared: prepared.value, target }));
  }
  return ok(finishedReport({ home, keepLocal, nowIso, obligations, outcomes, owes, prepared: prepared.value }));
}

/**
 * Once every destination has been tried: name what each still lacks, release and prune, and report the night.
 *
 * @param home the Slopweaver home the staging root lives under
 * @param prepared the night's staging
 * @param outcomes one per destination tried, in list order
 * @param owes every configured destination tonight's staging owes
 * @param obligations the ids pruning reads each staging against
 * @param keepLocal how many staging directories every destination holds to keep on disk
 * @param nowIso the backup's own instant, which names tonight's staging
 * @returns the night's report
 */
function finishedReport({
  home,
  prepared,
  outcomes,
  owes,
  obligations,
  keepLocal,
  nowIso,
}: {
  home: string;
  prepared: PreparedBackup;
  outcomes: readonly DestinationOutcome[];
  owes: readonly ConfiguredDestination[];
  obligations: readonly DestinationId[];
  keepLocal: number;
  nowIso: string;
}): BackupReport {
  const { directory, files, manifest } = prepared;
  const finished = finishStagings({
    destinations: owes,
    keepLocal,
    obligations,
    prune: outcomes.some((outcome) => outcome.status === "succeeded"),
    root: stagingRoot({ home }),
    tonight: backupDirectoryName({ createdAtIso: nowIso }),
  });
  const bytes = files.entries.reduce((sum, file) => sum + file.bytes, 0);
  return {
    destinations: outcomes,
    directory,
    files: {
      bytes,
      count: files.entries.length,
      skippedProtectedPaths: files.skippedProtectedPaths,
      vanished: files.vanished,
    },
    manifest,
    ...finished,
  };
}

/**
 * A reachable target that sends straight to `transport` — what the CLI's door wraps, and what a test hands in.
 *
 * @param destination which configured destination this is
 * @param transport the PLAIN destination
 * @param key the backup key
 * @param masterPassword the password the key is wrapped under, or `null` when none is set
 * @param uploadRetry how a failed upload session is retried, when not the default
 * @returns the target
 */
export function reachableTarget({
  destination,
  transport,
  key,
  masterPassword,
  uploadRetry,
}: {
  destination: ConfiguredDestination;
  transport: BackupTransport;
  key: Buffer;
  masterPassword: string | null;
  uploadRetry?: RetryPolicy;
}): BackupTarget {
  return {
    destination,
    kind: "reachable",
    send: async ({ prepared }) => {
      const sent = await sendPreparedBackup({
        destination,
        key,
        masterPassword,
        prepared,
        transport,
        ...(uploadRetry === undefined ? {} : { uploadRetry }),
      });
      if (sent.isErr()) {
        return { destination, errors: sent.error, status: "failed" };
      }
      return { destination, report: sent.value, status: "succeeded" };
    },
  };
}

/**
 * What became of one target: its own state when nothing could be attempted, else its send — with a throw turned
 * into that destination's failure, so it cannot stop the next one.
 *
 * @param prepared the night's staging
 * @param target the destination as the night found it
 * @returns the destination's outcome
 */
async function attempt({
  prepared,
  target,
}: {
  prepared: PreparedBackup;
  target: BackupTarget;
}): Promise<DestinationOutcome> {
  const { destination } = target;
  if (target.kind === "not-plugged-in") {
    return { destination, ejected: false, pin: target.pin, status: "drive-not-plugged-in" };
  }
  if (target.kind === "failed") {
    return { destination, errors: target.errors, status: "failed" };
  }
  try {
    return await target.send({ prepared });
  } catch (cause: unknown) {
    const why = errorMessage({ error: cause });
    return { destination, errors: [BackupSendErrors.threw({ root: destination.root, why }).message], status: "failed" };
  }
}
