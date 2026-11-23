/**
 * The identity roster's STRICT decoder — every document `./identityRoster.ts` accepts (the one-time import, a
 * replacement, the stored row) passes through here first.
 *
 * ## Strict, where the file was permissive
 *
 * The retired file's parser skipped anything malformed and read an unparseable file as an empty roster. As the
 * authority that would turn a typo into "nobody is known" on every Slack and Linear address, so every document is
 * decoded STRICTLY: an unknown key, a malformed entry, nested identity or `heardAs` spelling is a refusal that names
 * it by index, never a value. That also keeps anything but the roster's own fields out of the store: an unknown
 * key cannot ride in.
 */
import { parseJson } from "../lib/jsonParse.js";
import { isRecord } from "../lib/parsers.js";
import { readStrictFileIfPresent } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { IDENTITY_SOURCES, type IdentityRecord, type PersonIdentity } from "./identity.js";
import {
  type IdentityRosterError,
  IdentityRosterErrors,
  type IdentityRosterMalformedError,
} from "./identityRosterErrors.js";
import { normaliseHandle } from "./personLookup.js";

/** The keys a roster entry may carry. */
const RECORD_KEYS = new Set(["id", "handle", "name", "email", "identities", "heardAs"]);
/** The keys one nested identity may carry. */
const IDENTITY_KEYS = new Set(["source", "nativeId", "handle", "name", "email"]);

/** An optional field: absent, else a non-empty string. */
function optionalText({
  entry,
  key,
  problems,
  where,
}: {
  entry: Record<string, unknown>;
  key: string;
  problems: string[];
  where: string;
}): string | undefined {
  const value = entry[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    problems.push(`${where}.${key} is not a non-empty string`);
    return undefined;
  }
  return value;
}

/**
 * How many keys of an object fall outside the allowed set, as ONE problem. The key itself is never named: a
 * field name is as able as a value to carry something that must not be echoed into a terminal or a log.
 */
function unknownKeys({
  allowed,
  entry,
  problems,
  where,
}: {
  allowed: ReadonlySet<string>;
  entry: Record<string, unknown>;
  problems: string[];
  where: string;
}): void {
  const unknown = Object.keys(entry).filter((key) => !allowed.has(key)).length;
  if (unknown > 0) {
    problems.push(
      `${where} carries ${String(unknown)} key(s) the roster does not hold (allowed: ${[...allowed].join(", ")})`,
    );
  }
}

/** One nested identity, strictly. */
function decodeIdentity({
  entry,
  problems,
  where,
}: {
  entry: unknown;
  problems: string[];
  where: string;
}): PersonIdentity | undefined {
  if (!isRecord(entry)) {
    problems.push(`${where} is not an object`);
    return undefined;
  }
  unknownKeys({ allowed: IDENTITY_KEYS, entry, problems, where });
  const source = entry["source"];
  const nativeId = entry["nativeId"];
  const knownSource = IDENTITY_SOURCES.find((candidate) => candidate === source);
  if (knownSource === undefined) {
    problems.push(`${where}.source is not one of ${IDENTITY_SOURCES.join(", ")}`);
  }
  if (typeof nativeId !== "string" || nativeId.length === 0) {
    problems.push(`${where}.nativeId is not a non-empty string`);
  }
  const handle = optionalText({ entry, key: "handle", problems, where });
  const name = optionalText({ entry, key: "name", problems, where });
  const email = optionalText({ entry, key: "email", problems, where });
  if (knownSource === undefined || typeof nativeId !== "string" || nativeId.length === 0) {
    return undefined;
  }
  return {
    nativeId,
    source: knownSource,
    ...(handle === undefined ? {} : { handle }),
    ...(name === undefined ? {} : { name }),
    ...(email === undefined ? {} : { email }),
  };
}

/** A record's `identities`, strictly; an empty list when absent. */
function decodeIdentities({
  entry,
  problems,
  where,
}: {
  entry: Record<string, unknown>;
  problems: string[];
  where: string;
}): readonly PersonIdentity[] {
  const raw = entry["identities"];
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    problems.push(`${where}.identities is not an array`);
    return [];
  }
  return raw.flatMap((identity: unknown, index) => {
    const decoded = decodeIdentity({ entry: identity, problems, where: `${where}.identities[${String(index)}]` });
    return decoded === undefined ? [] : [decoded];
  });
}

