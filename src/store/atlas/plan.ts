/**
 * Which kind files an import will read, and what each one's manifest says about it — pure over the
 * filesystem, so the whole selection question is answerable without a database.
 *
 * ## Three exclusion rules, and each was MEASURED rather than assumed
 *
 * **A `_`-prefixed file is not atlas content.** `jumpcloud/_resume.jsonl` is half a gigabyte of sync
 * PROGRESS records (`{at, complete, declaredTotal, dropped, endpoint, pagesExhausted, records, surface}`)
 * — 38% of everything under `atlas/` — and it is the only `_`-prefixed file in the tree. Reading it would
 * be the single largest thing this import ever did and it would store nothing true.
 *
 * **A directory under `atlas/` is not necessarily an ATLAS.** `atlas/apps-surface-map/` holds eighteen
 * `.mjs`, `.ts` and `.json` scratch files, no `manifest.json` and no kind file, and
 * `grep -rn apps-surface-map src/` finds nothing — it is not registered anywhere. So the platform list
 * comes from `../../atlas/registry.ts`, which is the one seam every generic atlas verb already goes
 * through, intersected with what is actually on disk. A `readdir` of `atlas/` is the wrong list.
 *
 * **The KIND comes from the envelope, never from the file name.** The file is `browser-pages.jsonl` and
 * the kind is `browser-page`; singular/plural drift across 834 files is unbounded and there is no rule
 * that recovers it. This module hands the path over and `./read.ts` reads line 1.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { atlasPlatforms } from "../../atlas/registry.js";
import { isRecord } from "../../lib/parsers.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";
import type { NewAtlasKindStatusRow } from "../schema.js";

/** One kind file an import will read. */
export interface PlannedKindFile {
  readonly platform: string;
  readonly path: string;
  /** The file's own basename, used only for reporting — the KIND is read from the envelope. */
  readonly file: string;
}

/** One platform's plan: its kind files, and whatever its manifest says about each kind. */
export interface PlannedPlatform {
  readonly platform: string;
  readonly root: string;
  readonly files: readonly PlannedKindFile[];
  /** Every kind the manifest names, keyed by kind. Empty when the platform carries no manifest. */
  readonly manifest: ReadonlyMap<string, ManifestKindStatus>;
}

/** One kind's cell in a platform's `manifest.json`, as much of it as the status table holds. */
export interface ManifestKindStatus {
  readonly digest: string | null;
  readonly entityCount: number;
  readonly lastAttemptAt: Date | null;
  readonly lastAttemptOutcome: string | null;
  readonly lastAttemptReasons: readonly string[];
  readonly lastSuccessAt: Date | null;
  readonly permissionBlocked: unknown;
}

/**
 * Plan every registered platform that has a generation on disk.
 *
 * @param home the state home to resolve against, or nothing for the ambient one
 * @param only when given, the single platform to plan — the rest are not even stat'd
 * @returns one entry per platform with at least one kind file, in registry order
 */
export function planAtlasImport({ home, only }: { home?: string; only?: string }): readonly PlannedPlatform[] {
  const tree = stateHomePaths(home === undefined ? {} : { home }).atlas;
  const roots = new Map<string, string>();
  for (const value of Object.values(tree)) {
    if (typeof value === "string") {
      continue;
    }
    roots.set(basename(value.root), value.root);
  }
  const planned: PlannedPlatform[] = [];
  for (const platform of atlasPlatforms()) {
    if (only !== undefined && only !== platform) {
      continue;
    }
    const root = roots.get(platform);
    if (root === undefined || !existsSync(root) || !statSync(root).isDirectory()) {
      continue;
    }
    const files = kindFilesUnder({ platform, root });
    if (files.length === 0) {
      continue;
    }
    planned.push({ files, manifest: readManifest({ root }), platform, root });
  }
  return planned;
}

/**
 * Every kind file in one platform's atlas root, excluding the `_`-prefixed ones.
 *
 * @param root the platform's atlas directory
 * @param platform the platform name, stamped onto each entry
 * @returns the kind files, sorted by name so two runs read them in the same order
 */
function kindFilesUnder({ root, platform }: { root: string; platform: string }): readonly PlannedKindFile[] {
  const found: PlannedKindFile[] = [];
  for (const file of readdirSync(root).toSorted()) {
    if (!file.endsWith(".jsonl") || file.startsWith("_")) {
      continue;
    }
    found.push({ file, path: join(root, file), platform });
  }
  return found;
}

/**
 * Read one platform's `manifest.json`, if it has one.
 *
 * A missing or unreadable manifest is an EMPTY map rather than a refusal: the manifest is written LAST in
 * a generation precisely so a reader can tell a complete publication from an interrupted one, and a kind
 * file that exists without one is still real content. What is lost is the status row, which is stated in
 * the report rather than papered over.
 *
 * @param root the platform's atlas directory
 * @returns each kind's status cell, keyed by kind name
 */
