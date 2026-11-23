/**
 * Where the Google Admin atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own
 * documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`. What remains here is genuinely this
 * atlas's: where the files live, the schemas, the remedy for a superseded generation, and one refusal the
 * kit cannot make.
 *
 * ## The publish gate: no observation ever reaches a kind file
 *
 * `refuseStoredObservations` closes over the documents about to be written and refuses the WHOLE
 * generation if any of them carries a record of a kind whose disposition is `shape-index`. That is a
 * property of PUBLISHING rather than of the fetch, following Nightfall's own gate, and the reason it is
 * worth a gate here is specific to this platform: the shape-indexed kinds are the Workspace AUDIT LOG and
 * the Chrome browsing summaries — every login, every file share, every URL a person visited on a managed
 * browser. Storing that feed whole would make this atlas the densest concentration of employee behaviour
 * on the machine.
 *
 * A disposition enforced only by the code that happens to call the API is a disposition one refactor away
 * from being gone. Enforced at the file boundary, it survives the refactor.
 *
 * ## The guarded kinds are DERIVED from the registry, and getting that wrong left a hole
 *
 * The first version iterated `googleAdminObservationalKinds()` — the seven kinds `dispositions.ts` names
 * wholesale — and so never looked at `chrome-management-security-insights`, whose four
 * `queryUrlVisits`/`queryContentTransfers` operations are shape-indexed INDIVIDUALLY because the rest of
 * that kind is configuration. The kind holding the Chrome browsing summaries was the one kind the gate did
 * not guard. A Codex review found it.
 *
 * So the guarded set is now every kind the committed registry gives at least one `shape-index` row, which
 * is derived rather than restated and cannot fall out of step with the rule that produced it. **It is
 * deliberately over-broad**: a kind that mixes dispositions is guarded whole, because a stored record does
 * not say which operation produced it and the gate would rather refuse a legitimate configuration record
 * than admit one browsing summary. The day a live channel needs to store one, split the kind rather than
 * loosening this.
 *
 * ## It reads the ENTITY's own kind, not the map slot it arrived in
 *
 * The second version still looked its guarded kinds UP — `files["reports-activities"]` — which a caller
 * evades by filing an audit-event record under `files["directory-users"]`. Nothing in the schemas requires
 * the map key, the file's own `kind` and an entity's `kind` to agree, so the record would have been
 * written under a name that does not describe it and the gate would have found nothing to look at. A Codex
 * review found it.
 *
 * The gate therefore walks the files it was GIVEN and judges each entity by the kind it declares, and it
 * refuses a file whose own `kind` disagrees with the slot it arrived in — a mislabelled slot is a defect
 * whether or not anything sensitive rode in on it.
 *
 * ## It reads exactly the set the PUBLISHER reads, which is one key more than its own entries
 *
 * `kit/store.ts` publishes by looking each declared kind up — `files[kind]` — which resolves through a
 * prototype, while `Object.entries` does not. A Codex review built the gap out of
 * that: a `files` object made with `Object.create` has no own entries for the gate to walk and every
 * inherited one for the publisher to write. **No caller in this repository can produce that** — every one
 * passes an object literal or `byGoogleAdminKind`'s output — so this is not a reachable defect, and the fix
 * is taken anyway because "the gate reads what the publisher reads" is an invariant worth holding on its
 * own. A gate whose input set differs from the writer's is a gate that will eventually be wrong for a
 * reason nobody predicted.
 *
 * It refuses rather than filtering, deliberately. A gate that silently dropped the offending entities
 * would publish a generation that looked complete and was not, which is the failure mode this whole atlas
 * is built to make impossible.
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

import { GOOGLE_ADMIN_SURFACES } from "./generated/surfaces.js";
import {
  byGoogleAdminKind,
  GOOGLE_ADMIN_ATLAS_KINDS,
  GOOGLE_ADMIN_ATLAS_PLATFORM,
  GOOGLE_ADMIN_ATLAS_SCHEMA_VERSION,
  type GoogleAdminAtlasKind,
  type GoogleAdminAtlasKindFile,
  type GoogleAdminAtlasManifest,
  googleAdminAtlasKindFileSchema,
  googleAdminAtlasManifestSchema,
} from "./model.js";

/**
 * What to do about a generation published under a schema version this build no longer writes.
 * @internal
 */
