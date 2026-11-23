/**
 * The PURE half of what a backup records and what `store backup --status` says about it: the `last.json` arm one
 * night earns, the status exit code, and the status lines — one block per configured destination, so an unplugged
 * SSD reads "SSD … last written <date>" beside this Mac's own line.
 *
 * **Green means bytes reached a destination on the last attempt and none failed.** The record is shared — a
 * hand-typed `--local-only` overwrites the nightly's — so "the last invocation did what it was asked" and "there is a
 * fresh copy off this machine" are two questions, and only the second is worth alerting on. A drive that was out
 * beside a destination that was written is green: the night has a copy off its staging, and the drive's own line says
 * when it was last written. Every drive out is red; any destination that failed is red.
 */
import type { ConfiguredDestination, DestinationId } from "../../../store/backup/destinationConfig.js";
import {
  type DestinationAttempt,
  type LastOutcome,
  type LastOutcomeRead,
  LOCAL_ONLY_WHY,
  rootLabel,
} from "../../../store/backup/lastOutcome.js";
import type { LastUpload } from "../../../store/backup/receipts.js";
import type { BackupReport, DestinationOutcome } from "../../../store/backup/run.js";
import type { VolumePin } from "../../../store/backup/volumePin.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/**
 * What a destination is called on a line: the pinned drive's volume name, else the `/Volumes/<name>` it sits on,
 * else this Mac.
 *
 * @param root the destination root
 * @param pins every recorded pin
 * @returns the label
 */
export function destinationLabel({ root, pins }: { root: string; pins: readonly VolumePin[] }): string {
  const pin = pins.find((candidate) => candidate.root === root);
  if (pin === undefined) {
    return rootLabel({ root });
  }
  return pin.volumeName;
}

/**
 * The record of one destination's night.
 *
 * @param outcome what became of it
 * @param label what it is called
 * @returns the attempt
 */
function attemptOf({ outcome, label }: { outcome: DestinationOutcome; label: string }): DestinationAttempt {
  const { id, root } = outcome.destination;
  if (outcome.status === "succeeded") {
    return { id, label, prefix: outcome.report.receipt.prefix, root, status: "succeeded" };
  }
  if (outcome.status === "drive-not-plugged-in") {
    const { mountPoint, volumeUuid } = outcome.pin;
    return { id, label: outcome.pin.volumeName, mountPoint, root, status: "drive-not-plugged-in", volumeUuid };
  }
  return { errors: outcome.errors, id, label, root, status: "failed" };
}

/**
 * Which arm of the last-attempt record one finished backup earns.
 *
 * A night that sent to no destination at all — `--local-only` — earns `staged`, which has to carry a reason, so no
 * shape is left that says "succeeded" about bytes that never left the machine. Any night that tried a destination
 * earns `destinations`, even when every one failed: the staging exists.
 *
 * @param report what the backup did
 * @param atIso the attempt's own instant
 * @param pins every recorded pin, for each destination's label
 * @returns the record to write
 */
export function attemptOutcome({
  report,
  atIso,
  pins,
}: {
  report: BackupReport;
  atIso: string;
  pins: readonly VolumePin[];
}): LastOutcome {
  if (report.destinations.length === 0) {
    return { atIso, directory: report.directory, status: "staged", why: LOCAL_ONLY_WHY };
  }
  return {
    atIso,
    destinations: report.destinations.map((outcome) =>
      attemptOf({ label: destinationLabel({ pins, root: outcome.destination.root }), outcome }),
    ),
    directory: report.directory,
    status: "destinations",
  };
}

/**
 * Whether a read of `last.json` is something `store backup --status || <alert>` should stay quiet about.
 *
 * `absent` stays green because a fresh install that has never run a backup has nothing to alert about. The case it
 * cannot separate, and which the verb has no way to see, is an install where the `store-backup-daily` row was
 * registered and has never fired.
 *
 * @param outcome what the read of `last.json` found
 * @returns the exit code
 */