function readManifest({ root }: { root: string }): ReadonlyMap<string, ManifestKindStatus> {
  const path = join(root, "manifest.json");
  if (!existsSync(path)) {
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: path, text: readFileSync(path, "utf8") });
  } catch {
    return new Map();
  }
  if (!isRecord(parsed) || !isRecord(parsed["kinds"])) {
    return new Map();
  }
  const cells = new Map<string, ManifestKindStatus>();
  for (const [kind, cell] of Object.entries(parsed["kinds"])) {
    if (!isRecord(cell)) {
      continue;
    }
    cells.set(kind, readKindCell({ cell }));
  }
  return cells;
}

/**
 * Project one manifest cell, taking only what the status table holds.
 *
 * @param cell the parsed cell
 * @returns the fields the status row needs, with an unreadable instant treated as absent
 */
function readKindCell({ cell }: { cell: Record<string, unknown> }): ManifestKindStatus {
  const attempt = isRecord(cell["lastAttempt"]) ? cell["lastAttempt"] : null;
  const count = cell["entityCount"];
  const blocked = cell["permissionBlocked"];
  return {
    digest: typeof cell["digest"] === "string" ? cell["digest"] : null,
    entityCount: typeof count === "number" && Number.isFinite(count) ? count : 0,
    lastAttemptAt: attempt === null ? null : maybeInstant({ value: attempt["at"] }),
    lastAttemptOutcome: attempt !== null && typeof attempt["outcome"] === "string" ? attempt["outcome"] : null,
    lastAttemptReasons: attempt === null ? [] : reasonsOf({ attempt }),
    lastSuccessAt: maybeInstant({ value: cell["lastSuccessAt"] }),
    // Absent on every manifest written before the field existed, so an undefined here means "this generation
    // predates the field", which reads as `null` — not as a block nobody recorded.
    permissionBlocked: blocked === undefined ? null : blocked,
  };
}

/**
 * The reasons one attempt recorded, dropping anything that is not a string.
 *
 * @param attempt the manifest cell's `lastAttempt` object
 * @returns every string reason, in order
 */
function reasonsOf({ attempt }: { attempt: Record<string, unknown> }): readonly string[] {
  const reasons = attempt["reasons"];
  if (!Array.isArray(reasons)) {
    return [];
  }
  return reasons.filter((entry): entry is string => typeof entry === "string");
}

/**
 * The status of a kind whose platform's manifest does not name it.
 *
 * A named value rather than a chain of `??` at each field, because "the manifest does not know about this
 * kind" is ONE fact about a generation and spelling it once is what keeps it readable as one.
 *
 * @param entityCount how many entity lines the file actually holds, since no manifest claims a number
 * @returns the cell an unpublished kind gets
 */
export function unmanifestedKindStatus({ entityCount }: { entityCount: number }): ManifestKindStatus {
  return {
    digest: null,
    entityCount,
    lastAttemptAt: null,
    lastAttemptOutcome: null,
    lastAttemptReasons: [],
    lastSuccessAt: null,
    permissionBlocked: null,
  };
}

/**
 * An ISO string as an instant, or `null`.
 *
 * Unreadable is `null` here rather than a refusal, unlike in `./project.ts`: a manifest instant is a
 * DERIVED convenience — `store verify` and the freshness verb both read the same value off disk — while an
 * entity's `firstSeenAt` is the fact itself.
 *
 * @param value whatever the manifest carried
 * @returns the instant, or `null`
 */
function maybeInstant({ value }: { value: unknown }): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Build the status row for one kind, folding the manifest cell onto what the envelope said.
 *
 * @param kind the envelope's kind
 * @param generationAt the envelope's `updatedAt`
 * @param schemaVersion the envelope's schema version, when it declares one
 * @param readEpoch the envelope's read epoch, when it stamps one
 * @param cell the manifest's own cell for this kind, or {@link unmanifestedKindStatus} when the manifest
 *   does not name it — required rather than optional so every field here reads one value rather than
 *   falling back per field, which is how a manifest's claimed entity count and an observed one diverge
 *   without anybody noticing
 * @returns the row `atlas_kind_status` takes
 */
export function kindStatusRow({
  platform,
  kind,
  generationAt,
  schemaVersion,
  readEpoch,
  cell,
}: {
  platform: string;
  kind: string;
  generationAt: Date;
  schemaVersion: number | null;
  readEpoch: string | null;
  cell: ManifestKindStatus;
}): NewAtlasKindStatusRow {
  return {
    digest: cell.digest,
    // The manifest's count, because that is what the PUBLICATION claims — which is what lets a later check
    // compare it to the rows actually stored and find a kind file truncated after its manifest was written.
    entityCount: cell.entityCount,
    generationAt,
    kind,
    lastAttemptAt: cell.lastAttemptAt,
    lastAttemptOutcome: cell.lastAttemptOutcome,
    lastAttemptReasons: [...cell.lastAttemptReasons],
    lastSuccessAt: cell.lastSuccessAt,
    permissionBlocked: cell.permissionBlocked,
    platform,
    readEpoch,
    schemaVersion,
  };
}
