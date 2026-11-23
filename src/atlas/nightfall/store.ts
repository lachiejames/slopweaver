/**
 * Where the Nightfall atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, the remedy for a superseded generation, and one refusal the
 * kit cannot make.
 *
 * ## The publish gate: no detection ever reaches a kind file
 *
 * `refuseStoredDetections` closes over the documents about to be written and refuses the WHOLE generation if any of
 * them carries a record of a kind whose disposition is `shape-index`. That is a property of PUBLISHING
 * rather than of the fetch, following the Datadog atlas's own gate, and the reason it is worth a gate here
 * is specific to this platform: a violation record describes the sensitive data the product exists to
 * protect, and the vendor's own `Finding` component declares `redactedSensitiveText`. A disposition
 * enforced only by the code that happens to call the API is a disposition one refactor away from being
 * gone. Enforced at the file boundary, it survives the refactor.
 *
 * It refuses rather than filtering, deliberately. A gate that silently dropped the offending entities would
 * publish a generation that looked complete and was not, which is the failure mode this whole atlas is
 * built to make impossible.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { publishAtlas } from "../kit/publish.js";
import {
  type AtlasSnapshot,
  type AtlasStorePaths,
  type AtlasStoreSpec,
  readAtlas,
  readKindFile,
  readManifest,
} from "../kit/store.js";

import { nightfallObservationalKinds } from "./dispositions.js";
import {
  byNightfallKind,
  NIGHTFALL_ATLAS_KINDS,
  NIGHTFALL_ATLAS_PLATFORM,
  NIGHTFALL_ATLAS_SCHEMA_VERSION,
  type NightfallAtlasKind,
  type NightfallAtlasKindFile,
  type NightfallAtlasManifest,
  nightfallAtlasKindFileSchema,
  nightfallAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 * @internal
 */
export const NIGHTFALL_SUPERSEDE_REMEDY =
  "run: slopweaver atlas nightfall reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Nightfall atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type NightfallAtlasPaths = AtlasStorePaths<NightfallAtlasKind>;

/**
 * What the Nightfall atlas holds right now, as the reader sees it.
 * @internal
 */
export type NightfallAtlasSnapshot = AtlasSnapshot<NightfallAtlasKind, NightfallAtlasKindFile, NightfallAtlasManifest>;

/**
 * Refuse a generation carrying a stored record of a shape-indexed kind.
 *
 * The check is on the DOCUMENTS rather than on the manifest, because the manifest only counts entities and
 * a count cannot tell a declared record shape from a detection. What it branches on is the entity's own
 * declared `family` — `model.ts` carries why that is a field rather than a `providerId` prefix, and the
 * short version is that the prefix version of this gate refused its own first generation.
 *
 * @param files the kind files about to be written
 * @returns nothing when the generation is publishable, or why it is refused
 */
export function refuseStoredDetections({
  files,
}: {
  files: Readonly<Partial<Record<NightfallAtlasKind, NightfallAtlasKindFile>>>;
}): Result<null> {
  const observational = nightfallObservationalKinds();
  const reasons: string[] = [];
  for (const kind of observational) {
    const file = files[kind];
    if (file === undefined) {
      continue;
    }
    const detections = file.entities.filter((entity) => entity.family === "record");
    if (detections.length > 0) {
      reasons.push(
        `${kind} carries ${detections.length} stored record(s) and its disposition is shape-index — docs/atlas-intent/06-holdings.md says this family is reached and its shape stored, never a row per detection`,
      );
    }
  }
  if (reasons.length > 0) {
    return err(reasons);
  }
  return ok(null);
}

/** Everything the kit needs to read, grade and publish a Nightfall generation. */
export const NIGHTFALL_STORE_SPEC: AtlasStoreSpec<NightfallAtlasKind, NightfallAtlasKindFile, NightfallAtlasManifest> =
  {
    kinds: NIGHTFALL_ATLAS_KINDS,
    kindObligations: { exceptions: {} },
    kindVolumes: { verdicts: [] },
    parseKindFile: ({ json }) => nightfallAtlasKindFileSchema.safeParse(json),
    parseManifest: ({ json }) => nightfallAtlasManifestSchema.safeParse(json),
    platform: NIGHTFALL_ATLAS_PLATFORM,
    schemaVersion: NIGHTFALL_ATLAS_SCHEMA_VERSION,
    supersedeRemedy: NIGHTFALL_SUPERSEDE_REMEDY,
  };

/**
 * Resolve every Nightfall atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function nightfallAtlasPaths({ home }: { home: string }): NightfallAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.nightfall;
  return {
    directory: paths.root,
    home,
    // `!`: `stateHome.ts` builds this map by iterating NIGHTFALL_ATLAS_KINDS, so every declared kind is
    // present. What it cannot express is a key type narrower than `string`, which is what this recovers.
    kinds: byNightfallKind({ build: ({ kind }) => paths.kinds[kind]! }),
    manifest: paths.manifest,
    superseded: paths.superseded,
  };
}

/**
 * Read the manifest, refusing anything it cannot trust.
 *
 * @param paths the resolved paths
 * @returns the manifest, `null` when nothing has been published, or why it cannot be read
 * @internal
 */
export function readNightfallManifest({
  paths,
}: {
  paths: NightfallAtlasPaths;
}): Result<NightfallAtlasManifest | null> {
  return readManifest({ paths, spec: NIGHTFALL_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 * @internal
 */
export function readNightfallKindFile({
  paths,
  kind,
}: {
  paths: NightfallAtlasPaths;
  kind: NightfallAtlasKind;
}): Result<NightfallAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: NIGHTFALL_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readNightfallAtlas({ paths }: { paths: NightfallAtlasPaths }): Result<NightfallAtlasSnapshot> {
  return readAtlas({ paths, spec: NIGHTFALL_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes written.
 *
 * The detection gate runs BEFORE the kit opens a file, so a refused generation leaves nothing behind.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishNightfallAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: NightfallAtlasPaths;
  files: Readonly<Partial<Record<NightfallAtlasKind, NightfallAtlasKindFile>>>;
  manifest: NightfallAtlasManifest;
  derivedFrom: NightfallAtlasManifest | null;
}): Result<readonly string[]> {
  const gate = refuseStoredDetections({ files });
  if (gate.isErr()) {
    return err(gate.error);
  }
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: NIGHTFALL_STORE_SPEC });
}