export function statusExitCode({ outcome }: { outcome: LastOutcomeRead }): number {
  if (outcome === "absent") {
    return EXIT_OK;
  }
  if (outcome === "unreadable" || outcome.status !== "destinations") {
    return EXIT_ERROR;
  }
  const { destinations } = outcome;
  const wrote = destinations.some((attempt) => attempt.status === "succeeded");
  const failed = destinations.some((attempt) => attempt.status === "failed");
  return wrote && !failed ? EXIT_OK : EXIT_ERROR;
}

/** One configured destination as `--status` reports it. */
export interface StatusDestination {
  readonly id: DestinationId;
  readonly root: string;
  readonly label: string;
  /** The volume pinned to this root now, or `null` for a folder on no drive. */
  readonly pinnedVolumeUuid: string | null;
  /** The newest upload a receipt on disk evidences, or `null` when none does. */
  readonly lastUpload: LastUpload | null;
  /** What the last staging-producing attempt did there, or `null` when it did not try this destination. */
  readonly attempt: DestinationAttempt | null;
}

/**
 * Every configured destination's status, in list order. A destination the record names but the list no longer
 * holds is left out: removing it from the list removes it from status, and its receipts stay as they are.
 *
 * @param destinations the configured destinations
 * @param uploads the newest upload evidenced for each, by id
 * @param outcome what the read of `last.json` found
 * @param pins every recorded pin
 * @returns one entry per destination
 */
export function statusDestinations({
  destinations,
  uploads,
  outcome,
  pins,
}: {
  destinations: readonly ConfiguredDestination[];
  uploads: ReadonlyMap<DestinationId, LastUpload | null>;
  outcome: LastOutcomeRead;
  pins: readonly VolumePin[];
}): readonly StatusDestination[] {
  const attempts = typeof outcome !== "string" && outcome.status === "destinations" ? outcome.destinations : [];
  return destinations.map(({ id, root }) => {
    const upload = uploads.get(id);
    const pin = pins.find((candidate) => candidate.root === root);
    const unattempted: StatusDestination = {
      attempt: null,
      id,
      label: destinationLabel({ pins, root }),
      lastUpload: upload === undefined ? null : upload,
      pinnedVolumeUuid: pin === undefined ? null : pin.volumeUuid,
      root,
    };
    // A destination added since the last run has no attempt in `last.json`, by design.
    const attempt = attempts.find((candidate) => candidate.id === id);
    if (attempt === undefined) {
      return unattempted;
    }
    return { ...unattempted, attempt };
  });
}

/**
 * The human report of `--status`: the verdict on the most recent attempt, then one block per destination.
 *
 * @param outcome what the read of `last.json` found
 * @param destinations every configured destination's status, each receipt's directory resolved as `night` is
 * @param night the attempted night's staging directory, resolved; `null` when no attempt staged one
 * @returns the lines, verdict first
 */
export function statusLines({
  outcome,
  destinations,
  night,
}: {
  outcome: LastOutcomeRead;
  destinations: readonly StatusDestination[];
  night: string | null;
}): readonly string[] {
  return [
    ...verdictLines({ outcome }),
    ...destinations.flatMap((destination) => destinationBlock({ destination, night })),
  ];
}

/**
 * The staging directory of the night the last attempt took, as `last.json` spells it. The shell resolves it, and each
 * receipt's directory, to the path the filesystem gives before `statusLines` compares the two, so one staging reached
 * through two spellings of the home still matches and two distinct stagings sharing a name never do.
 *
 * @param outcome what the read of `last.json` found
 * @returns the staging directory, or `null` when no attempt staged one
 */
export function attemptedStaging({ outcome }: { outcome: LastOutcomeRead }): string | null {
  if (outcome === "absent" || outcome === "unreadable" || outcome.status === "failed") {
    return null;
  }
  return outcome.directory;
}

/**
 * The verdict on what the most recent attempt did.
 *
 * @param outcome what the read of `last.json` found
 * @returns one line, or a verdict line and its detail
 */
