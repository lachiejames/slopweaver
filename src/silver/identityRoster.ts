/**
 * The identity roster — the install's human-curated who-is-who override (`IdentityRecord[]`, `./identity.ts`) —
 * as the `identity-roster` row of the store's `singleton_register` (`src/store/singletonRegister.ts`).
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local store and the home becomes
 * deletable. The roster is one ordered document every consumer reads whole, so it is one row: a JSON array kept in
 * order, duplicates and all, because `buildIdentityMap`'s "later entry wins" and the owner check's "first record
 * with a Linear identity" both read that order.
 *
 * Every document this module accepts — the import, a replacement, the stored row — is decoded STRICTLY by
 * `./identityRosterDecode.ts`, which says why.
 *
 * ## The retired file
 *
 * `$SLOPWEAVER_HOME/identity.json` was the authority before the store. A read finding no row imports it ONCE; from
 * then on the row is the authority and the file is inert. No file and no row is an empty roster at revision null —
 * loading new code never adopts state — and the first `identity roster replace` writes the row.
 *
 * ## A store outage is a refusal, never the file
 *
 * `IDENTITY_ROSTER_STORE_UNAVAILABLE`: who a handle names is unknown, so a caller that addresses a person stops.
 */
import { statSync } from "node:fs";

import { isAbsentError } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import {
  productionSingletonRegisterSeams,
  type SingletonRegisterOperations,
  type SingletonRegisterSeams,
  singletonRegister,
} from "../store/singletonRegister.js";
import type { IdentityRecord } from "./identity.js";
import { decodeIdentityRoster, readIdentityRosterFile } from "./identityRosterDecode.js";
import { type IdentityRosterError, IdentityRosterErrors, STORED_ROSTER_SOURCE } from "./identityRosterErrors.js";

/** The roster as it stands, with what a writer pins to and what a reader must be told. */
export interface IdentityRosterSnapshot {
  /** The records in their stored order; empty when no row exists and there was no file to import. */
  readonly records: readonly IdentityRecord[];
  /** The revision a writer pins to; null when no row exists yet. */
  readonly revision: number | null;
  /**
   * The retired `identity.json` when it is still in the home, readable or not. Beside a row (`revision` set) it is
   * inert, read by nothing; with no row, a {@link IdentityRosterPort.peek} reports it as what the next read will
   * ATTEMPT to import — attempt, because a malformed or unreadable file is refused then, not adopted.
   */
  readonly retiredFile: string | undefined;
}

/** The one door every reader and writer of the identity roster goes through. */
export interface IdentityRosterPort {
  readonly read: (request: { readonly home: string }) => Promise<Result<IdentityRosterSnapshot, IdentityRosterError>>;
  /** The row as it stands WITHOUT the one-time import — what a diagnostic that must create nothing reads. */
  readonly peek: (request: { readonly home: string }) => Promise<Result<IdentityRosterSnapshot, IdentityRosterError>>;
  /** Replace the whole roster, pinned to the revision the writer read; a conflict is never retried. */
  readonly replace: (request: {
    readonly expectedRevision: number | null;
    readonly home: string;
    readonly records: readonly IdentityRecord[];
  }) => Promise<Result<IdentityRosterSnapshot, IdentityRosterError>>;
}

/**
 * The line a reader prints when the retired file is still in the home: inert beside a row, or awaiting the one
 * import attempt when there is none. Pure.
 *
 * @param snapshot the roster as read or peeked
 * @returns the line, or `undefined` when the home holds no retired file
 */
export function retiredRosterFileLine({ snapshot }: { snapshot: IdentityRosterSnapshot }): string | undefined {
  if (snapshot.retiredFile === undefined) {
    return undefined;
  }
  if (snapshot.revision === null) {
    return (
      `${snapshot.retiredFile} is the retired identity roster and the store holds no row yet: the next roster read ` +
      "will attempt to import it once, and refuses rather than adopts it if it is malformed or unreadable"
    );
  }
  return (
    `${snapshot.retiredFile} is retired and read by nothing: the store's row (revision ${String(snapshot.revision)}) ` +
    "is the identity roster. Change it with `slopweaver identity roster replace`, then move that file out of the home"
  );
}

/** The seams the port is built over. */
export type IdentityRosterSeams = SingletonRegisterSeams<readonly IdentityRecord[], IdentityRosterError>;

/**
 * The register seams every port shares bar the connection: the retired file read and the stored decoder.
 *
 * @returns the import read, decoder and error factories
 */
export function identityRosterDomainSeams(): Omit<IdentityRosterSeams, "connect"> {
  return {
    decodeStored: ({ value }) => decodeIdentityRoster({ source: STORED_ROSTER_SOURCE, value }),
    errors: {
      revisionConflict: IdentityRosterErrors.revisionConflict,
      storeUnavailable: IdentityRosterErrors.storeUnavailable,
    },
    readImport: ({ home }) =>
      readIdentityRosterFile({
        operation: "read the retired identity roster",
        path: stateHomePaths({ home }).identityJson,
      }),
  };
}

/**
 * The retired file's path when it is still in the home — present at all, readable or not. A `stat`, never a read:
 * every snapshot asks this, a peek beside a row included, and a retired file's contents are the one-time import's
 * business alone (a read here would decode the whole file on every `doctor --deep`).
 */
function retiredFileOf({ home }: { home: string }): string | undefined {
  const path = stateHomePaths({ home }).identityJson;
  try {
    statSync(path);
    return path;
  } catch (error: unknown) {
    // A dangling link or an unreachable parent is not absence: the file may be there, so it is reported.
    if (isAbsentError({ error, path })) {
      return undefined;
    }
    return path;
  }
}

/**
 * The port over whichever register operations it is handed — production's or a unit test's in-memory ones.
 *
 * @param register the register's read and compare-and-set
 * @returns the port
 */
export function identityRosterPortOver({
  register,
}: {
  register: SingletonRegisterOperations<readonly IdentityRecord[], IdentityRosterError>;
}): IdentityRosterPort {
  const snapshotOf = ({
    document,
    home,
    revision,
  }: {
    document: readonly IdentityRecord[] | undefined;
    home: string;
    revision: number | null;
  }): IdentityRosterSnapshot => {
    const retiredFile = retiredFileOf({ home });
    if (document === undefined) {
      return { records: [], retiredFile, revision };
    }
    return { records: document, retiredFile, revision };
  };
  const answer = async ({
    home,
    pending,
  }: {
    home: string;
    pending: ReturnType<typeof register.read>;
  }): Promise<Result<IdentityRosterSnapshot, IdentityRosterError>> => {
    const read = await pending;
    if (read.isErr()) {
      return err(read.error);
    }
    return ok(snapshotOf({ document: read.value.document, home, revision: read.value.revision }));
  };
  return {
    peek: ({ home }) => answer({ home, pending: register.peek({ home }) }),
    read: ({ home }) => answer({ home, pending: register.read({ home }) }),
    replace: async ({ expectedRevision, home, records }) => {
      const written = await register.compareAndSet({ document: records, expectedRevision, home });
      if (written.isErr()) {
        return err(written.error);
      }
      return ok(snapshotOf({ document: written.value.document, home, revision: written.value.revision }));
    },
  };
}

/**
 * The port the identity roster is reached through: the store. Only composition roots call this.
 *
 * @returns the port every production reader and writer uses
 */
export function identityRosterPort(): IdentityRosterPort {
  return identityRosterPortOver({
    register: singletonRegister({
      seams: productionSingletonRegisterSeams({ ...identityRosterDomainSeams(), id: "identity-roster" }),
    }),
  });
}