export const GOOGLE_ADMIN_SUPERSEDE_REMEDY =
  "run: slopweaver atlas google-admin reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write";

/** Every path the Google Admin atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract. */
export type GoogleAdminAtlasPaths = AtlasStorePaths<GoogleAdminAtlasKind>;

/**
 * What the Google Admin atlas holds right now, as the reader sees it.
 * @internal
 */
export type GoogleAdminAtlasSnapshot = AtlasSnapshot<
  GoogleAdminAtlasKind,
  GoogleAdminAtlasKindFile,
  GoogleAdminAtlasManifest
>;

/**
 * Every kind the committed registry gives at least one `shape-index` operation.
 *
 * Derived rather than restated — see this file's header for the hole a restated list left, and for why a
 * kind that mixes dispositions is guarded whole.
 *
 * @returns the guarded kind names, sorted
 */
export function shapeIndexedKinds(): readonly string[] {
  return [
    ...new Set(GOOGLE_ADMIN_SURFACES.filter((row) => row.disposition === "shape-index").map((row) => row.kind)),
  ].toSorted();
}

/**
 * Every file the publisher would write, keyed by the slot it arrived in.
 *
 * Own entries catch a slot no declared kind names; the declared kinds catch one reachable only through a
 * prototype, which is exactly what `kit/store.ts` reads. See this file's header for why the two differ.
 *
 * @param files the kind files about to be written
 * @returns each present file with its slot, in slot order
 */
function presentFiles({
  files,
}: {
  files: Readonly<Partial<Record<GoogleAdminAtlasKind, GoogleAdminAtlasKindFile>>>;
}): readonly { readonly slot: string; readonly file: GoogleAdminAtlasKindFile }[] {
  const slots = [...new Set<string>([...Object.keys(files), ...GOOGLE_ADMIN_ATLAS_KINDS])].toSorted();
  return slots.flatMap((slot) => {
    // `as`: `slots` is this atlas's own kind list plus the caller's keys; a key naming no declared kind
    // simply reads `undefined` and contributes nothing.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const file = files[slot as GoogleAdminAtlasKind];
    return file === undefined ? [] : [{ file, slot }];
  });
}

/**
 * How many stored records of each guarded kind a generation carries, judged by each entity's OWN kind.
 *
 * @param present each file the publisher would write, with its slot
 * @param guarded the kinds the registry shape-indexes
 * @returns a count per offending kind
 */
function storedRecordsByKind({
  present,
  guarded,
}: {
  present: readonly { readonly slot: string; readonly file: GoogleAdminAtlasKindFile }[];
  guarded: ReadonlySet<string>;
}): ReadonlyMap<string, number> {
  const stored = new Map<string, number>();
  for (const entry of present) {
    for (const entity of entry.file.entities) {
      if (entity.family !== "record" || !guarded.has(entity.kind)) {
        continue;
      }
      const countedSoFar = stored.get(entity.kind);
      if (countedSoFar === undefined) {
        // The first stored record of this kind: the tally starts here.
        stored.set(entity.kind, 1);
        continue;
      }
      stored.set(entity.kind, countedSoFar + 1);
    }
  }
  return stored;
}

/**
 * Refuse a generation carrying a stored record of a shape-indexed kind.
 *
 * The check is on the DOCUMENTS rather than on the manifest, because the manifest only counts entities and
 * a count cannot tell a declared record shape from an audit event. What it branches on is the entity's own
 * declared `family` — `model.ts` carries why that is a field rather than a `providerId` prefix.
 *
 * @param files the kind files about to be written
 * @returns nothing when the generation is publishable, or why it is refused
 */
