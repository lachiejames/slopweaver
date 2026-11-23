/**
 * Which sessions have already been shown the once-per-session stale-seat notice (`./staleSeatEffects.ts`), held as
 * the `stale-seat-notices` row of the store's `singleton_register` (`src/store/singletonRegister.ts`).
 *
 * The document is `{ "schemaVersion": 1, "noticedSessions": ["<session id>", ...] }`, OLDEST FIRST, and every
 * write keeps only the newest {@link MAX_TRACKED_SESSIONS} — the bound is the writer's, so a longer list read back
 * is still read, and the next write trims it. A LIST rather than the session-keyed object the retired file held, because the
 * store's `jsonb` does not keep object keys in insertion order — it sorts them — and the eviction of the oldest
 * session is exactly an order. A stored document that is not that shape — another `schemaVersion`, a missing or
non-list `noticedSessions`, an entry that is not a session id — is refused rather than read as empty. A field no
version declares is tolerated, as `src/plans/storePort.ts`'s register tolerates one: `schemaVersion` is the shape
contract, and a strict decoder would make every seat behind the trunk refuse a row a newer seat wrote.
 *
 * ## Why this module never imports the store
 *
 * It is on `main.ts`'s load path, ahead of every verb. The register and its client live in
 * `./staleSeatNoticesStore.ts`, which {@link staleSeatNoticesPort} imports only on the first read or write — the
 * once-per-session cadence, when a seat is behind — so a current seat never loads a database driver to run a verb.
 *
 * ## The retired file
 *
 * `$SLOPWEAVER_HOME/stale-seat-notices.json` was the marker before the store, written in `./skillReminder.ts`'s
 * session-keyed shape. A read finding no row imports it ONCE, keeping each session that was shown the notice in the
 * file's own order; from then on the row is the marker and the file is read by nothing.
 */

import { errorMessage } from "../lib/errorMessage.js";
import { parseJson } from "../lib/jsonParse.js";
import { isRecord } from "../lib/parsers.js";
import { readStrictFileIfPresent } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import type { SingletonRegisterSeams } from "../store/singletonRegister.js";
import { MAX_TRACKED_SESSIONS } from "./skillReminder.js";

/** The key the retired file recorded a stale-seat notice under, per session. */
const RETIRED_NOTICE_KEY = "stale-seat";