/** A record's `heardAs`, strictly; an empty list when absent. */
function decodeHeardAs({
  entry,
  problems,
  where,
}: {
  entry: Record<string, unknown>;
  problems: string[];
  where: string;
}): readonly string[] {
  const raw = entry["heardAs"];
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    problems.push(`${where}.heardAs is not an array`);
    return [];
  }
  return raw.flatMap((spelling: unknown, index) => {
    if (typeof spelling !== "string" || normaliseHandle({ handle: spelling.trim() }).length === 0) {
      problems.push(`${where}.heardAs[${String(index)}] is not a spelling with a letter or digit in it`);
      return [];
    }
    return [spelling];
  });
}

/** The file's documented defaults, as branches: an absent `handle` is the `id`, an absent `name` the handle. */
function defaultedNames({
  handleField,
  id,
  nameField,
}: {
  handleField: string | undefined;
  id: string;
  nameField: string | undefined;
}): { readonly handle: string; readonly name: string } {
  let handle = id;
  if (handleField !== undefined) {
    handle = handleField;
  }
  if (nameField !== undefined) {
    return { handle, name: nameField };
  }
  return { handle, name: handle };
}

/** One roster entry, strictly, with the file's defaults: `handle` falls back to `id`, `name` to `handle`. */
function decodeRecord({
  entry,
  problems,
  where,
}: {
  entry: unknown;
  problems: string[];
  where: string;
}): IdentityRecord | undefined {
  if (!isRecord(entry)) {
    problems.push(`${where} is not an object`);
    return undefined;
  }
  unknownKeys({ allowed: RECORD_KEYS, entry, problems, where });
  const id = entry["id"];
  if (typeof id !== "string" || id.length === 0) {
    problems.push(`${where}.id is not a non-empty string`);
  }
  const handleField = optionalText({ entry, key: "handle", problems, where });
  const nameField = optionalText({ entry, key: "name", problems, where });
  const email = optionalText({ entry, key: "email", problems, where });
  const identities = decodeIdentities({ entry, problems, where });
  const heardAs = decodeHeardAs({ entry, problems, where });
  if (typeof id !== "string" || id.length === 0) {
    return undefined;
  }
  const { handle, name } = defaultedNames({ handleField, id, nameField });
  return {
    handle,
    id,
    name,
    ...(email === undefined ? {} : { email }),
    ...(identities.length > 0 ? { identities } : {}),
    ...(heardAs.length > 0 ? { heardAs } : {}),
  };
}

/**
 * Decode one roster document strictly: a JSON array of entries, every one of them whole. Pure.
 *
 * @param value the parsed JSON, or the stored `jsonb`
 * @param source where it came from — a path, or `STORED_ROSTER_SOURCE`
 * @returns the records in their order, or `IDENTITY_ROSTER_MALFORMED` listing every problem
 */
export function decodeIdentityRoster({
  source,
  value,
}: {
  source: string;
  value: unknown;
}): Result<readonly IdentityRecord[], IdentityRosterMalformedError> {
  if (!Array.isArray(value)) {
    return err(IdentityRosterErrors.malformed({ problems: ["it is not a JSON array"], source }));
  }
  const problems: string[] = [];
  const records = value.flatMap((entry: unknown, index) => {
    const decoded = decodeRecord({ entry, problems, where: `entry ${String(index)}` });
    return decoded === undefined ? [] : [decoded];
  });
  if (problems.length > 0) {
    return err(IdentityRosterErrors.malformed({ problems, source }));
  }
  return ok(records);
}

/**
 * Read and decode one roster file — the retired `identity.json`, or a replacement a writer hands in.
 *
 * @param path the file
 * @param operation what the read is for, finishing "could not …"
 * @returns the records, `undefined` when nothing is there, or the typed refusal
 */
export function readIdentityRosterFile({
  operation,
  path,
}: {
  operation: string;
  path: string;
}): Result<readonly IdentityRecord[] | undefined, IdentityRosterError> {
  const read = readStrictFileIfPresent({ operation, path });
  if (read.isErr()) {
    return err(
      IdentityRosterErrors.malformed({ problems: [`it could not be read (${read.error.message})`], source: path }),
    );
  }
  if (read.value === null) {
    return ok(undefined);
  }
  const value = parseJson({ text: read.value });
  if (value.isErr()) {
    return err(IdentityRosterErrors.malformed({ problems: [value.error.message], source: path }));
  }
  return decodeIdentityRoster({ source: path, value: value.value });
}
