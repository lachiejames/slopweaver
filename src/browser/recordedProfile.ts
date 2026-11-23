/**
 * Which of the owner's own Chrome profiles the browser legs use — the `browser-profile` row of the store's
 * `singleton_register` (`src/store/singletonRegister.ts`), never this repository.
 *
 * The split is the no-private-identifiers rule doing its job. The MECHANISM (read Chrome's index, use the
 * recorded directory) is committed; the CHOICE (which directory, belonging to which account) is a private
 * identifier and lives only in the install's store. Nothing here guesses: an unrecorded profile is a refusal
 * that tells the operator to run `slopweaver browser profile --list` and pick, because a guess that lands on a
 * personal profile would drive the owner's own browsing as if it were work.
 *
 * The document is `{ "profileDirectory": "<directory>" }`. A stored row that is not that shape is REFUSED rather
 * than read as unset, and a store that cannot be reached is a refusal too — never the file, because a profile
 * read from a file that stopped being the authority is the guess this module exists to refuse.
 *
 * ## The retired file
 *
 * `$SLOPWEAVER_HOME/browser.json` was the authority before the store. A read finding no row imports it ONCE; from
 * then on the row is the authority and the file is inert, and `browser profile` says so while it is still there.
 */
import { parseJson } from "../lib/jsonParse.js";
import { isRecord } from "../lib/parsers.js";
import { readStrictFileIfPresent } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import {
  productionSingletonRegisterSeams,
  type SingletonRegisterOperations,
  type SingletonRegisterSeams,
  singletonRegister,
} from "../store/singletonRegister.js";
import { type RealChromeError, RealChromeErrors, STORED_PROFILE_SOURCE } from "./errors.js";

/** The recorded profile as it is stored. */
export interface RecordedProfileDocument {
  /** The directory name Chrome's own index lists, e.g. `Profile 3`. */
  readonly profileDirectory: string;
}

/**
 * Validate one recorded-profile document. Pure.
 *
 * @param value the parsed JSON, or the stored `jsonb`
 * @param source where it came from — the retired file's path or {@link STORED_PROFILE_SOURCE}
 * @returns the document, its directory trimmed, or `PROFILE_REGISTER_MALFORMED`
 */
export function parseRecordedProfileDocument({
  value,
  source,
}: {
  value: unknown;
  source: string;
}): Result<RecordedProfileDocument, RealChromeError> {
  if (!isRecord(value)) {
    return err(RealChromeErrors.profileRegisterMalformed({ detail: "it is not a JSON object", source }));
  }
  const directory = value["profileDirectory"];
  if (typeof directory !== "string" || directory.trim().length === 0) {
    return err(
      RealChromeErrors.profileRegisterMalformed({ detail: "profileDirectory is not a non-empty string", source }),
    );
  }
  return ok({ profileDirectory: directory.trim() });
}

/**
 * Read the retired `browser.json` the one-time import consults.
 *
 * @param path `$SLOPWEAVER_HOME/browser.json`
 * @returns the document, `undefined` when nothing is there, or the typed refusal
 */
export function readRecordedProfileFile({
  path,
}: {
  path: string;
}): Result<RecordedProfileDocument | undefined, RealChromeError> {
  const read = readStrictFileIfPresent({ operation: "read the retired recorded Chrome profile", path });
  if (read.isErr()) {
    return err(
      RealChromeErrors.profileRegisterMalformed({
        detail: `it could not be read (${read.error.message})`,
        source: path,
      }),
    );
  }
  if (read.value === null) {
    return ok(undefined);
  }
  const value = parseJson({ text: read.value });
  if (value.isErr()) {
    return err(RealChromeErrors.profileRegisterMalformed({ detail: value.error.message, source: path }));
  }
  return parseRecordedProfileDocument({ source: path, value: value.value });
}

/** The recorded profile as it stands, with what a writer pins to and what a reader must be told. */
export interface RecordedProfileSnapshot {
  /** The recorded directory; undefined when the store holds no row and there was no file to import. */
  readonly directory: string | undefined;
  /** The revision a writer pins to; null when no row exists yet. */
  readonly revision: number | null;
  /** The retired `browser.json` when it still sits beside an authoritative row, read by nothing. */
  readonly inertFile: string | undefined;
}

/** The one door every reader and writer of the recorded profile goes through. */
export interface RecordedProfilePort {
  readonly read: (request: { readonly home: string }) => Promise<Result<RecordedProfileSnapshot, RealChromeError>>;
  /** Record a directory, pinned to the revision the writer read; a conflict is never retried. */
  readonly record: (request: {
    readonly directory: string;
    readonly expectedRevision: number | null;
    readonly home: string;
  }) => Promise<Result<RecordedProfileSnapshot, RealChromeError>>;
}

