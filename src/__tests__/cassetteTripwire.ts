/**
 * The cassette safety net — mechanical redaction gates so nobody hand-audits a recording.
 *
 * `isProvablySafe` is the CI-facing predicate (needs NO local secret): a committed response-body string is
 * safe only if it is a recognised placeholder, a synthetic `id_N` or `cursor_N`, a timestamp, a numeric string, a
 * blanked-path URL, empty, or a short enum under an allowlisted key — and NEVER an email / UUID / raw
 * workspace id, even under an allowlisted key. A walk that finds an unsafe string fails the build, catching
 * any gap in the allowlist redactor without needing the sensitive value list.
 *
 * `assertRecordTimeTripwire` is the RECORD-time gate (has the local secret list): it fails loud the moment a
 * just-redacted body still contains a known-sensitive literal or a hygiene leak class.
 */
import { scanContent } from "../hygiene/scan.js";
import { isRecord } from "../lib/parsers.js";
import { isStructuralObjectKey, PUBLIC_URL_HOSTS } from "./cassetteRedactConfig.js";

const PLACEHOLDER_EXACT: ReadonlySet<string> = new Set(["", "REDACTEDID", "redacted@example.com", "/<home>"]);
/** Hosts a committed url may carry: the public API hosts kept verbatim + the collapsed-workspace sentinel. */
const SAFE_URL_HOSTS: ReadonlySet<string> = new Set([...PUBLIC_URL_HOSTS, "redacted.invalid"]);
const SAFE_URL = /^https?:\/\/([a-z0-9.-]+)\/\[REDACTED\]$/;
const SYNTHETIC_ID = /^id_\d+$/;
// A synthetic paging cursor the redactor minted — `cassetteRedact.ts`'s `isSyntheticCursor`, restated here so
// this predicate keeps needing nothing but its own shapes.
const SYNTHETIC_CURSOR = /^cursor_\d+$/;
// A POSITIONAL uuid placeholder, minted by `cassetteRequestRedact.ts`'s `positionalUuids` — the same class as
// the two above, and unrecognised here until request bodies became committed content and one turned up under
// a Linear follow-up's `after`. Numbered by first appearance within one body, so it re-derives nothing.
const POSITIONAL_UUID = /^<uuid:\d+>$/;

/** Is a string a blanked-path URL whose host is an allowlisted public host (or the workspace sentinel)? Pure. */
function isSafeUrl({ value }: { value: string }): boolean {
  const match = SAFE_URL.exec(value);
  return match !== null && SAFE_URL_HOSTS.has(match[1]!);
}
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const NUMERIC = /^\d+(?:\.\d+)?$/; // a plain integer or a Slack decimal timestamp (epoch.micros)
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAW_WORKSPACE_ID = /^(?=[A-Z0-9]*[0-9])[A-Z][A-Z0-9]{7,}$/; // an un-synthesised Slack/workspace id
const ENUMISH_MAX = 64;

/**
 * Is a committed response-body value provably safe to ship in a PUBLIC cassette? Needs no secret. Non-strings
 * are always safe (numbers/bools/null carry no identifiers). Pure.
 *
 * @param key the JSON key the value sat under (undefined at the root)
 * @param value the leaf value
 * @param allKeepKeys the union of every provider's keepKeys (a short verbatim value under one is allowed)
 * @returns true iff the value is a recognised-safe shape
 */
