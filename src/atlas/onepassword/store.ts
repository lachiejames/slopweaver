/**
 * Where this atlas lives under `$SLOPWEAVER_HOME`, what it tells the kit about its own documents, and the
 * one thing it does that no other atlas here does: it runs the sensitivity gate over every document BEFORE
 * the kit writes a byte.
 *
 * ## Why the gate is wired into `guardPublish` rather than called by the sync
 *
 * `AtlasStoreSpec.guardPublish` is the kit's own seam for "a platform-specific reason to refuse a publish",
 * and it runs before any file is opened — a refusal there leaves nothing half-written. Putting the gate
 * anywhere else would leave a caller who forgot to call it, and on this platform a caller who forgets is a
 * password on disk. The gate is therefore not something a sync remembers to do; it is a property of
 * publishing at all.
 *
 * The guard closes over the documents and the denylist because the kit's signature hands it only the
 * manifest — see {@link onepasswordStoreSpec}, which is a FUNCTION for exactly that reason while every
 * other atlas's spec is a constant.
 */
import type { Result } from "../../lib/result.js";
import { err, ok } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { publishAtlas } from "../kit/publish.js";
import {
  type AtlasSnapshot,
  type AtlasStorePaths,
  type AtlasStoreSpec,
  atlasJson,
  kindFileParts,
  readAtlas,
  readKindFile,
  readManifest,
} from "../kit/store.js";

import {
  ONEPASSWORD_ATLAS_PLATFORM,
  ONEPASSWORD_ATLAS_SCHEMA_VERSION,
  ONEPASSWORD_KINDS,
  type OnepasswordKind,
  type OnepasswordKindFile,
  type OnepasswordManifest,
  onepasswordKindFileSchema,
  onepasswordManifestSchema,
} from "./model.js";
import {
  admitOnepasswordDocument,
  admitOnepasswordKindFile,
  type OnepasswordSensitivityFinding,
} from "./sensitivity.js";
import { ONEPASSWORD_KIND_VOLUMES } from "./volume.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 *
 * @internal
 */
export const ONEPASSWORD_SUPERSEDE_REMEDY =
  "run: slopweaver onepassword reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path this atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract in `stateHome.ts`. */
export type OnepasswordAtlasPaths = AtlasStorePaths<OnepasswordKind>;

/**
 * What this atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type OnepasswordAtlasSnapshot = AtlasSnapshot<OnepasswordKind, OnepasswordKindFile, OnepasswordManifest>;

/**
 * Everything the kit needs to read, grade and publish a generation.
 *
 * A function rather than a constant, and the only atlas spec here that is: its publish guard has to see the
 * KIND FILES about to be written, and the kit's guard signature is handed only the manifest. Closing over
 * them is what lets the sensitivity gate refuse before the kit opens a file.
 *
 * @param files the kind files this publish would write; the guard scans each one
 * @param denylist the private organisation words, loaded by the caller from the state home
 * @param onFindings called with every non-refusing finding, so the sync can record them as gaps
 * @returns the store spec
 */
export function onepasswordStoreSpec({
  files = {},
  denylist = [],
  onFindings,
}: {
  files?: Readonly<Partial<Record<OnepasswordKind, OnepasswordKindFile>>>;
  denylist?: readonly string[];
  onFindings?: (input: { findings: readonly OnepasswordSensitivityFinding[] }) => void;
} = {}): AtlasStoreSpec<OnepasswordKind, OnepasswordKindFile, OnepasswordManifest> {
  return {
    guardPublish: ({ next }): Result<null> => {
      const reported: OnepasswordSensitivityFinding[] = [];
      for (const kind of ONEPASSWORD_KINDS) {
        const file = files[kind];
        if (file === undefined) {
          continue;
        }
        const admitted = admitOnepasswordKindFile({ ...kindFileParts({ file }), denylist, label: `${kind} file` });
        if (admitted.isErr()) {
          return err(admitted.error);
        }
        reported.push(...admitted.value);
      }
      const admittedManifest = admitOnepasswordDocument({ denylist, document: next, label: "the manifest" });
      if (admittedManifest.isErr()) {
        return err(admittedManifest.error);
      }
      reported.push(...admittedManifest.value);
      onFindings?.({ findings: reported });
      return ok(null);
    },
    kinds: ONEPASSWORD_KINDS,
    kindObligations: { exceptions: {} },
    kindVolumes: ONEPASSWORD_KIND_VOLUMES,
    parseKindFile: ({ json }) => onepasswordKindFileSchema.safeParse(json),
    parseManifest: ({ json }) => onepasswordManifestSchema.safeParse(json),
    platform: ONEPASSWORD_ATLAS_PLATFORM,
    schemaVersion: ONEPASSWORD_ATLAS_SCHEMA_VERSION,
    supersedeRemedy: ONEPASSWORD_SUPERSEDE_REMEDY,
  };
}

/**
 * Resolve every atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function onepasswordAtlasPaths({ home }: { home: string }): OnepasswordAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.onepassword;
  return { directory: paths.root, home, kinds: paths.kinds, manifest: paths.manifest, superseded: paths.superseded };
}

/**
 * Read the manifest, refusing anything it cannot trust.
 *
 * @param paths the resolved paths
 * @returns the manifest, `null` when nothing has been published, or why it cannot be read
 *
 * @internal
 */
export function readOnepasswordManifest({
  paths,
}: {
  paths: OnepasswordAtlasPaths;
}): Result<OnepasswordManifest | null> {
  return readManifest({ paths, spec: onepasswordStoreSpec() });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 *
 * @internal
 */
export function readOnepasswordKindFile({
  paths,
  kind,
}: {
  paths: OnepasswordAtlasPaths;
  kind: OnepasswordKind;
}): Result<OnepasswordKindFile | null> {
  return readKindFile({ kind, paths, spec: onepasswordStoreSpec() });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readOnepasswordAtlas({ paths }: { paths: OnepasswordAtlasPaths }): Result<OnepasswordAtlasSnapshot> {
  return readAtlas({ paths, spec: onepasswordStoreSpec() });
}

/**
 * Publish a generation, with the sensitivity gate refusing before the first byte is written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest this candidate was built ON — the compare-and-swap token
 * @param denylist the private organisation words, loaded by the caller from the state home
 * @param onFindings called with every non-refusing finding, so the caller can record them as gaps
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishOnepasswordAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
  denylist,
  onFindings,
}: {
  paths: OnepasswordAtlasPaths;
  files: Readonly<Partial<Record<OnepasswordKind, OnepasswordKindFile>>>;
  manifest: OnepasswordManifest;
  derivedFrom: OnepasswordManifest | null;
  denylist: readonly string[];
  onFindings?: (input: { findings: readonly OnepasswordSensitivityFinding[] }) => void;
}): Result<readonly string[]> {
  return publishAtlas({
    files,
    manifest,
    derivedFrom,
    paths,
    spec: onepasswordStoreSpec({ denylist, files, ...(onFindings === undefined ? {} : { onFindings }) }),
  });
}

/**
 * Serialise exactly as the store writes it, for a caller that needs the bytes without writing them.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 *
 * @internal
 */
export function onepasswordAtlasJson({ value }: { value: unknown }): string {
  return atlasJson({ value });
}
