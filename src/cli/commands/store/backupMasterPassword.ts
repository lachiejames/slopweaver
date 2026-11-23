/**
 * `store backup --create-master-password` and `--copy-master-password` — the one password a lost Mac opens its
 * backups with (one fleet-generated master password, 128 random bits, shown once for
 * the operator's password manager; it wraps the random backup key, and the wrap is written beside every backup).
 *
 * **The password is never printed** — not to a terminal, not in `--json`, not in a refusal or a door record.
 * This verb is typed by a Claude session as often as by a person, and anything on stdout lands in a model
 * transcript. It reaches the operator one way: `/usr/bin/pbcopy`'s stdin, to paste into a password manager.
 * `--copy-master-password` puts it there again from the `0600` file.
 *
 * Creation is EXCLUSIVE twice over: it refuses a destination already holding a wrap of this key (a password
 * exists, and is pasted back with `secrets set backup-passphrase`), and `secrets/backup-passphrase` is created by
 * an exclusive open that fails when anything already stands at the name — so a second run never replaces the password
 * every earlier wrap and `secrets.enc` was sealed under.
 */
import { existsSync } from "node:fs";

import { DEFAULT_GATES } from "../../../admit/door.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { createSecretFile } from "../../../secrets/store.js";
import { secretFilePath } from "../../../stateHome.js";
import { destinationHasKeyWrap, writeBackupKeyWrap } from "../../../store/backup/keyWrapStore.js";
import {
  copyMasterPassword,
  generateMasterPassword,
  MASTER_PASSWORD_MIN_CHARS,
  readMasterPassword,
} from "../../../store/backup/masterPassword.js";
import { MasterPasswordErrors } from "../../../store/backup/masterPasswordErrors.js";
import { SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import {
  admitBackupRun,
  readBackupProtection,
  refuseProtectedPassphrase,
} from "../../../store/backup/protectedPaths.js";
import { BACKUP_PASSPHRASE_SECRET } from "../../../store/backup/secretsBundle.js";
import { EXIT_OK } from "../../exitCodes.js";
import { allErrors, fail, resolveBackupKey } from "./verbShell.js";
import { inspectWriteDestinations, openWriteDestination, type WriteInspection } from "./writeDestination.js";

/** The line that hands the password over, said the same way by both modes. */
const PASTE_IT_NOW = "it is on the clipboard now — paste it into your password manager; it is never printed";

/** The command whose refusals and lines this file prints. */
const CREATE_COMMAND = "store backup --create-master-password";

/** A destination reachable for the wrap, as inspected. */
type Reachable = Extract<WriteInspection, { kind: "reachable" }>;

/** What a new master password wraps, and where. */
interface CreateInputs {
  /** Every reachable destination, in list order; each gets the wrap through its own door. */
  readonly reachable: readonly Reachable[];
  /** Every destination whose pinned drive is out — reported, and given the wrap by the next backup. */
  readonly out: readonly Extract<WriteInspection, { kind: "not-plugged-in" }>[];
  readonly key: { key: Buffer; fingerprint: string };
}

/**
 * Whether one reachable destination already holds this key's wrap. A root that does not exist yet holds nothing.
 *
 * @param home the Slopweaver home
 * @param inspection the destination
 * @param fingerprint the backup key's fingerprint, which names its wrap
 * @returns whether it holds the wrap, or why that could not be read
 */
async function holdsWrap({
  home,
  inspection,
  fingerprint,
}: {
  home: string;
  inspection: Reachable;
  fingerprint: string;
}): Promise<Result<boolean>> {
  if (!existsSync(inspection.physicalRoot)) {
    return ok(false);
  }
  const opened = openWriteDestination({ create: false, home, inspection });
  if (opened.isErr()) {
    return err(opened.error);
  }
  const held = await destinationHasKeyWrap({ fingerprint, project: SUPABASE_PROJECT_ID, transport: opened.value });
  return held.mapErr((error) => [error.message]);
}

/**
 * Every destination, inspected under the owner's protected paths: a run those paths hold inspects nothing.
 *
 * @param home the Slopweaver home
 * @param override what `--destination` carried, or `null`
 * @returns the inspections, or why the run is held
 */
function inspectUnderProtection({
  home,
  override,
}: {
  home: string;
  override: string | null;
}): ReturnType<typeof inspectWriteDestinations> {
  const admitted = admitBackupRun({ home, read: readBackupProtection });
  if (admitted.isErr()) {
    return err([admitted.error.message]);
  }
  const writable = refuseProtectedPassphrase({
    path: secretFilePath({ home, name: BACKUP_PASSPHRASE_SECRET }),
    home,
    protection: admitted.value,
  });
  if (writable.isErr()) {
    return err([writable.error.message]);
  }
  return inspectWriteDestinations({ home, override, protection: admitted.value });
}

/**
 * Every destination and the key a new master password wraps — required BEFORE anything is generated, because a
 * password with nothing to wrap is one the operator would save and later find opens nothing — and a refusal when any
 * destination already holds this key's wrap, since every `secrets.enc` the existing password sealed needs it, or
 * when one could not be read, since it might.
 *
 * @param home the Slopweaver home
 * @param override what `--destination` carried, or `null`
 * @returns the destinations and the key, or every reason a password must not be created
 */
async function createInputs({
  home,
  override,
}: {
  home: string;
  override: string | null;
}): Promise<Result<CreateInputs>> {
  const inspected = inspectUnderProtection({ home, override });
  const key = resolveBackupKey();
  if (inspected.isErr() || key.isErr()) {
    return err(allErrors({ results: [inspected, key] }));
  }
  const { fingerprint } = key.value;
  const refusals: string[] = [];
  const reachable: Reachable[] = [];
  for (const inspection of inspected.value.inspections) {
    const { root } = inspection.destination;
    if (inspection.kind === "failed") {
      refusals.push(...inspection.errors.map((line) => `${CREATE_COMMAND}: ${root}: ${line}`));
    } else if (inspection.kind === "reachable") {
      const held = await holdsWrap({ fingerprint, home, inspection });
      if (held.isErr()) {
        refusals.push(...held.error.map((line) => `${CREATE_COMMAND}: ${root}: ${line}`));
      } else if (held.value) {
        refusals.push(
          `${CREATE_COMMAND}: ${root} already holds a wrap of backup key ${fingerprint}, so a master password ` +
            "exists — paste it from your password manager with `slopweaver secrets set backup-passphrase` rather " +
            "than generating a second one",
        );
      } else {
        reachable.push(inspection);
      }
    }
  }
  if (refusals.length > 0) {
    return err(refusals);
  }
  const out = inspected.value.inspections.flatMap((inspection) =>
    inspection.kind === "not-plugged-in" ? [inspection] : [],
  );
  if (reachable.length === 0) {
    // A wrap the password cannot be written beside is a password that opens nothing, so none is generated.
    return err([
      `${CREATE_COMMAND}: no destination is reachable to take the key's wrap — plug the drive in and run it again`,
    ]);
  }
  return ok({ key: key.value, out, reachable });
}

/**
 * Write the backup key's wrap under the new password to one destination, through its own door.
 *
 * @param home the Slopweaver home
 * @param inspection the destination
 * @param key the backup key
 * @param password the new master password
 * @returns the line naming the wrap written, or the lines saying why the key was not wrapped there
 */
async function wrapThroughDoor({
  home,
  inspection,
  key,
  password,
}: {
  home: string;
  inspection: Reachable;
  key: { key: Buffer; fingerprint: string };
  password: string;
}): Promise<Result<string>> {
  const { root, id } = inspection.destination;
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: doorLedgerPort(),
    perform: async () => {
      const opened = openWriteDestination({ create: true, home, inspection });
      if (opened.isErr()) {
        return err(opened.error.join("; "));
      }
      const wrote = await writeBackupKeyWrap({
        key: key.key,
        password,
        project: SUPABASE_PROJECT_ID,
        transport: opened.value,
      });
      return wrote.mapErr((error) => error.message);
    },
    request: {
      action: { kind: "verb", noun: "store", verb: "backup" },
      artifact: { destination: root, destinationId: id, keyFingerprint: key.fingerprint, mode: "key-wrap" },
      meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
    },
  });
  if (!routed.performed) {
    return err(notPerformedLines({ command: `slopweaver ${CREATE_COMMAND}`, through: routed }));
  }
  if (routed.result.isErr()) {
    return err([`  ${root}: the backup key was NOT wrapped: ${routed.result.error}`]);
  }
  return ok(`  ${root}: backup key ${key.fingerprint} wrapped under it at ${routed.result.value.name}`);
}