function verdictLines({ outcome }: { outcome: LastOutcomeRead }): readonly string[] {
  if (outcome === "absent") {
    return ["store backup: no attempt has been recorded on this install"];
  }
  if (outcome === "unreadable") {
    return [
      "store backup: last.json is present and is NOT a last-attempt record — when this install last backed " +
        "up is unknown. Run `slopweaver store backup` to write a fresh one.",
    ];
  }
  if (outcome.status === "staged") {
    return [
      `store backup: last attempt ${outcome.atIso} wrote NOTHING to any destination — ${outcome.why}`,
      `  it is staged on this machine only, at ${outcome.directory}`,
    ];
  }
  if (outcome.status === "failed") {
    return [`store backup: last attempt ${outcome.atIso} FAILED`, ...outcome.errors.map((line) => `  ${line}`)];
  }
  const wrote = outcome.destinations.filter((attempt) => attempt.status === "succeeded").length;
  return [
    `store backup: last attempt ${outcome.atIso} wrote ${String(wrote)} of ${String(outcome.destinations.length)} ` +
      `destination(s) (staged at ${outcome.directory})`,
  ];
}

/**
 * One destination's block: when it was last written, then what the last attempt did there.
 *
 * @param destination its status
 * @param night the staging directory of the night the last attempt took, resolved; `null` when it staged none
 * @returns its lines
 */
function destinationBlock({
  destination,
  night,
}: {
  destination: StatusDestination;
  night: string | null;
}): readonly string[] {
  const { label, root, lastUpload, attempt } = destination;
  const head =
    lastUpload === null
      ? `  ${label} (${root}): no staged copy on this machine holds a receipt for it, so there is no local evidence of any write`
      : `  ${label} (${root}) last written ${lastUpload.uploadedAtIso} (${lastUpload.prefix})`;
  return [head, ...attemptLines({ attempt, sentSince: sentSinceAttempt({ destination, night }) })];
}

/**
 * Whether a sweep has since sent this destination the night its drive was out for. A sweep leaves `last.json` as the
 * night wrote it, so the attempt still reads out; the newest receipt sitting in that night's own staging directory
 * says the advice has been taken — the staging a receipt was read from, never the prefix written inside it.
 * It counts only while the drive pinned now is the one the attempt found out: a receipt names a
 * root, not a volume, so after a different drive is pinned at the same root the old drive's receipt says nothing about
 * the new one. The UUIDs compare exactly as the writer compares them
 * (`store/backup/volumePin.ts`'s `different-volume`): the attempt's UUID is copied from the pin, which only the
 * diskutil probe writes, so only a hand-edited pin differs in casing — and the writer refuses that pin too.
 *
 * @param destination its status
 * @param night the staging directory of the night the last attempt took, resolved; `null` when it staged none
 * @returns whether the night has since reached the drive the attempt found out
 */
function sentSinceAttempt({ destination, night }: { destination: StatusDestination; night: string | null }): boolean {
  const { attempt, lastUpload, pinnedVolumeUuid } = destination;
  if (night === null || lastUpload === null || attempt?.status !== "drive-not-plugged-in") {
    return false;
  }
  return attempt.volumeUuid === pinnedVolumeUuid && lastUpload.directory === night;
}

/**
 * What the last attempt did at one destination.
 *
 * @param attempt its record, or `null` when the last attempt did not try it
 * @param sentSince whether a sweep has since sent this destination the night the attempt could not
 * @returns zero or more lines
 */
function attemptLines({
  attempt,
  sentSince,
}: {
  attempt: DestinationAttempt | null;
  sentSince: boolean;
}): readonly string[] {
  if (attempt === null) {
    return [];
  }
  if (attempt.status === "succeeded") {
    return [`    last attempt wrote ${attempt.prefix}`];
  }
  if (attempt.status === "drive-not-plugged-in" && sentSince) {
    return [`    last attempt: DRIVE NOT PLUGGED IN at ${attempt.mountPoint}; a sweep has since sent that night`];
  }
  if (attempt.status === "drive-not-plugged-in") {
    return [
      `    last attempt: DRIVE NOT PLUGGED IN — nothing was mounted at ${attempt.mountPoint}; plug the drive ` +
        `(volume ${attempt.volumeUuid}) in and \`slopweaver store backup --sweep-only\` sends it`,
    ];
  }
  return ["    last attempt FAILED", ...attempt.errors.map((line) => `      ${line}`)];
}
