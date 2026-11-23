/**
 * The file half both kind-answer stores share (`./noteMutes.ts`, `./escalationHolds.ts`): one owner-only JSON record
 * per key in one directory under `hand-steps/`, written atomically, listed and parsed with every failure named.
 * Each store owns its record's shape and its own refusals; {@link kindAnswerStore} owns only the bytes.
 */
import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { isHandStepId } from "../hand/step.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import { type KindAnswerStoreError, MonitorErrors } from "./errors.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const SUFFIX = ".json";

/** Every record one store read whole, the keys whose files would not, and why each would not. */
export interface KindAnswerRead<T> {
  readonly records: readonly T[];
  /** The key of every `<key>.json` that would not read — a reader holds each one down, unknown. */
  readonly unreadable: readonly string[];
  readonly problems: readonly KindAnswerStoreError[];
}

/** One store's record parser: the object its file held, checked into the store's own shape. */
type KindAnswerParse<T> = (options: {
  object: Record<string, unknown>;
  key: string;
  path: string;
}) => Result<T, KindAnswerStoreError>;

/** One kind-answer store, bound to its directory under `hand-steps/`. Every key is a validated slug. */
export interface KindAnswerStore<T> {
  /** `$home/hand-steps/<name>`. */
  readonly dir: (options: { home: string }) => string;
  /** Write one record, replacing any earlier one under its key. */
  readonly record: (options: { home: string; key: string; value: T }) => Result<void, KindAnswerStoreError>;
  /** Whether a key's record file stands, read or not — the fail-closed question every suppression asks. */
  readonly stands: (options: { home: string; key: string }) => boolean;
  /** Remove one key's record: whether one was there, and removing an absent one is no failure. */
  readonly forget: (options: { home: string; key: string }) => Result<boolean, KindAnswerStoreError>;
  /** Every record, sorted by key. An absent directory is none; one that will not list is one problem naming it. */
  readonly read: (options: { home: string }) => KindAnswerRead<T>;
}

/**
 * Bind one kind-answer store.
 *
 * @param name the store's directory name under `hand-steps/`
 * @param label what a record is, named in a serialisation or parse failure
 * @param parse the store's own record check, refusing a malformed object with its path
 * @returns the store
 */
export function kindAnswerStore<T>({
  name,
  label,
  parse,
}: {
  name: string;
  label: string;
  parse: KindAnswerParse<T>;
}): KindAnswerStore<T> {
  const dir = ({ home }: { home: string }): string => join(stateHomePaths({ home }).handSteps, name);
  const path = ({ home, key }: { home: string; key: string }): string => join(dir({ home }), `${key}${SUFFIX}`);
  return {
    dir,
    forget: ({ home, key }) => removeRecord({ path: path({ home, key }) }),
    read: ({ home }) => readRecords({ dir: dir({ home }), label, parse }),
    record: ({ home, key, value }) => writeRecord({ label, path: path({ home, key }), value }),
    stands: ({ home, key }) => entryStands({ path: path({ home, key }) }),
  };
}

/**
 * Whether ANY directory entry stands at a record path — `lstat`, not `existsSync`, so a dangling symlink, which the
 * list names as unreadable, also keeps its note down and reads as removed when `forget` takes it. A path that cannot
 * even be asked about (a parent it cannot search) stands too, fail closed, and never throws: `forget`'s own remove
 * then names the refusal.
 */
function entryStands({ path }: { path: string }): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch (error) {
    // A path that cannot NAME an entry — too long, a component that is no directory, a symlink loop — holds no record:
    // the store's own write to it fails the same way, so nothing was ever recorded there and nothing stands.
    const unnameable = error instanceof Error && "code" in error && UNNAMEABLE_PATH_CODES.has(String(error.code));
    return !unnameable;
  }
}