export function refuseStoredObservations({
  files,
}: {
  files: Readonly<Partial<Record<GoogleAdminAtlasKind, GoogleAdminAtlasKindFile>>>;
}): Result<null> {
  const present = presentFiles({ files });
  const mislabelled = present
    .filter((entry) => entry.file.kind !== entry.slot)
    .map(
      (entry) =>
        `the file filed under ${entry.slot} declares kind ${entry.file.kind} — a mislabelled slot, which is how a record of a shape-indexed kind reaches disk under a name that does not describe it`,
    );
  const stored = storedRecordsByKind({ guarded: new Set(shapeIndexedKinds()), present });
  const carried = [...stored.keys()]
    .toSorted()
    .map(
      (kind) =>
        `${kind} carries ${stored.get(kind)!} stored record(s) and its disposition is shape-index — docs/atlas-intent/06-holdings.md says this family is reached and its shape stored, never a row per record`,
    );
  const reasons = [...mislabelled, ...carried];
  if (reasons.length > 0) {
    return err(reasons);
  }
  return ok(null);
}

/** Everything the kit needs to read, grade and publish a Google Admin generation. */
export const GOOGLE_ADMIN_STORE_SPEC: AtlasStoreSpec<
  GoogleAdminAtlasKind,
  GoogleAdminAtlasKindFile,
  GoogleAdminAtlasManifest
> = {
  kinds: GOOGLE_ADMIN_ATLAS_KINDS,
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => googleAdminAtlasKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => googleAdminAtlasManifestSchema.safeParse(json),
  platform: GOOGLE_ADMIN_ATLAS_PLATFORM,
  schemaVersion: GOOGLE_ADMIN_ATLAS_SCHEMA_VERSION,
  supersedeRemedy: GOOGLE_ADMIN_SUPERSEDE_REMEDY,
};

/**
 * Resolve every Google Admin atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function googleAdminAtlasPaths({ home }: { home: string }): GoogleAdminAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.googleAdmin;
  return {
    directory: paths.root,
    home,
    // `!`: `atlasHome.ts` builds this map by iterating GOOGLE_ADMIN_ATLAS_KINDS, so every declared kind is
    // present. What it cannot express is a key type narrower than `string`, which is what this recovers.
    kinds: byGoogleAdminKind({ build: ({ kind }) => paths.kinds[kind]! }),
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
export function readGoogleAdminManifest({
  paths,
}: {
  paths: GoogleAdminAtlasPaths;
}): Result<GoogleAdminAtlasManifest | null> {
  return readManifest({ paths, spec: GOOGLE_ADMIN_STORE_SPEC });
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved paths
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 * @internal
 */
export function readGoogleAdminKindFile({
  paths,
  kind,
}: {
  paths: GoogleAdminAtlasPaths;
  kind: GoogleAdminAtlasKind;
}): Result<GoogleAdminAtlasKindFile | null> {
  return readKindFile({ kind, paths, spec: GOOGLE_ADMIN_STORE_SPEC });
}

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readGoogleAdminAtlas({ paths }: { paths: GoogleAdminAtlasPaths }): Result<GoogleAdminAtlasSnapshot> {
  return readAtlas({ paths, spec: GOOGLE_ADMIN_STORE_SPEC });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes
 * written.
 *
 * The observation gate runs BEFORE the kit opens a file, so a refused generation leaves nothing behind.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishGoogleAdminAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: GoogleAdminAtlasPaths;
  files: Readonly<Partial<Record<GoogleAdminAtlasKind, GoogleAdminAtlasKindFile>>>;
  manifest: GoogleAdminAtlasManifest;
  derivedFrom: GoogleAdminAtlasManifest | null;
}): Result<readonly string[]> {
  const gate = refuseStoredObservations({ files });
  if (gate.isErr()) {
    return err(gate.error);
  }
  return publishAtlas({ derivedFrom, files, manifest, paths, spec: GOOGLE_ADMIN_STORE_SPEC });
}
