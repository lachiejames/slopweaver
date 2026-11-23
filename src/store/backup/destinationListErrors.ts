/**
 * Why the remembered LIST of backup destinations could not be read or changed. Its own union beside
 * `./errors.ts`'s, because a list has failures a single address never had: a line that names nothing, two lines
 * that name one folder, a file that exists and cannot be read, a change naming a destination that is not there.
 * A refused ADDRESS inside the list is still `./errors.ts`'s own variant, carried as it is.
 */
import { errorMessage } from "#lib/errorMessage.js";

import type { BackupError } from "./errors.js";

/** The remembered list holds a line that is not a usable entry. */
export interface DestinationListMalformedError {
  readonly code: "DESTINATION_LIST_MALFORMED";
  readonly message: string;
  readonly path: string;
  readonly line: number;
}

/** The remembered list exists and could not be read. */
export interface DestinationListUnreadableError {
  readonly code: "DESTINATION_LIST_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** A change names a destination the list already holds, or one it does not. */
export interface DestinationListChangeRefusedError {
  readonly code: "DESTINATION_LIST_CHANGE_REFUSED";
  readonly message: string;
  readonly root: string;
}

/** Every way reading or changing the list fails: its own three, or an address refused as `./errors.ts` refuses one. */
export type DestinationListError =
  DestinationListMalformedError | DestinationListUnreadableError | DestinationListChangeRefusedError | BackupError;

/** The factories. */
export const DestinationListErrors = {
  alreadyListed: ({ root }: { root: string }): DestinationListChangeRefusedError => ({
    code: "DESTINATION_LIST_CHANGE_REFUSED",
    message: `${root} is already a backup destination — nothing was changed`,
    root,
  }),
  duplicate: ({ path, line, root }: { path: string; line: number; root: string }): DestinationListMalformedError => ({
    code: "DESTINATION_LIST_MALFORMED",
    line,
    message: `${path} line ${String(line)} names ${root} again — each destination is listed once`,
    path,
  }),
  idCollision: ({
    path,
    line,
    root,
    other,
  }: {
    path: string;
    line: number;
    root: string;
    other: string;
  }): DestinationListMalformedError => ({
    code: "DESTINATION_LIST_MALFORMED",
    line,
    message: `${path} line ${String(line)} names ${root}, whose destination id is already ${other}'s — rename one folder`,
    path,
  }),
  lastDestination: ({ root }: { root: string }): DestinationListChangeRefusedError => ({
    code: "DESTINATION_LIST_CHANGE_REFUSED",
    message:
      `${root} is the only backup destination, so removing it would leave the nightly with nowhere to write — ` +
      "name another with --set-destination instead",
    root,
  }),
  notListed: ({ root }: { root: string }): DestinationListChangeRefusedError => ({
    code: "DESTINATION_LIST_CHANGE_REFUSED",
    message: `${root} is not a backup destination — nothing was removed`,
    root,
  }),
  blankLine: ({ path, line }: { path: string; line: number }): DestinationListMalformedError => ({
    code: "DESTINATION_LIST_MALFORMED",
    line,
    message: `${path} line ${String(line)} is blank — the list is one address per line, with no gaps`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): DestinationListUnreadableError => ({
    cause,
    code: "DESTINATION_LIST_UNREADABLE",
    message: `could not read the backup destination list ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;
