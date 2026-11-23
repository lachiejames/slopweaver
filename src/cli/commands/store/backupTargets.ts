/**
 * One door per destination: the targets a night (`runBackup`) and a sweep (`runSweepOnly`) are handed, each
 * reachable destination's write routed through its OWN `external-write` door, so the ledger carries one record per
 * destination written and a refused door stops that destination alone.
 *
 * A destination's root is made inside its door's `perform`, never before it passed (`./writeDestination.ts`'s
 * `openWriteDestination`). A drive that is out enters no door: nothing leaves the machine for it.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorGate } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { ConfiguredDestination } from "../../../store/backup/destinationConfig.js";
import { readMasterPassword } from "../../../store/backup/masterPassword.js";
import type { BackupTarget, DestinationOutcome } from "../../../store/backup/run.js";
import { type PreparedBackup, sendPreparedBackup } from "../../../store/backup/sendStaging.js";
import { isStranded } from "../../../store/backup/staging.js";
import { type SweepTarget, sweepDestination } from "../../../store/backup/sweepRun.js";
import { allErrors, resolveBackupKey } from "./verbShell.js";
import {
  type DriveProbes,
  driveNowUnplugged,
  openWriteDestination,
  SYSTEM_DRIVE_PROBES,
  type WriteInspection,
} from "./writeDestination.js";

/** The door every destination's write passes: its gates and the ledger it records through. */
export interface BackupDoor {
  readonly gates: readonly DoorGate[];
  readonly ledger: DoorLedgerPort;
}

/**
 * The production door: no extra gates, the store-backed ledger.
 *
 * @returns the door
 */
export function productionBackupDoor(): BackupDoor {
  return { gates: DEFAULT_GATES, ledger: doorLedgerPort() };
}

/** What every destination's write is sealed under. */
export interface Sealing {
  readonly key: { readonly key: Buffer; readonly fingerprint: string };
  readonly masterPassword: string | null;
}

/** Reads the backup key and the master password, once per run; a test passes its own. */
export type ReadSealing = (args: { home: string }) => Result<Sealing>;

/**
 * The production read: the Keychain key with no prompt, and the master password from its 0600 file — absent is
 * `null`, while a value under the floor or a file that cannot be read refuses, because then the password exists and
 * is wrong. Both are read before either is refused, so one run names every missing piece.
 *
 * @param home the Slopweaver home whose `secrets/` holds the password
 * @returns both, or every reason either could not be read
 */
export const productionSealing: ReadSealing = ({ home }) => {
  const key = resolveBackupKey();
  const masterPassword = readMasterPassword({ home }).mapErr((error) => [error.message]);
  if (key.isOk() && masterPassword.isOk()) {
    return ok({ key: key.value, masterPassword: masterPassword.value });
  }
  return err(allErrors({ results: [key, masterPassword] }));
};

/**
 * The door request for one destination's write. It carries ids — the root, its id, the key's fingerprint, the
 * instant — never a byte of what is being backed up.
 *
 * @param destination the destination written
 * @param instant the night's instant, or the sweep's
 * @param fingerprint the backup key's fingerprint
 * @param home the Slopweaver home the decision is recorded under
 * @param sweep whether this is a sweep, so the ledger tells a night that took a dump from one that only sent an old one
 * @returns the request
 */
