/**
 * Bringing a generation written in the pre-`.jsonl` layout back into the one this build reads.
 *
 * ## Why this exists at all
 *
 * The layout moved a kind file from one pretty-printed document to an envelope line plus one entity per line,
 * and `atlasHome.ts`'s `kindFileName` normalises the extension so a platform cannot declare the old one. It
 * guarded the DECLARATION and nothing guarded the GENERATIONS already on disk: the manifest still vouched
 * for every kind, the reader looked for a `.jsonl` that was not there, and `read` answered zero entities and
 * exited 0.
 *
 * MEASURED over the real `~/.slopweaver`: atlases were in that state, holding real data —
 * Vanta's kind files held its whole generation and answered nothing. Reproduce with `slopweaver atlas doctor`.
 *
 * ## Why a repair rather than "just re-sync"
 *
 * A re-sync is the clean answer where a credential is at hand, and for several of these platforms it is
 * not — the walk half needs the owner's own Chrome, and one is behind an account nobody has signed into.
 * Re-fetching also DISCARDS a captured surface in favour of a newer one, which `docs/atlas-intent/settled-decisions.md` §
 * "accumulate never replace" is against for a format change that loses nothing. The bytes are already
 * correct; only their layout is old.
 *
 * The legacy file is ARCHIVED rather than deleted, under the platform's own `_superseded` slot, for the same
 * reason: nothing in an archive is ever removed.
 */
import { mkdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import {
  digestOfKindFile,
  readFileIfPresent,
  singleFileKindPath,
  writeAtomic,
  writeAtomicKindFile,
} from "../atlasFile.js";

import { type AtlasSidecarError, AtlasSidecarErrors } from "./sidecarErrors.js";

/** One kind whose file is on disk in the layout this build no longer reads. */
export interface SingleFileKind {
  readonly kind: string;
  /** The pre-`.jsonl` document, as it sits on disk today. */
  readonly singleFilePath: string;
  /** Where this build looks for it. */
  readonly path: string;
}

/** What one repair did to one kind. */
export interface RepairedKind {
  readonly kind: string;
  readonly entityCount: number;
  /** The digest of the bytes now on disk, which the manifest was restamped with. */
  readonly digest: string;
  /** Where the pre-`.jsonl` document was archived to. */
  readonly archivedTo: string;
}

/**
 * Which kinds are on disk only in the old layout.
 *
 * Pure over an injected existence predicate rather than reaching for the filesystem itself, so the planning
 * is unit-testable and the one place that touches disk is {@link repairSingleFileGeneration}.
 *
 * @param kinds each kind's path, as the platform's own resolver produced it
 * @param exists whether a path is on disk
 * @returns one entry per kind whose current-layout file is absent and whose legacy file is present
 */
export function planSingleFileRepair({
  kinds,
  exists,
}: {
  kinds: Readonly<Record<string, string>>;
  exists: (input: { path: string }) => boolean;
}): readonly SingleFileKind[] {
  const planned: SingleFileKind[] = [];
  for (const [kind, path] of Object.entries(kinds).toSorted(([left], [right]) => left.localeCompare(right))) {
    const singleFilePath = singleFileKindPath({ path });
    if (exists({ path }) || !exists({ path: singleFilePath })) {
      continue;
    }
    planned.push({ kind, singleFilePath, path });
  }
  return planned;
}

/**
 * Split a pre-`.jsonl` whole document into the two halves the current layout writes.
 *
 * @param document whatever the legacy file parsed to
 * @returns the envelope and its entities, or why the document is not a kind file at all
 */
export function splitSingleFileDocument({ document }: { document: unknown }): Result<
  {
    envelope: Record<string, unknown>;
    entities: readonly unknown[];
  },
  AtlasSidecarError
> {
  if (!isRecord(document)) {
    return err(AtlasSidecarErrors.singleFileNotObject());
  }
  const entities = document["entities"];
  if (!Array.isArray(entities)) {
    return err(AtlasSidecarErrors.singleFileNoEntities());
  }
  return ok({ entities, envelope: { ...document, entities: [] } });
}

/** Restamp one kind's manifest cell with the digest and count of the bytes just written. */
function restampManifest({
  manifest,
  repaired,
}: {
  manifest: Record<string, unknown>;
  repaired: readonly RepairedKind[];
}): Result<Record<string, unknown>, AtlasSidecarError> {
  const kinds = manifest["kinds"];
  if (!isRecord(kinds)) {
    return err(AtlasSidecarErrors.manifestKindsMissing());
  }
  const stamped: Record<string, unknown> = { ...kinds };
  for (const kind of repaired) {
    const cell = stamped[kind.kind];
    if (!isRecord(cell)) {
      return err(AtlasSidecarErrors.manifestCellMissing({ kind: kind.kind }));
    }
    stamped[kind.kind] = { ...cell, digest: kind.digest, entityCount: kind.entityCount };
  }
  return ok({ ...manifest, kinds: stamped });
}

/**
 * Which of every kind's current and legacy files are on disk, read before the repair writes anything. A file
 * that is there but cannot be read — a dangling link on its path, say — refuses the whole repair here, since
 * planning it as absent would rewrite and archive every other kind before anything noticed.
 */
function presentKindFiles({
  kinds,
}: {
  kinds: Readonly<Record<string, string>>;
}): Result<ReadonlySet<string>, AtlasSidecarError> {
  const present = new Set<string>();
  const unreadable: string[] = [];
  for (const path of Object.values(kinds).flatMap((kindPath) => [kindPath, singleFileKindPath({ path: kindPath })])) {
    const read = readFileIfPresent({ path });
    if (read.isErr()) {
      unreadable.push(...read.error);
    } else if (read.value !== null) {
      present.add(path);
    }
  }
  return unreadable.length > 0 ? err(AtlasSidecarErrors.upstreamFailed({ reasons: unreadable })) : ok(present);
}

/** One planned kind, read, split and digested before anything is written. */
interface PreparedKind {
  readonly entry: SingleFileKind;
  readonly envelope: Record<string, unknown>;
  readonly entities: readonly unknown[];
  readonly repaired: RepairedKind;
}

/**
 * Rewrite every legacy kind file of one atlas into the current layout, and restamp its manifest.
 *
 * Nothing is fetched and nothing is discarded: each document's own entities are written back a record at a
 * time, the manifest cell it belongs to is restamped with the digest of those bytes, and the old document is
 * moved into the platform's `_superseded` slot. Every input — each kind file, each legacy document and the
 * manifest — is read, parsed and checked BEFORE the first write, so a refusal never leaves a half-repaired
 * generation behind.
 *
 * @param paths this platform's resolved atlas paths
 * @param nowIso the instant that names the archive directory
 * @returns one entry per kind repaired, or every reason the repair stopped
 */
export function repairSingleFileGeneration({
  paths,
  nowIso,
}: {
  paths: { readonly kinds: Readonly<Record<string, string>>; readonly manifest: string; readonly superseded: string };
  nowIso: string;
}): Result<readonly RepairedKind[], AtlasSidecarError> {
  const present = presentKindFiles({ kinds: paths.kinds });
  if (present.isErr()) {
    return err(present.error);
  }
  const planned = planSingleFileRepair({ exists: ({ path }) => present.value.has(path), kinds: paths.kinds });
  if (planned.length === 0) {
    return ok([]);
  }
  const archive = join(paths.superseded, `legacy-json-${nowIso.replaceAll(":", "-")}`);
  const prepared: PreparedKind[] = [];
  for (const entry of planned) {
    const one = prepareOneKind({ archive, entry });
    if (one.isErr()) {
      return err(one.error);
    }
    prepared.push(one.value);
  }
  const repaired = prepared.map((kind) => kind.repaired);
  const manifest = readManifest({ manifestPath: paths.manifest }).andThen((parsed) =>
    restampManifest({ manifest: parsed, repaired }),
  );
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  for (const kind of prepared) {
    const written = writeOneKind({ archive, kind });
    if (written.isErr()) {
      return err(written.error);
    }
  }
  return writeAtomic({ path: paths.manifest, value: manifest.value })
    .mapErr((reasons) => AtlasSidecarErrors.upstreamFailed({ reasons }))
    .map(() => repaired);
}

/**
 * Read and split one kind's legacy document, and work out what repairing it will record — no write.
 *
 * @param entry the kind, its legacy path and where this build reads it
 * @param archive the directory this run's replaced documents are moved into
 * @returns the split document and its repair record, or why this kind refuses the repair
 */
function prepareOneKind({
  entry,
  archive,
}: {
  entry: SingleFileKind;
  archive: string;
}): Result<PreparedKind, AtlasSidecarError> {
  const text = readFileIfPresent({ path: entry.singleFilePath });
  if (text.isErr()) {
    return err(AtlasSidecarErrors.upstreamFailed({ reasons: text.error }));
  }
  if (text.value === null) {
    return err(AtlasSidecarErrors.singleFileVanished({ path: entry.singleFilePath }));
  }
  const document = parseRepairInput({
    label: `the legacy ${entry.kind} kind file`,
    path: entry.singleFilePath,
    text: text.value,
  });
  if (document.isErr()) {
    return err(document.error);
  }
  const split = splitSingleFileDocument({ document: document.value });
  if (split.isErr()) {
    return err(AtlasSidecarErrors.singleFileRefused({ cause: split.error, path: entry.singleFilePath }));
  }
  const { envelope, entities } = split.value;
  return ok({
    entities,
    entry,
    envelope,
    repaired: {
      archivedTo: join(archive, basename(entry.singleFilePath)),
      digest: digestOfKindFile({ entities, envelope }),
      entityCount: entities.length,
      kind: entry.kind,
    },
  });
}

/**
 * Write one prepared kind in the current layout and archive the document it replaced.
 *
 * @param kind what {@link prepareOneKind} read
 * @param archive the directory this run's replaced documents are moved into
 * @returns nothing on success, or why the write or the archive failed
 */
function writeOneKind({ kind, archive }: { kind: PreparedKind; archive: string }): Result<null, AtlasSidecarError> {
  const { entry, envelope, entities } = kind;
  const written = writeAtomicKindFile({ entities, envelope, path: entry.path });
  if (written.isErr()) {
    return err(AtlasSidecarErrors.upstreamFailed({ reasons: written.error }));
  }
  try {
    mkdirSync(archive, { recursive: true });
    renameSync(entry.singleFilePath, kind.repaired.archivedTo);
  } catch (error: unknown) {
    return err(
      AtlasSidecarErrors.singleFileNotArchived({
        cause: error,
        singleFilePath: entry.singleFilePath,
        path: entry.path,
      }),
    );
  }
  return ok(null);
}

/**
 * Read the generation's manifest as an object, before the repair writes anything.
 *
 * @param manifestPath the generation's manifest
 * @returns the parsed manifest, or why it cannot be restamped
 */
function readManifest({ manifestPath }: { manifestPath: string }): Result<Record<string, unknown>, AtlasSidecarError> {
  const manifestText = readFileIfPresent({ path: manifestPath });
  if (manifestText.isErr()) {
    return err(AtlasSidecarErrors.upstreamFailed({ reasons: manifestText.error }));
  }
  if (manifestText.value === null) {
    return err(AtlasSidecarErrors.manifestAbsent({ path: manifestPath }));
  }
  const parsed = parseRepairInput({ label: "an atlas manifest", path: manifestPath, text: manifestText.value });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  if (!isRecord(parsed.value)) {
    return err(AtlasSidecarErrors.manifestNotObject({ path: manifestPath }));
  }
  return ok(parsed.value);
}

/** One file the repair reads, parsed as JSON — a malformed one refused by its path, never thrown. */
function parseRepairInput({
  label,
  path,
  text,
}: {
  label: string;
  path: string;
  text: string;
}): Result<unknown, AtlasSidecarError> {
  try {
    return ok(safeJsonParse({ label, text }));
  } catch (error: unknown) {
    return err(AtlasSidecarErrors.repairInputNotJson({ cause: error, path }));
  }
}
