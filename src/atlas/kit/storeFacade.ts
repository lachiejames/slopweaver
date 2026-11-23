/**
 * Every read-and-write door one platform's store opens, built once from its spec.
 *
 * ## Why a facade rather than a wrapper per platform
 *
 * Each atlas re-declares the same four delegations — read the manifest, read one kind, read the whole
 * generation, publish — differing only in the names in their signatures. Two such files were similar enough
 * that the clone gate flagged them as one, which is the gate doing its job: a delegation that says nothing
 * platform-specific is not per-platform code. What genuinely varies is the spec and the paths, and both are
 * arguments here.
 *
 * The publish LOCK and the generation swap-guard are deliberately not here. They live in `publishGuard.ts`,
 * because only an atlas whose two passes write the same kind needs them, and folding them in would hand
 * every atlas a pair it has no use for.
 */
import type { Result } from "../../lib/result.js";

import { publishAtlas } from "./publish.js";
import {
  type AtlasKindFileLike,
  type AtlasManifestLike,
  type AtlasSnapshot,
  type AtlasStorePaths,
  type AtlasStoreSpec,
  readAtlas,
  readKindFile,
  readManifest,
} from "./store.js";

/**
 * One platform's store doors.
 *
 * @internal
 */
export interface AtlasStoreFacade<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
> {
  readonly manifest: (input: { paths: AtlasStorePaths<TKind> }) => Result<TManifest | null>;
  readonly kindFile: (input: { paths: AtlasStorePaths<TKind>; kind: TKind }) => Result<TFile | null>;
  readonly snapshot: (input: { paths: AtlasStorePaths<TKind> }) => Result<AtlasSnapshot<TKind, TFile, TManifest>>;
  readonly publish: (input: {
    paths: AtlasStorePaths<TKind>;
    files: Readonly<Partial<Record<TKind, TFile>>>;
    manifest: TManifest;
    derivedFrom: TManifest | null;
  }) => Result<readonly string[]>;
}

/**
 * Build one platform's store facade.
 *
 * @param spec the platform's store spec
 * @returns every store door that platform needs
 */
export function createAtlasStore<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({ spec }: { spec: AtlasStoreSpec<TKind, TFile, TManifest> }): AtlasStoreFacade<TKind, TFile, TManifest> {
  return {
    kindFile: ({ paths, kind }) => readKindFile({ kind, paths, spec }),
    manifest: ({ paths }) => readManifest({ paths, spec }),
    publish: ({ paths, files, manifest, derivedFrom }) => publishAtlas({ derivedFrom, files, manifest, paths, spec }),
    snapshot: ({ paths }) => readAtlas({ paths, spec }),
  };
}
