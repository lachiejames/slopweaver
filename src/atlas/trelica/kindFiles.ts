/**
 * The three kind-file operations every half of a sync shares: read a kind as the generation holds it, replace
 * one first-party cell and the entity list, and stamp the kinds a run wrote into the manifest.
 *
 * Shared by `sync.ts` and `entitySync.ts`, so the API surfaces and the 15-Oct entity kinds publish through one
 * definition of "this run wrote this kind" rather than two that could disagree.
 */
import { succeededTrelicaCoverageCell, withTrelicaCoverageCell } from "./coverage.js";
import {
  emptyTrelicaKindFile,
  initialTrelicaManifest,
  type TrelicaAtlasEntity,
  type TrelicaAtlasKind,
  type TrelicaAtlasKindFile,
  type TrelicaAtlasManifest,
} from "./model.js";
import { reheldTrelicaEntity } from "./providerText.js";
import type { TrelicaAtlasSnapshot } from "./store.js";

/**
 * The surface name the first-party channel's coverage is reported under.
 *
 * @internal
 */
export const TRELICA_FIRST_PARTY_SURFACE = "first-party-api";

/**
 * One kind's file as the generation holds it, or an empty one when the generation predates the kind.
 *
 * @param snapshot the generation read under the publish lock
 * @param kind the kind to read
 * @param at this run's ISO timestamp, stamped on an empty file
 * @returns the stored file
 */
export function storedTrelicaKindFile({
  snapshot,
  kind,
  at,
}: {
  snapshot: TrelicaAtlasSnapshot;
  kind: TrelicaAtlasKind;
  at: string;
}): TrelicaAtlasKindFile {
  const stored = snapshot.files[kind];
  if (stored == null) {
    return emptyTrelicaKindFile({ kind, updatedAt: at });
  }
  return stored;
}

/**
 * An entity kind file with its own first-party cell replaced and nothing else touched.
 *
 * @param stored the kind as the generation holds it
 * @param entities the merged entity list to install
 * @param reason the cell's reason
 * @param state `synced` for a complete read, `deferred` when the kind kept what it held
 * @param at this run's ISO timestamp
 * @returns the file to publish
 */
export function trelicaEntityFileWith({
  stored,
  entities,
  reason,
  state,
  at,
}: {
  stored: TrelicaAtlasKindFile;
  entities: readonly TrelicaAtlasEntity[];
  reason: string;
  state: "synced" | "deferred";
  at: string;
}): TrelicaAtlasKindFile {
  return {
    ...stored,
    coverage: [
      ...withTrelicaCoverageCell({
        cells: stored.coverage,
        replacement: succeededTrelicaCoverageCell({
          artifacts: [],
          at,
          channel: "first-party-api",
          reason,
          role: "authoritative",
          scope: stored.kind,
          state,
          surface: TRELICA_FIRST_PARTY_SURFACE,
        }),
      }),
    ],
    // Every entity a kind file is written with, fresh, merged-stale or deferred, re-held: what an older
    // generation held under a looser rule is never carried into this one.
    entities: entities.map((entity) => reheldTrelicaEntity({ entity })),
    updatedAt: at,
  };
}

/** The manifest a sync stamps: a first publish has none yet, by design, so every kind starts from never-synced. */
function manifestToStamp({
  manifest,
  at,
}: {
  manifest: TrelicaAtlasManifest | null;
  at: string;
}): TrelicaAtlasManifest {
  if (manifest === null) {
    return initialTrelicaManifest({ updatedAt: at });
  }
  return manifest;
}

/**
 * Stamp every kind a sync wrote, leaving every other kind — `page`'s included — exactly as it was.
 *
 * @param manifest the manifest the generation holds, or `null` for a first publish
 * @param files every kind file this run publishes
 * @param deferred each kind that kept its stored entities, and why: stamped a failed attempt, its last success kept
 * @param at this run's ISO timestamp
 * @returns the manifest to publish
 */
export function trelicaSyncManifest({
  manifest,
  files,
  deferred,
  at,
}: {
  manifest: TrelicaAtlasManifest | null;
  files: Readonly<Partial<Record<TrelicaAtlasKind, TrelicaAtlasKindFile>>>;
  deferred: ReadonlyMap<TrelicaAtlasKind, string>;
  at: string;
}): TrelicaAtlasManifest {
  const base = manifestToStamp({ at, manifest });
  const stamps = Object.entries(files).map(([kind, file]) => {
    const reason = deferred.get(file.kind);
    const lastAttempt =
      reason === undefined ? { at, outcome: "ok", reasons: [] } : { at, outcome: "failed", reasons: [reason] };
    const lastSuccessAt = reason === undefined ? at : base.kinds[file.kind].lastSuccessAt;
    return [kind, { digest: null, entityCount: file.entities.length, lastAttempt, lastSuccessAt }];
  });
  return { ...base, kinds: { ...base.kinds, ...Object.fromEntries(stamps) }, updatedAt: at };
}
