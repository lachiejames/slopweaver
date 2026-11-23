/**
 * The thin, RECORD-time-only fs shell for the cassette redactor's local state (under `$SLOPWEAVER_HOME`,
 * never committed): the persistent real-id → synthetic-id map and the pre-seeded known-sensitive value list.
 * In replay/CI there is no home / no files, so every reader returns empty and nothing is written — committed
 * cassettes replay with NO secret. All I/O is confined here; the redactor itself (`cassetteRedact`) is pure.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadLineListResult } from "../hygiene/scan.js";
import { isRecord } from "../lib/parsers.js";
import { stateHomePaths } from "../stateHome.js";
import { type CassetteIdMap, EMPTY_ID_MAP } from "./cassetteRedactTypes.js";

/**
 * The pre-seeded known-sensitive literals (names/domains/ids) — the redactor's backstop + record-time
 * tripwire.
 *
 * An unreadable list THROWS rather than yielding `[]`: silently returning no known values would leave the
 * tripwire watching for nothing while real traffic is written to a cassette, which is the same silent-failure
 * shape as the hygiene denylist it shares a loader with.
 *
 * @param home the Slopweaver home, or undefined for no list
 * @returns the known-sensitive literals; `[]` when there is no home or no such file
 * @throws when the file exists but cannot be read
 */
export function loadCassetteKnownValues({ home }: { home: string | undefined }): readonly string[] {
  if (home === undefined || home.length === 0) {
    return [];
  }
  const path = stateHomePaths({ home }).cassetteRedaction.knownValues;
  const loaded = loadLineListResult({ path });
  if (loaded.kind === "unreadable") {
    throw new Error(
      `cassette redaction: the known-values list at ${path} exists but could not be read (${loaded.reason}). ` +
        `Refusing to record with an empty backstop.`,
    );
  }
  return loaded.kind === "absent" ? [] : loaded.lines;
}

/** Parse a persisted id-map value defensively; a malformed/missing file yields the empty map. */
function parseIdMap({ raw }: { raw: unknown }): CassetteIdMap {
  if (!isRecord(raw) || !isRecord(raw["entries"]) || typeof raw["next"] !== "number") {
    return EMPTY_ID_MAP;
  }
  const entries: Record<string, string> = {};
  for (const key of Object.keys(raw["entries"])) {
    const value = raw["entries"][key];
    if (typeof value === "string") {
      entries[key] = value;
    }
  }
  return { entries, next: raw["next"] };
}

/**
 * Load the persistent id-map (stable synthetic ids across re-records); empty when no home/file.
 *
 * @param home the state home the map lives under, or undefined at replay time
 * @returns the map, or empty — persisting it is what keeps a synthetic id stable across re-records, so a
 *   cassette diff shows real changes rather than renumbering
 */
export function loadIdMap({ home }: { home: string | undefined }): CassetteIdMap {
  if (home === undefined || home.length === 0) {
    return EMPTY_ID_MAP;
  }
  try {
    return parseIdMap({ raw: JSON.parse(readFileSync(stateHomePaths({ home }).cassetteRedaction.idMap, "utf8")) });
  } catch {
    return EMPTY_ID_MAP;
  }
}

/**
 * Persist the (possibly grown) id-map. Record-time only — a no-op when there is no home.
 *
 * @param home the state home to write under, or undefined at replay time (then this does nothing)
 * @param idMap the map to persist, including any ids minted during this recording
 */
export function saveIdMap({ home, idMap }: { home: string | undefined; idMap: CassetteIdMap }): void {
  if (home === undefined || home.length === 0) {
    return;
  }
  writeFileSync(stateHomePaths({ home }).cassetteRedaction.idMap, `${JSON.stringify(idMap, null, 2)}\n`);
}
