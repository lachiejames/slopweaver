/**
 * Where this atlas lives under `$SLOPWEAVER_HOME`, what it tells the kit about its own documents, and the
 * one thing that makes its sensitivity gate a boundary rather than a helper.
 *
 * ## Why the gate is wired into `guardPublish` rather than called by the sync
 *
 * `AtlasStoreSpec.guardPublish` is the kit's own seam for "a platform-specific reason to refuse a publish",
 * and it runs before any file is opened — a refusal there leaves nothing half-written. Exporting an
 * `admitDatadogGeneration` function and trusting a future sync to call it would leave a caller who forgets,
 * and on this platform a caller who forgets writes an API key into a world-readable file. So the gate is
 * not something a sync remembers to do; it is a property of publishing at all.
 *
 * 1Password proved this shape and it is copied deliberately. The one difference is that the Datadog gate is
 * KIND-SCOPED — `sensitiveFields.ts` records why a field name alone cannot decide, since `key` is an API
 * key on nine Datadog models and a case identifier on forty — so the guard scans each kind file under
 * its own kind rather than running one scan over the whole generation.
 *
 * The guard closes over the documents and the known credential values because the kit's signature hands it
 * only the manifest, which is why {@link datadogStoreSpec} is a FUNCTION while most atlases' specs are
 * constants.
 *
 * ## The manifest is scanned too, and under which kind
 *
 * A manifest carries counts, digests and failure REASONS, and a failure reason is a string this repository
 * composed from a provider error — which is exactly the kind of string a credential ends up inside. It is
 * scanned under a kind of its own (`manifest`) so the kind-scoped field rules that apply to a payload do
 * not silently apply to metadata, and so a refusal says which document it refused.
 */
import { slopweaverHome } from "../../homeDir.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { publishAtlas } from "../kit/publish.js";
import { type AtlasSnapshot, type AtlasStorePaths, type AtlasStoreSpec, readAtlas } from "../kit/store.js";

import {
  DATADOG_ATLAS_SCHEMA_VERSION,
  type DatadogKindFile,
  type DatadogManifest,
  datadogKindFileSchema,
  datadogManifestSchema,
} from "./documents.js";
import { DATADOG_MANIFEST_SCAN_KIND } from "./fieldDenial.js";
import { DATADOG_ATLAS_PLATFORM, DATADOG_KINDS, type DatadogKind } from "./model.js";
import { admitDatadogGeneration } from "./sensitivity.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 * @internal
 */
export const DATADOG_SUPERSEDE_REMEDY =
  "run: slopweaver atlas datadog reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/**
 * Every path this atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`.
 * @internal
 */
export type DatadogAtlasPaths = AtlasStorePaths<DatadogKind>;

/**
 * What this atlas holds right now, as the reader sees it.
 * @internal
 */
export type DatadogAtlasSnapshot = AtlasSnapshot<DatadogKind, DatadogKindFile, DatadogManifest>;

/**
 * Everything the kit needs to read, grade and publish a generation.
 *
 * @param files the kind files this publish would write; the guard scans each one under its own kind
 * @param knownSecrets credential values this process holds, refused verbatim wherever they appear. Pass an
 * empty list when none are configured, never a placeholder — a short needle matches everywhere
 * @returns the store spec
 */
export function datadogStoreSpec({
  files = {},
  knownSecrets = [],
}: {
  files?: Readonly<Partial<Record<DatadogKind, DatadogKindFile>>>;
  knownSecrets?: readonly string[];
} = {}): AtlasStoreSpec<DatadogKind, DatadogKindFile, DatadogManifest> {
  return {
    guardPublish: ({ next }): Result<null> => {
      for (const kind of DATADOG_KINDS) {
        const file = files[kind];
        if (file === undefined) {
          continue;
        }
        const admitted = admitDatadogGeneration({ document: file, kind, knownSecrets });
        if (admitted.isErr()) {
          return err(admitted.error);
        }
      }
      const admittedManifest = admitDatadogGeneration({
        document: next,
        kind: DATADOG_MANIFEST_SCAN_KIND,
        knownSecrets,
      });
      return admittedManifest.isErr() ? err(admittedManifest.error) : ok(null);
    },
    kinds: DATADOG_KINDS,
    kindObligations: { exceptions: {} },
    kindVolumes: { verdicts: [] },
    parseKindFile: ({ json }) => datadogKindFileSchema.safeParse(json),
    parseManifest: ({ json }) => datadogManifestSchema.safeParse(json),
    platform: DATADOG_ATLAS_PLATFORM,
    schemaVersion: DATADOG_ATLAS_SCHEMA_VERSION,
    supersedeRemedy: DATADOG_SUPERSEDE_REMEDY,
  };
}

/**
 * Resolve every atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`; omitted takes the ambient one
 * @returns the resolved paths
 */
export function datadogAtlasPaths({ home = slopweaverHome() }: { home?: string } = {}): DatadogAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.datadog;
  const kinds: Record<string, string> = {};
  for (const kind of DATADOG_KINDS) {
    const path = paths.kinds[kind];
    if (path !== undefined) {
      kinds[kind] = path;
    }
  }
  return {
    directory: paths.root,
    home,
    // `as`: the loop above is over the platform's own exhaustive kind list and `stateHome.ts` builds its map
    // from that same list, so every key is present; `Record<string, string>` is the only shape a computed
    // map can have on the way out. Same escape the kit's own `readAtlas` takes, for the same reason.
    // oxlint-disable-next-line no-unsafe-type-assertion
    kinds: kinds as Readonly<Record<DatadogKind, string>>,
    manifest: paths.manifest,
    superseded: paths.superseded,
  };
}

/**
 * Read the whole Datadog atlas, iterating the kind list rather than the directory.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`; omitted takes the ambient one
 * @returns the snapshot, or every reason it cannot be trusted
 * @internal
 */
export function readDatadogAtlas({ home }: { home?: string } = {}): Result<DatadogAtlasSnapshot> {
  return readAtlas({ paths: datadogAtlasPaths(home === undefined ? {} : { home }), spec: datadogStoreSpec() });
}

/**
 * Publish a generation: every kind file first, then the manifest, with the sensitivity gate run before the
 * first byte.
 *
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest currently on disk, or `null` when fresh
 * @param knownSecrets credential values this process holds, refused verbatim wherever they appear
 * @param home the resolved `$SLOPWEAVER_HOME`; omitted takes the ambient one
 * @returns the paths written, in order, or every reason publication was refused
 * @internal
 */
export function publishDatadogAtlas({
  files,
  manifest,
  derivedFrom,
  knownSecrets = [],
  home,
}: {
  files: Readonly<Partial<Record<DatadogKind, DatadogKindFile>>>;
  manifest: DatadogManifest;
  derivedFrom: DatadogManifest | null;
  knownSecrets?: readonly string[];
  home?: string;
}): Result<readonly string[]> {
  return publishAtlas({
    files,
    manifest,
    derivedFrom,
    paths: datadogAtlasPaths(home === undefined ? {} : { home }),
    spec: datadogStoreSpec({ files, knownSecrets }),
  });
}
