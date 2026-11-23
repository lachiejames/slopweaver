/**
 * The LIST of local destinations a backup writes to, and the stable id each one is known by.
 *
 * Owner ruling: one encrypt-and-send path writes to a list — this Mac's folder for rollback and the
 * pinned SSD for disaster recovery, the same night — and only local destinations are built. The list is the
 * remembered `secrets/store-backup-directory`, one address per line in the order the night writes them; a one-line
 * file is today's single destination, read unchanged. `--destination <address>` and {@link BACKUP_DIRECTORY_ENV}
 * each replace the whole list with one address, for one run.
 *
 * A destination's id is the first 16 hex of the sha256 of its normalised root, so the same folder spelled as a path
 * or a `file://` URL is one destination, and its id is the same whether or not its drive is mounted tonight. A
 * receipt, a status line and a `last.json` entry are all keyed by it.
 *
 * The file is read here, not through `tokenFromEnvOrHomeFile`: that reader folds a read failure into absence and
 * hands back the whole multi-line text as one value, and a list whose read failed is not a list that is empty.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";

import { secretFilePath } from "../../stateHome.js";
import { BACKUP_DIRECTORY_ENV, BACKUP_DIRECTORY_SECRET, localPathOfAddress } from "./destination.js";
import { type DestinationListError, DestinationListErrors } from "./destinationListErrors.js";
import { BackupErrors } from "./errors.js";

/** The stable id of one destination: 16 lowercase hex of the sha256 of its normalised root. */
export type DestinationId = string;

/** One destination on the list. */
export interface ConfiguredDestination {
  /** The address as it was written: a path or a `file://` URL. */
  readonly address: string;
  /** The absolute, resolved path the address names. */
  readonly root: string;
  readonly id: DestinationId;
}

/** Where tonight's list came from: the `--destination` flag, the environment override, or the remembered file. */
export type BackupDestinationOrigin = "flag" | "environment" | "remembered";

/** The destinations a run writes to, in order, and which source named them. */
export interface BackupDestinationSelection {
  readonly destinations: readonly ConfiguredDestination[];
  readonly origin: BackupDestinationOrigin;
}

/**
 * The id a destination root is known by.
 *
 * @param root the normalised absolute root, as {@link localPathOfAddress} returns it
 * @returns 16 lowercase hex characters
 */
export function destinationId({ root }: { root: string }): DestinationId {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

/**
 * One address read into a destination.
 *
 * @param address the address as written
 * @returns the destination, or why the address names no local folder
 */
export function configuredDestination({
  address,
}: {
  address: string;
}): Result<ConfiguredDestination, DestinationListError> {
  return localPathOfAddress({ address }).map((root) => ({ address, id: destinationId({ root }), root }));
}

/**
 * Read the text of the remembered list into its destinations, in file order. A final newline is allowed; a blank
 * line between two addresses, the same folder named twice, and two folders sharing an id are refused by line.
 *
 * @param text the file's contents
 * @param path the file the text came from, for the refusal
 * @returns the destinations, in order — empty when the text holds none
 */
export function parseDestinationList({
  text,
  path,
}: {
  text: string;
  path: string;
}): Result<readonly ConfiguredDestination[], DestinationListError> {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (lines.length === 1 && lines[0]!.trim() === "") {
    return ok([]);
  }
  const destinations: ConfiguredDestination[] = [];
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const address = raw.trim();
    if (address === "") {
      return err(DestinationListErrors.blankLine({ line, path }));
    }
    const read = configuredDestination({ address });
    if (read.isErr()) {
      return err(read.error);
    }
    const listed = destinations.find((existing) => existing.id === read.value.id);
    if (listed?.root === read.value.root) {
      return err(DestinationListErrors.duplicate({ line, path, root: read.value.root }));
    }
    if (listed !== undefined) {
      return err(DestinationListErrors.idCollision({ line, other: listed.root, path, root: read.value.root }));
    }
    destinations.push(read.value);
  }
  return ok(destinations);
}

/**
 * The remembered list, read straight from the secret file.
 *
 * @param home the Slopweaver home the file sits under
 * @returns the destinations in order — empty when the file is absent or blank — or why it could not be read
 */
export function rememberedDestinations({
  home,
}: {
  home: string;
}): Result<readonly ConfiguredDestination[], DestinationListError> {
  const path = secretFilePath({ home, name: BACKUP_DIRECTORY_SECRET });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause: unknown) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok([]);
    }
    return err(DestinationListErrors.unreadable({ cause, path }));
  }
  return parseDestinationList({ path, text });
}

/**
 * The text a list is remembered as: one address per line, newline-terminated.
 *
 * @param destinations the destinations, in the order the night should write them
 * @returns the file's contents
 */
export function destinationListText({ destinations }: { destinations: readonly ConfiguredDestination[] }): string {
  return destinations.map((destination) => `${destination.address}\n`).join("");
}

/**
 * The destinations a backup writes to tonight: the `--destination` flag's one, else the environment override's
 * one, else the remembered list, else a refusal naming every place one can be put.
 *
 * @param override the `--destination` flag's value, or `null` when it was not passed
 * @param home the Slopweaver home the remembered list sits under
 * @param env the environment {@link BACKUP_DIRECTORY_ENV} is read from
 * @returns the destinations in order and where they came from
 */
export function backupDestinations({
  override,
  home,
  env = process.env,
}: {
  override: string | null;
  home: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Result<BackupDestinationSelection, DestinationListError> {
  if (override !== null) {
    return configuredDestination({ address: override }).map((one) => ({ destinations: [one], origin: "flag" }));
  }
  const fromEnv = env[BACKUP_DIRECTORY_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") {
    return configuredDestination({ address: fromEnv }).map((one) => ({ destinations: [one], origin: "environment" }));
  }
  const remembered = rememberedDestinations({ home });
  if (remembered.isErr()) {
    return err(remembered.error);
  }
  if (remembered.value.length === 0) {
    return err(
      BackupErrors.destinationUnselected({ envName: BACKUP_DIRECTORY_ENV, secretName: BACKUP_DIRECTORY_SECRET }),
    );
  }
  return ok({ destinations: remembered.value, origin: "remembered" });
}

/**
 * The ONE destination a recovery, a rehearsal or a key check reads from: the selection's first, in list order.
 * A later destination is never probed in its place when the first is out — that would be a silent fallback to a
 * copy the operator did not name. `--destination` is how another one is read.
 *
 * @param override the `--destination` flag's value, or `null` when it was not passed
 * @param home the Slopweaver home the remembered list sits under
 * @param env the environment {@link BACKUP_DIRECTORY_ENV} is read from
 * @returns the first destination and where it came from
 */
export function backupReadDestination({
  override,
  home,
  env = process.env,
}: {
  override: string | null;
  home: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Result<
  { readonly destination: ConfiguredDestination; readonly origin: BackupDestinationOrigin },
  DestinationListError
> {
  return backupDestinations({ env, home, override }).map((selection) => ({
    destination: selection.destinations[0]!,
    origin: selection.origin,
  }));
}