/** The `lstat` refusals that prove a path names nothing, rather than that its entry could not be asked about. */
const UNNAMEABLE_PATH_CODES: ReadonlySet<string> = new Set(["ELOOP", "ENAMETOOLONG", "ENOTDIR"]);

/** Write one record atomically, owner-only. */
function writeRecord({
  path,
  label,
  value,
}: {
  path: string;
  label: string;
  value: unknown;
}): Result<void, KindAnswerStoreError> {
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    writeFileAtomic({
      contents: `${safeJsonStringify({ label, value })}\n`,
      dirMode: DIR_MODE,
      fileMode: FILE_MODE,
      path,
    });
    return ok(undefined);
  } catch (error: unknown) {
    return err(MonitorErrors.kindAnswerStore({ cause: errorMessage({ error }), path }));
  }
}

/**
 * Remove one record, saying whether it stood. Recursive because `stands` counts ANY entry at the path — a directory
 * there keeps the note down too, and is listed as unreadable, so the remove the list prints must be able to take it.
 */
function removeRecord({ path }: { path: string }): Result<boolean, KindAnswerStoreError> {
  const stood = entryStands({ path });
  try {
    rmSync(path, { force: true, recursive: true });
    return ok(stood);
  } catch (error: unknown) {
    return err(MonitorErrors.kindAnswerStore({ cause: errorMessage({ error }), path }));
  }
}

/**
 * Read one record file as an object, the store then checking its fields. Only a REGULAR file is read: a FIFO at the
 * path would block the read forever, so anything else is refused unread and listed like a torn record.
 */
function readObject({
  path,
  label,
}: {
  path: string;
  label: string;
}): Result<Record<string, unknown>, KindAnswerStoreError> {
  let parsed: unknown;
  try {
    if (!statSync(path).isFile()) {
      return err(MonitorErrors.kindAnswerStore({ cause: "the record is no regular file", path }));
    }
    parsed = safeJsonParse({ label, text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    return err(MonitorErrors.kindAnswerStore({ cause: errorMessage({ error }), path }));
  }
  if (!isRecord(parsed)) {
    return err(MonitorErrors.kindAnswerStore({ cause: "the record is not an object", path }));
  }
  return ok(parsed);
}

/** Every record in one directory, each read through the store's own parser. */
function readRecords<T>({
  dir,
  label,
  parse,
}: {
  dir: string;
  label: string;
  parse: KindAnswerParse<T>;
}): KindAnswerRead<T> {
  let names: string[];
  try {
    names = readdirSync(dir);
    // A directory that lists but cannot be SEARCHED reads empty here while every lookup under it fails closed, so a
    // suppression would stand unlisted: the missing search right is a failure, named like any other.
    accessSync(dir, fsConstants.X_OK);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { problems: [], records: [], unreadable: [] };
    }
    return {
      problems: [MonitorErrors.kindAnswerStore({ cause: errorMessage({ error }), path: dir })],
      records: [],
      unreadable: [],
    };
  }
  const records: T[] = [];
  const problems: KindAnswerStoreError[] = [];
  const unreadable: string[] = [];
  // Case-insensitively, as macOS's own volume answers `stands`: a `<key>.JSON` keeps its note down there, so it is listed.
  for (const name of names.filter((entry) => entry.toLowerCase().endsWith(SUFFIX)).toSorted()) {
    // Lower-cased too: every key a verb accepts is lower-case, and on that volume it names this same entry.
    const key = name.slice(0, -SUFFIX.length).toLowerCase();
    // A key no verb accepts is no record's: every lookup goes by a valid kind or subject, so it keeps nothing down,
    // and listing it would print a remove the verb refuses.
    if (!isHandStepId({ id: key })) {
      continue;
    }
    const path = join(dir, name);
    const read = readObject({ label, path }).andThen((object) => parse({ key, object, path }));
    if (read.isErr()) {
      problems.push(read.error);
      unreadable.push(key);
      continue;
    }
    records.push(read.value);
  }
  return { problems, records, unreadable };
}