function backupRequest({
  destination,
  instant,
  fingerprint,
  home,
  sweep,
}: {
  destination: ConfiguredDestination;
  instant: string;
  fingerprint: string;
  home: string;
  sweep: boolean;
}): Parameters<typeof throughDoor>[0]["request"] {
  return {
    action: { kind: "verb", noun: "store", verb: "backup" },
    artifact: {
      destination: destination.root,
      destinationId: destination.id,
      instant,
      keyFingerprint: fingerprint,
      ...(sweep ? { mode: "sweep-only" } : {}),
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * A night's targets, one per inspected destination, in list order.
 *
 * @param home the Slopweaver home
 * @param inspections every destination as inspected
 * @param sealing the backup key and master password, read once by the verb
 * @param nowIso the night's instant
 * @param door the gates and ledger each destination's door uses
 * @param probes the drive reads
 * @returns the targets
 */
export function nightTargets({
  home,
  inspections,
  sealing,
  nowIso,
  door,
  probes = SYSTEM_DRIVE_PROBES,
}: {
  home: string;
  inspections: readonly WriteInspection[];
  sealing: Sealing;
  nowIso: string;
  door: BackupDoor;
  probes?: DriveProbes;
}): readonly BackupTarget[] {
  return inspections.map((inspection): BackupTarget => {
    if (inspection.kind !== "reachable") {
      return inspection;
    }
    return {
      destination: inspection.destination,
      kind: "reachable",
      send: ({ prepared }) => sendThroughDoor({ door, home, inspection, nowIso, prepared, probes, sealing }),
    };
  });
}

/**
 * Send the night to one reachable destination through its own door, and say what became of it.
 *
 * @param home the Slopweaver home
 * @param inspection the destination, as inspected
 * @param sealing the backup key and master password
 * @param nowIso the night's instant
 * @param door the gates and ledger
 * @param probes the drive reads
 * @param prepared the night's staging, finished and frozen
 * @returns the destination's outcome — a refused door and a failed write are both `failed`
 */
async function sendThroughDoor({
  home,
  inspection,
  sealing,
  nowIso,
  door,
  probes,
  prepared,
}: {
  home: string;
  inspection: Extract<WriteInspection, { kind: "reachable" }>;
  sealing: Sealing;
  nowIso: string;
  door: BackupDoor;
  probes: DriveProbes;
  prepared: PreparedBackup;
}): Promise<DestinationOutcome> {
  const { destination } = inspection;
  const routed = await throughDoor({
    gates: door.gates,
    home,
    ledger: door.ledger,
    perform: async () => {
      const opened = openWriteDestination({ create: true, home, inspection, probes });
      if (opened.isErr()) {
        return err(opened.error);
      }
      const { key, masterPassword } = sealing;
      return sendPreparedBackup({ destination, key: key.key, masterPassword, prepared, transport: opened.value });
    },
    request: backupRequest({ destination, fingerprint: sealing.key.fingerprint, home, instant: nowIso, sweep: false }),
  });
  if (!routed.performed) {
    const errors = notPerformedLines({ command: "slopweaver store backup", through: routed });
    return { destination, errors, status: "failed" };
  }
  if (routed.result.isOk()) {
    return { destination, report: routed.result.value, status: "succeeded" };
  }
  return failedSendOutcome({ directory: prepared.directory, errors: routed.result.error, inspection, probes });
}

/**
 * What a send that failed became. A drive pulled mid-send fails the next write (`pinnedTransport`); when it is out
 * now and the staging is whole but unsent here, the destination is in the same state as one whose drive was absent,
 * and is recorded as one. Anything else is the failure it was.
 *
 * @param inspection the destination, as inspected before the send
 * @param errors why the send failed
 * @param directory the night's staging directory
 * @param probes the drive reads, taken again now
 * @returns the destination's outcome
 */
export function failedSendOutcome({
  inspection,
  errors,
  directory,
  probes,
}: {
  inspection: Extract<WriteInspection, { kind: "reachable" }>;
  errors: readonly string[];
  directory: string;
  probes: DriveProbes;
}): DestinationOutcome {
  const { destination, held } = inspection;
  const ejected =
    held !== null && driveNowUnplugged({ pin: held.pin, probes }) && isStranded({ destination, directory });
  if (ejected) {
    return { destination, ejected: true, pin: held.pin, status: "drive-not-plugged-in" };
  }
  return { destination, errors, status: "failed" };
}

/**
 * A sweep's targets, one per inspected destination, in list order.
 *
 * @param home the Slopweaver home
 * @param inspections every destination as inspected
 * @param sealing the backup key and master password, read once by the verb
 * @param atIso the sweep's instant
 * @param door the gates and ledger each destination's door uses
 * @param probes the drive reads
 * @returns the targets
 */
export function sweepTargets({
  home,
  inspections,
  sealing,
  atIso,
  door,
  probes = SYSTEM_DRIVE_PROBES,
}: {
  home: string;
  inspections: readonly WriteInspection[];
  sealing: Sealing;
  atIso: string;
  door: BackupDoor;
  probes?: DriveProbes;
}): readonly SweepTarget[] {
  return inspections.map((inspection): SweepTarget => {
    if (inspection.kind !== "reachable") {
      return inspection;
    }
    const { destination } = inspection;
    return {
      destination,
      kind: "reachable",
      sweep: async () => {
        const routed = await throughDoor({
          gates: door.gates,
          home,
          ledger: door.ledger,
          perform: async () => {
            const opened = openWriteDestination({ create: true, home, inspection, probes });
            if (opened.isErr()) {
              return err(opened.error);
            }
            const { key, masterPassword } = sealing;
            return sweepDestination({ destination, home, key: key.key, masterPassword, transport: opened.value });
          },
          request: backupRequest({
            destination,
            fingerprint: sealing.key.fingerprint,
            home,
            instant: atIso,
            sweep: true,
          }),
        });
        if (!routed.performed) {
          const command = "slopweaver store backup --sweep-only";
          return { destination, errors: notPerformedLines({ command, through: routed }), status: "failed" };
        }
        if (routed.result.isErr()) {
          return { destination, errors: routed.result.error, status: "failed" };
        }
        return { destination, report: routed.result.value, status: "swept" };
      },
    };
  });
}
