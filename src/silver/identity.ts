/**
 * Minimal who-is-who map used by derive to rewrite opaque handles (e.g. a Slack `@U0SYN…` id) into a
 * readable `@handle` in opportunity subjects. For GitHub-only v0.1 authors are already human handles, so
 * the map is empty by default and `resolveHandle` is a pass-through — but the seam exists so richer
 * connectors can populate it later.
 *
 * The roster is NEVER committed: the human roster lives in the store (`./identityRoster.ts`), and a real
 * `identities.json` (if any) is generated into `$SLOPWEAVER_HOME`, off-repo.
 */
import { absentAs } from "#lib/absent.js";
import type { CorpusSource } from "../corpus/types.js";
import { IDENTITY_SOURCES } from "../integrations/corpusSources.js";
import { parseJson } from "../lib/jsonParse.js";
import { isOneOf, isRecord } from "../lib/parsers.js";
import { normaliseHandle } from "./personLookup.js";

/** A source a {@link Person} can own an identity in — every corpus source except the synthetic `gold`. */
export type IdentitySource = Exclude<CorpusSource, "gold">;

// The sources a roster entry's `source` may name: narrower than `IdentitySource`, and derived from the integration
// manifests that say `identityRoster` rather than kept here. Re-exported because its readers import it beside the type.
export { IDENTITY_SOURCES };

/**
 * One source-native identity a {@link Person} owns: which source, its native id (a login or user id — the
 * opaque key that source issues for a human), and any display fields. `nativeId` is the join key WITHIN a
 * source; the cross-source link is the resolver's job.
 *
 * A display NAME is never a `nativeId`, however convenient: a name is owned by more than one human, so a
 * name-keyed identity is a path by which two people collapse into one. `name` below is the display field for
 * exactly that reason. The shape is checked rather than trusted — see `isNativeIdShaped`.
 */
export interface PersonIdentity {
  readonly source: IdentitySource;
  readonly nativeId: string;
  readonly handle?: string;
  readonly name?: string;
  readonly email?: string;
}

/**
 * How a Person's identities were linked, STRONGEST first: `override` (the human roster — always wins),
 * `email` (a shared trusted email), `handle` (an unambiguous shared handle), `name` (a name-only match —
 * HELD, never auto-applied), `single-source` (one identity, no cross-source link).
 */
export type IdentityConfidence = "override" | "email" | "handle" | "name" | "single-source";

/** A canonical person: a stable id owning a set of per-source identities, plus how they were linked. */
export interface Person {
  readonly id: string;
  readonly displayName: string;
  readonly identities: readonly PersonIdentity[];
  readonly confidence: IdentityConfidence;
  readonly provenance: readonly string[];
}

/**
 * A low-confidence name-only link that is HELD, not applied — the canonical people it WOULD merge and the
 * reason. Surfaced (not silently merged) so a human can promote it into the roster if it's real (D8).
 */
export interface IdentityLinkCandidate {
  readonly personIds: readonly string[];
  readonly reason: string;
  readonly confidence: "name";
}

/**
 * The full cross-source resolution: the canonical people, the HELD name candidates, any roster conflicts,
 * and a lookup index. `index` maps `<source>\u0000<nativeId>` → canonical person id, but ONLY for people
 * that carry an APPLIED cross-source link (override/email/handle) — a single-source id is absent, so the
 * directory leaves it as its raw id (behaviour-preserving when nothing links).
 */
export interface IdentityResolution {
  readonly people: readonly Person[];
  readonly candidates: readonly IdentityLinkCandidate[];
  readonly conflicts: readonly string[];
  readonly index: ReadonlyMap<string, string>;
}

/**
 * A roster entry. `id`/`handle`/`name` keep the original within-source display contract (so `resolveHandle`
 * is unchanged); the OPTIONAL `email` + `identities` are the PR4 cross-source override — the human seed that
 * pins per-source ids to one Person and always wins over an inferred link.
 */
export interface IdentityRecord {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly email?: string;
  readonly identities?: readonly PersonIdentity[];
  /**
   * What the owner's voice-to-text makes of this person's name ("Smitty" and "Smythe" for John Smith), declared
   * by the owner per install. Consulted only after the exact member ladder names nobody (`./heardAs.ts`), so it
   * never displaces a colleague who really carries the token.
   */
  readonly heardAs?: readonly string[];
}

export type IdentityMap = ReadonlyMap<string, IdentityRecord>;