export function isProvablySafe({
  key,
  value,
  allKeepKeys,
}: {
  key: string | undefined;
  value: unknown;
  allKeepKeys: ReadonlySet<string>;
}): boolean {
  if (typeof value !== "string") {
    return true;
  }
  if (value.startsWith("[REDACTED") || PLACEHOLDER_EXACT.has(value)) {
    return true;
  }
  if (SYNTHETIC_ID.test(value) || SYNTHETIC_CURSOR.test(value) || POSITIONAL_UUID.test(value)) {
    return true;
  }
  if (isSafeUrl({ value })) {
    return true;
  }
  // Explicit unsafe shapes are NEVER safe — even under an allowlisted key (a keepKey unexpectedly holding one).
  if (EMAIL.test(value) || UUID.test(value) || RAW_WORKSPACE_ID.test(value)) {
    return false;
  }
  if (ISO_TS.test(value) || NUMERIC.test(value)) {
    return true;
  }
  const lowerKey = key?.toLowerCase();
  return lowerKey !== undefined && allKeepKeys.has(lowerKey) && !/\s/.test(value) && value.length <= ENUMISH_MAX;
}

/** One unsafe leaf found by {@link findUnsafeValues}: its JSON path, key, and the offending value. */
export interface UnsafeLeaf {
  readonly path: string;
  readonly key: string | undefined;
  readonly value: string;
}

/**
 * Walk a parsed response body and collect every leaf that is NOT {@link isProvablySafe}, plus every object
 * KEY that is not a field name (an identifier can hide in the key position). Pure — the CI tripwire's core
 * (empty ⇒ the cassette is provably clean).
 *
 * @param value the parsed response JSON
 * @param allKeepKeys the union of provider keepKeys
 * @returns every unsafe leaf or key (path/key/value), or `[]`
 */
export function findUnsafeValues({
  value,
  allKeepKeys,
}: {
  value: unknown;
  allKeepKeys: ReadonlySet<string>;
}): readonly UnsafeLeaf[] {
  const hits: UnsafeLeaf[] = [];
  const walk = ({ node, key, path }: { node: unknown; key: string | undefined; path: string }): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, i) => {
        walk({ key, node: entry, path: `${path}[${String(i)}]` });
      });
      return;
    }
    if (isRecord(node)) {
      const record = node;
      for (const objectKey of Object.keys(record)) {
        // A KEY can carry an identifier too (Slack's `shares` map is keyed by channel id), so the key is
        // checked as well as the value — otherwise the redactor's key mapping would have no ratchet.
        if (!isStructuralObjectKey({ key: objectKey })) {
          hits.push({ key: objectKey, path: `${path}.${objectKey}`, value: objectKey });
        }
        walk({ key: objectKey, node: record[objectKey], path: `${path}.${objectKey}` });
      }
      return;
    }
    // `isProvablySafe` returns true for every non-string, so this branch is only ever reached for a string —
    // the `typeof` check states that instead of casting it.
    if (typeof node === "string" && !isProvablySafe({ allKeepKeys, key, value: node })) {
      hits.push({ key, path, value: node });
    }
  };
  walk({ key: undefined, node: value, path: "$" });
  return hits;
}

/**
 * RECORD-time gate: throw if a just-redacted text still contains any known-sensitive literal (the local
 * pre-seeded list) or a generic hygiene leak class. Fails fast the moment a recording carries something the
 * allowlist did not cover. Never runs in CI (no local list there).
 *
 * @param text the redacted body (or whole cassette text)
 * @param knownValues the local known-sensitive literals
 * @param denylist the hygiene denylist substrings (also local)
 * @throws if any known value or leak class survived
 */
export function assertRecordTimeTripwire({
  text,
  knownValues,
  denylist,
}: {
  text: string;
  knownValues: readonly string[];
  denylist: readonly string[];
}): void {
  const lower = text.toLowerCase();
  const survivor = [...knownValues, ...denylist].find((v) => v.length > 0 && lower.includes(v.toLowerCase()));
  if (survivor !== undefined) {
    throw new Error(`cassette tripwire: a known-sensitive value survived redaction: "${survivor}"`);
  }
  const hits = scanContent({ content: text, denylist, path: "<cassette>" });
  if (hits.length > 0) {
    throw new Error(`cassette tripwire: hygiene leak class in a recording: [${hits[0]!.label}] ${hits[0]!.excerpt}`);
  }
}