/** The retired marker file could not be read at all. */
export interface StaleSeatNoticesUnreadableError {
  readonly code: "STALE_SEAT_NOTICES_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A notices document — the retired file or the store's row — is not the declared shape. */
export interface StaleSeatNoticesMalformedError {
  readonly code: "STALE_SEAT_NOTICES_MALFORMED";
  readonly message: string;
  /** Where the document came from: the retired file's path, or the store's row. */
  readonly source: string;
}

/** The store holding the notices could not be selected, reached or queried. Nothing was read or written. */
export interface StaleSeatNoticesStoreUnavailableError {
  readonly code: "STALE_SEAT_NOTICES_STORE_UNAVAILABLE";
  readonly message: string;
}

/** Another verb recorded a session between this one's read and its compare-and-set. Nothing was written. */
export interface StaleSeatNoticesRevisionConflictError {
  readonly code: "STALE_SEAT_NOTICES_REVISION_CONFLICT";
  readonly message: string;
  /** The revision this writer read and pinned to; `0` when it expected no row at all. */
  readonly expectedRevision: number;
}

/** Why the noticed sessions could not be read or recorded. */
export type StaleSeatNoticesError =
  | StaleSeatNoticesUnreadableError
  | StaleSeatNoticesMalformedError
  | StaleSeatNoticesStoreUnavailableError
  | StaleSeatNoticesRevisionConflictError;

/** The factory every refusal in this module goes through. */
export const StaleSeatNoticesErrors = {
  malformed: ({ source, detail }: { source: string; detail: string }): StaleSeatNoticesMalformedError => ({
    code: "STALE_SEAT_NOTICES_MALFORMED",
    message: `${source} is not a stale-seat notices document (${detail})`,
    source,
  }),
  revisionConflict: ({ expectedRevision }: { expectedRevision: number }): StaleSeatNoticesRevisionConflictError => ({
    code: "STALE_SEAT_NOTICES_REVISION_CONFLICT",
    expectedRevision,
    message:
      `another verb recorded a stale-seat notice while this one was (read at revision ${String(expectedRevision)}), ` +
      "so nothing was written",
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): StaleSeatNoticesStoreUnavailableError => ({
    code: "STALE_SEAT_NOTICES_STORE_UNAVAILABLE",
    message:
      `this install records which sessions saw the stale-seat notice in the store, and the store could not ${doing} ` +
      `(\`slopweaver store status\` says what it is doing). The store said: ${reason}`,
  }),
  unreadable: ({ path, detail }: { path: string; detail: string }): StaleSeatNoticesUnreadableError => ({
    code: "STALE_SEAT_NOTICES_UNREADABLE",
    message: `${path} could not be read (${detail}); move it out of the home`,
    path,
  }),
} as const;

/** What the store's row is called when it is the source of a refusal. */
const STORED_NOTICES_SOURCE = "the store's stale-seat-notices row";

/** The noticed sessions as stored. */
export interface StaleSeatNoticesDocument {
  /** Every session already shown the notice, oldest first. */
  readonly noticedSessions: readonly string[];
  readonly schemaVersion: 1;
}

/**
 * Validate one stored notices document. Pure.
 *
 * @param value the stored `jsonb`
 * @returns the document, or `STALE_SEAT_NOTICES_MALFORMED` naming the row
 */
export function parseStaleSeatNoticesDocument({
  value,
}: {
  value: unknown;
}): Result<StaleSeatNoticesDocument, StaleSeatNoticesMalformedError> {
  if (!isRecord(value) || value["schemaVersion"] !== 1) {
    return err(
      StaleSeatNoticesErrors.malformed({ detail: "it is not a schemaVersion 1 object", source: STORED_NOTICES_SOURCE }),
    );
  }
  const listed: unknown = value["noticedSessions"];
  const sessions: readonly unknown[] = Array.isArray(listed) ? listed : [];
  const ids = sessions.filter((id): id is string => typeof id === "string" && id.length > 0);
  if (!Array.isArray(listed) || ids.length !== sessions.length) {
    return err(
      StaleSeatNoticesErrors.malformed({
        detail: "noticedSessions is not a list of session ids",
        source: STORED_NOTICES_SOURCE,
      }),
    );
  }
  return ok({ noticedSessions: ids, schemaVersion: 1 });
}

/**
 * Read the retired marker the one-time import consults, keeping each session shown the notice, in the file's order.
 *
 * @param path `$SLOPWEAVER_HOME/stale-seat-notices.json`
 * @returns the document, `undefined` when nothing is there, or the typed refusal
 */
export function readStaleSeatNoticesFile({
  path,
}: {
  path: string;
}): Result<StaleSeatNoticesDocument | undefined, StaleSeatNoticesError> {
  const read = readStrictFileIfPresent({ operation: "read the retired stale-seat notices", path });
  if (read.isErr()) {
    return err(StaleSeatNoticesErrors.unreadable({ detail: read.error.message, path }));
  }
  if (read.value === null) {
    return ok(undefined);
  }
  const value = parseJson({ text: read.value });
  if (value.isErr()) {
    return err(StaleSeatNoticesErrors.malformed({ detail: value.error.message, source: path }));
  }
  if (!isRecord(value.value)) {
    return err(StaleSeatNoticesErrors.malformed({ detail: "it is not a JSON object", source: path }));
  }
  const noticed: string[] = [];
  for (const [sessionId, keys] of Object.entries(value.value)) {
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) {
      return err(
        StaleSeatNoticesErrors.malformed({ detail: `session ${sessionId} does not hold a key list`, source: path }),
      );
    }
    if (keys.includes(RETIRED_NOTICE_KEY)) {
      noticed.push(sessionId);
    }
  }
  return ok({ noticedSessions: noticed.slice(-MAX_TRACKED_SESSIONS), schemaVersion: 1 });
}

/**
 * The document with one more session noticed, evicting the oldest past {@link MAX_TRACKED_SESSIONS}. Pure.
 *
 * @param noticedSessions the sessions already noticed, oldest first
 * @param sessionId the session just shown the notice
 * @returns the next document
 */
export function withNoticedSession({
  noticedSessions,
  sessionId,
}: {
  noticedSessions: readonly string[];
  sessionId: string;
}): StaleSeatNoticesDocument {
  return { noticedSessions: [...noticedSessions, sessionId].slice(-MAX_TRACKED_SESSIONS), schemaVersion: 1 };
}

/** The noticed sessions as they stand, with the revision a writer pins to. */
export interface StaleSeatNoticesSnapshot {
  /** Every session already shown the notice, oldest first; none when no row exists and there was no file. */
  readonly noticedSessions: readonly string[];
  /** The revision a writer pins to; null when no row exists yet. */
  readonly revision: number | null;
}

/** The one door every reader and writer of the noticed sessions goes through. */
export interface StaleSeatNoticesPort {
  readonly read: (request: {
    readonly home: string;
  }) => Promise<Result<StaleSeatNoticesSnapshot, StaleSeatNoticesError>>;
  /** Replace the document, pinned to the revision the writer read; a conflict is never retried. */
  readonly replace: (request: {
    readonly document: StaleSeatNoticesDocument;
    readonly expectedRevision: number | null;
    readonly home: string;
  }) => Promise<Result<StaleSeatNoticesSnapshot, StaleSeatNoticesError>>;
}

/** The seams the port is built over. */
export type StaleSeatNoticesSeams = SingletonRegisterSeams<StaleSeatNoticesDocument, StaleSeatNoticesError>;

/**
 * The register seams every port shares bar the connection: the retired file read and the stored decoder.
 *
 * @returns the import read, decoder and error factories
 */
export function staleSeatNoticesDomainSeams(): Omit<StaleSeatNoticesSeams, "connect"> {
  return {
    decodeStored: parseStaleSeatNoticesDocument,
    errors: {
      revisionConflict: StaleSeatNoticesErrors.revisionConflict,
      storeUnavailable: StaleSeatNoticesErrors.storeUnavailable,
    },
    readImport: ({ home }) => readStaleSeatNoticesFile({ path: stateHomePaths({ home }).staleSeatNoticesJson }),
  };
}

/** The production loader: the store half of this port, imported on first use. */
async function loadStoreNoticesPort(): Promise<StaleSeatNoticesPort> {
  const module = await import("./staleSeatNoticesStore.js");
  return module.productionStaleSeatNoticesPort();
}

/**
 * The port the noticed sessions are reached through: the store, its module loaded on the first read or write rather
 * than on `main.ts`'s load path. Only composition roots call this.
 *
 * It never REJECTS. The advisory it serves runs ahead of every verb, so a module that fails to load or an operation
 * that throws is answered as `STALE_SEAT_NOTICES_STORE_UNAVAILABLE` rather than escaping into `main.ts` and taking
 * the verb down with it.
 *
 * @param load where the store half comes from — the lazy import in production, a plain function in a test
 * @returns the port every production reader and writer uses
 */
export function staleSeatNoticesPort({
  load = loadStoreNoticesPort,
}: { load?: () => Promise<StaleSeatNoticesPort> } = {}): StaleSeatNoticesPort {
  let loaded: Promise<StaleSeatNoticesPort> | undefined;
  // The store module loads once, on the first operation; every later one awaits the same promise.
  const loadOnce = (): Promise<StaleSeatNoticesPort> => {
    if (loaded !== undefined) {
      return loaded;
    }
    const started = load();
    loaded = started;
    return started;
  };
  const settled = async <T>({
    doing,
    operation,
  }: {
    doing: string;
    operation: (port: StaleSeatNoticesPort) => Promise<Result<T, StaleSeatNoticesError>>;
  }): Promise<Result<T, StaleSeatNoticesError>> => {
    try {
      return await operation(await loadOnce());
    } catch (cause) {
      return err(StaleSeatNoticesErrors.storeUnavailable({ doing, reason: errorMessage({ error: cause }) }));
    }
  };
  return {
    read: (request) => settled({ doing: "be read", operation: (port) => port.read(request) }),
    replace: (request) => settled({ doing: "be written", operation: (port) => port.replace(request) }),
  };
}