/**
 * Index identity records by `id` (later entries win on duplicate ids).
 *
 * @param records the identity records
 * @returns a map from id to record
 */
export function buildIdentityMap({ records }: { records: readonly IdentityRecord[] }): IdentityMap {
  return new Map(records.map((record) => [record.id, record]));
}

/** A non-empty string field off a raw object, else `undefined`. */
function optField({ entry, key }: { entry: Record<string, unknown>; key: string }): string | undefined {
  const value = entry[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parse one `identities[]` element into a {@link PersonIdentity}: needs a known `source` and a non-empty
 * `nativeId`; `handle`/`name`/`email` are optional. Pure — a malformed entry yields `undefined` (skipped).
 *
 * @param entry one raw identity element
 * @returns the person identity, or `undefined` when invalid
 */
export function parsePersonIdentity({ entry }: { entry: unknown }): PersonIdentity | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  const source = entry["source"];
  const nativeId = entry["nativeId"];
  if (
    typeof source !== "string" ||
    !isOneOf(source, IDENTITY_SOURCES) ||
    typeof nativeId !== "string" ||
    nativeId.length === 0
  ) {
    return undefined;
  }
  const handle = optField({ entry, key: "handle" });
  const name = optField({ entry, key: "name" });
  const email = optField({ entry, key: "email" });
  return {
    nativeId,
    source,
    ...(handle !== undefined ? { handle } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(email !== undefined ? { email } : {}),
  };
}

/**
 * Parse one identity-array entry: a valid entry needs a non-empty string `id`; `handle`/`name` default to
 * `id`/`handle` when absent. The optional `email` + `identities` (cross-source override) are parsed too;
 * a malformed `identities` element is dropped, never the whole entry. Pure — a malformed entry yields
 * `undefined` (the caller skips it).
 *
 * @param entry one raw array element
 * @returns the identity record, or `undefined` when invalid
 */
function parseIdentityEntry({ entry }: { entry: unknown }): IdentityRecord | undefined {
  if (!isRecord(entry) || typeof entry["id"] !== "string" || entry["id"].length === 0) {
    return undefined;
  }
  const id = entry["id"];
  const handle = absentAs({ value: optField({ entry, key: "handle" }), whenAbsent: id });
  const name = absentAs({ value: optField({ entry, key: "name" }), whenAbsent: handle });
  const email = optField({ entry, key: "email" });
  const rawIdentities = entry["identities"];
  const identities = Array.isArray(rawIdentities)
    ? rawIdentities.map((e) => parsePersonIdentity({ entry: e })).filter((p): p is PersonIdentity => p !== undefined)
    : [];
  const rawHeardAs = entry["heardAs"];
  const heardAs = Array.isArray(rawHeardAs)
    ? rawHeardAs.filter(
        (value): value is string => typeof value === "string" && normaliseHandle({ handle: value.trim() }).length > 0,
      )
    : [];
  return {
    handle,
    id,
    name,
    ...(email !== undefined ? { email } : {}),
    ...(identities.length > 0 ? { identities } : {}),
    ...(heardAs.length > 0 ? { heardAs } : {}),
  };
}

/**
 * Parse a persisted `identities.json` array. Malformed entries are skipped; `handle`/`name` default to
 * `id`/`handle` when absent. Anything unparseable yields an empty list.
 *
 * @param content the raw JSON array text
 * @returns the parsed identity records
 */
export function parseIdentityRecords({ content }: { content: string }): readonly IdentityRecord[] {
  const parsed = parseJson({ text: content });
  if (parsed.isErr() || !Array.isArray(parsed.value)) {
    return [];
  }
  const records: IdentityRecord[] = [];
  for (const entry of parsed.value) {
    const record = parseIdentityEntry({ entry });
    if (record !== undefined) {
      records.push(record);
    }
  }
  return records;
}

/**
 * Resolve a raw handle/id to a display `@handle`. A known id maps to `@<handle>`; anything unknown is
 * returned verbatim (never invents a name).
 *
 * @param map the identity map
 * @param raw the raw token (with or without a leading `@`)
 * @returns the resolved `@handle`, or `raw` unchanged when unknown
 */
export function resolveHandle({ map, raw }: { map: IdentityMap; raw: string }): string {
  const bare = raw.startsWith("@") ? raw.slice(1) : raw;
  const record = map.get(bare);
  return record !== undefined ? `@${record.handle}` : raw;
}