/**
 * The `--create-master-password` path: generate the password, create its `0600` file exclusively, copy it to the
 * clipboard, and write the backup key's wrap to the destination through the door.
 *
 * @param home the Slopweaver home
 * @param override what `--destination` carried, or `null`
 * @param json whether to emit the record rather than the lines
 * @returns the exit code — non-zero when nothing was created, the key was not wrapped, or the copy failed
 */
export async function reportCreateMasterPassword({
  home,
  override,
  json,
}: {
  home: string;
  override: string | null;
  json: boolean;
}): Promise<number> {
  const inputs = await createInputs({ home, override });
  if (inputs.isErr()) {
    return fail({ lines: inputs.error });
  }
  const password = generateMasterPassword({});
  const created = createSecretFile({ home, name: BACKUP_PASSPHRASE_SECRET, value: password });
  if (created.isErr()) {
    return fail({ lines: [created.error.message] });
  }
  const copied = copyMasterPassword({ password });
  const { key, out, reachable } = inputs.value;
  const wraps: Result<string>[] = [];
  for (const inspection of reachable) {
    wraps.push(await wrapThroughDoor({ home, inspection, key, password }));
  }
  const copyLine = copied.isOk()
    ? `  ${PASTE_IT_NOW}`
    : `  ${copied.error.message} — run \`slopweaver store backup --copy-master-password\` to put it there`;
  const done = [
    `${CREATE_COMMAND}: created a ${String(MASTER_PASSWORD_MIN_CHARS)}-character master password at ${created.value.path}`,
    copyLine,
    ...wraps.flatMap((wrap) => (wrap.isOk() ? [wrap.value] : wrap.error)),
    ...out.map(
      ({ destination, pin }) =>
        `  ${destination.root}: drive not plugged in at ${pin.mountPoint} — the next \`store backup\` writes its wrap`,
    ),
  ];
  if (copied.isErr() || wraps.some((wrap) => wrap.isErr())) {
    return fail({ lines: done });
  }
  const value = {
    copiedToClipboard: true,
    keyFingerprint: key.fingerprint,
    notPluggedIn: out.map(({ destination }) => destination.root),
    passwordPath: created.value.path,
    wrapped: reachable.map(({ destination }) => destination.root),
  };
  const printed = json ? [safeJsonStringify({ label: CREATE_COMMAND, value })] : done;
  printed.forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/**
 * The `--copy-master-password` path: put the password from its `0600` file on the clipboard again.
 *
 * @param home the Slopweaver home
 * @param json whether to emit the record rather than the line
 * @returns the exit code — non-zero when no password is set, it cannot be read, or the copy failed
 */
export function reportCopyMasterPassword({ home, json }: { home: string; json: boolean }): number {
  const read = readMasterPassword({ home });
  if (read.isErr()) {
    return fail({ lines: [read.error.message] });
  }
  if (read.value === null) {
    const path = secretFilePath({ home, name: BACKUP_PASSPHRASE_SECRET });
    return fail({ lines: [MasterPasswordErrors.absent({ path }).message] });
  }
  const copied = copyMasterPassword({ password: read.value });
  if (copied.isErr()) {
    return fail({ lines: [copied.error.message] });
  }
  logger.out({
    line: json
      ? safeJsonStringify({ label: "store backup --copy-master-password", value: { copiedToClipboard: true } })
      : `store backup --copy-master-password: ${PASTE_IT_NOW}`,
  });
  return EXIT_OK;
}