/** A state home and the door its recorded profile is read through, as a browser leg is handed them. */
export interface RecordedProfileHome {
  readonly home: string;
  readonly profiles: RecordedProfilePort;
}

/**
 * The recorded directory every browser leg launches Chrome on, or `PROFILE_UNSET` when none is recorded.
 *
 * @param home the state home whose store records it
 * @param profiles the door the recorded profile is read through
 * @returns the directory name, or why there is none to use
 */
export async function readRecordedProfile({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<Result<string, RealChromeError>> {
  const read = await profiles.read({ home });
  if (read.isErr()) {
    return err(read.error);
  }
  if (read.value.directory === undefined) {
    return err(RealChromeErrors.profileUnset());
  }
  return ok(read.value.directory);
}

/**
 * The line a reader prints when the retired file still sits beside an authoritative row. Pure.
 *
 * @param snapshot the recorded profile as read
 * @returns the warning, or `undefined` when there is no inert file to warn about
 */
export function inertProfileFileLine({ snapshot }: { snapshot: RecordedProfileSnapshot }): string | undefined {
  if (snapshot.inertFile === undefined || snapshot.revision === null) {
    return undefined;
  }
  return (
    `${snapshot.inertFile} is retired and read by nothing: the store's row (revision ${String(snapshot.revision)}) ` +
    "is the recorded profile. Change it with `slopweaver browser profile --set <directory>`, then move that file " +
    "out of the home"
  );
}

/** The seams the port is built over. */
export type RecordedProfileSeams = SingletonRegisterSeams<RecordedProfileDocument, RealChromeError>;

/**
 * The register seams every port shares bar the connection: the retired file read and the stored decoder.
 *
 * @returns the import read, decoder and error factories
 */
export function recordedProfileDomainSeams(): Omit<RecordedProfileSeams, "connect"> {
  return {
    decodeStored: ({ value }) => parseRecordedProfileDocument({ source: STORED_PROFILE_SOURCE, value }),
    errors: {
      revisionConflict: RealChromeErrors.profileRevisionConflict,
      storeUnavailable: RealChromeErrors.profileStoreUnavailable,
    },
    readImport: ({ home }) => readRecordedProfileFile({ path: stateHomePaths({ home }).browserJson }),
  };
}

/** The retired file's path when it is still in the home — present at all, readable or not. */
function inertFileOf({ home }: { home: string }): string | undefined {
  const path = stateHomePaths({ home }).browserJson;
  const read = readStrictFileIfPresent({ operation: "check for the retired recorded Chrome profile", path });
  if (read.isOk() && read.value === null) {
    return undefined;
  }
  return path;
}

/**
 * The port over whichever register operations it is handed — production's or a unit test's in-memory ones.
 *
 * @param register the register's read and compare-and-set
 * @returns the port
 */
export function recordedProfilePortOver({
  register,
}: {
  register: SingletonRegisterOperations<RecordedProfileDocument, RealChromeError>;
}): RecordedProfilePort {
  const snapshotOf = ({
    document,
    home,
    revision,
  }: {
    document: RecordedProfileDocument | undefined;
    home: string;
    revision: number | null;
  }): RecordedProfileSnapshot => ({
    directory: document === undefined ? undefined : document.profileDirectory,
    inertFile: revision === null ? undefined : inertFileOf({ home }),
    revision,
  });
  return {
    read: async ({ home }) => {
      const read = await register.read({ home });
      if (read.isErr()) {
        return err(read.error);
      }
      return ok(snapshotOf({ document: read.value.document, home, revision: read.value.revision }));
    },
    record: async ({ directory, expectedRevision, home }) => {
      const written = await register.compareAndSet({
        document: { profileDirectory: directory },
        expectedRevision,
        home,
      });
      if (written.isErr()) {
        return err(written.error);
      }
      return ok(snapshotOf({ document: written.value.document, home, revision: written.value.revision }));
    },
  };
}

/**
 * The port the recorded profile is reached through: the store. Only composition roots call this.
 *
 * @returns the port every production reader and writer uses
 */
export function recordedProfilePort(): RecordedProfilePort {
  return recordedProfilePortOver({
    register: singletonRegister({
      seams: productionSingletonRegisterSeams({ ...recordedProfileDomainSeams(), id: "browser-profile" }),
    }),
  });
}
