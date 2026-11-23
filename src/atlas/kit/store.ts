/**
 * The generation protocol every atlas publishes through, and the reads that refuse to trust it.
 *
 * Every kind file first, the manifest LAST because it names them, a digest per file so a later interrupted
 * publication is detectable rather than silent, and every document validated before the first byte is
 * written — so a manifest that would not parse leaves no orphan files behind it.
 *
 * ## Whole-or-nothing, because detectable is not recoverable
 *
 * The install order above says which file a reader trusts. It never said what survives a failure, and for a
 * while nothing did: each kind file was written straight over its destination, so a failure on the second of
 * two kinds left the FIRST one holding the new generation under the OLD manifest, and `readAtlas` graded
 * the last-known-good generation `mismatched` — not stale, unreadable. `./generationSwap.ts` is what
 * publishes now: every file is staged beside its own destination, and only once the whole generation is on
 * disk is the set installed by rename, with the previous bytes parked so a failed install rolls back. That
 * module's header carries the falsifier and the one residue this does not close.
 *
 * ## A manifest is a `.json`; a kind file is a `.jsonl`
 *
 * The manifest is bounded — one status cell per kind — so it stays one pretty-printed document. A kind file
 * is bounded by the TENANT rather than by this code, and one Cloudflare account proved that with a
 * `pages-project` document past what one JS string may safely hold, so it is written and read a record at a time. `atlas/atlasFile.ts`'s header
 * carries the measurement and the layout; what matters here is that the two halves never separate: the
 * envelope written on line 1 and the entities after it are produced by {@link kindFileParts}, hashed by
 * `digestOfKindFile` and reassembled by {@link assembleKindDocument}, so the digest the manifest vouches for
 * is the bytes on disk and the document a schema validates is the document that was published.
 *
 * ## Why this is generic rather than copied a third time
 *
 * Two atlases had written these ~350 lines each, sharing 155 of them verbatim, and the third was going to
 * copy whichever directory its author opened first. The parts that genuinely differ are small and are
 * parameters here: which kinds exist, what a kind file and manifest look like, whether the platform has a
 * reason to REFUSE a publish that the kit cannot know about ({@link AtlasStoreSpec.guardPublish} — one
 * atlas must never republish under a different account than the generation it is replacing), and how it
 * grades a kind that has a file but no recorded success ({@link AtlasStoreSpec.gradeNeverSucceeded} — one
 * atlas can tell an honest first-run failure from a half-write, because its own sync stamps every attempt).
 *
 * ## Two things a schema cannot see, refused here
 *
 * A manifest and its files can each parse while contradicting each other, and both halves of that were
 * reachable. A kind's status can claim entities or a success while carrying no DIGEST — which happens
 * whenever a platform stamps a success for a kind it did not hand to a PARTIAL publish, and the read side
 * then digests the untouched file against its own untouched digest and answers `agrees`. And a kind file can
 * hold an entity belonging to another kind, because a platform's schema validates one shape and the kinds
 * sharing a shape are exactly the ones a mis-routed projection moves between. `storeCoherence.ts`'s
 * {@link incoherentKinds} and {@link kindDisagreements} refuse both, at publish and — for the second — on
 * every read.
 *
 * ## Re-syncable by design
 *
 * A publish is a whole-generation replace, not an append, and it is idempotent: running it twice over the
 * same data writes identical bytes, because {@link stableJson} sorts keys and every caller sorts its own
 * arrays. That is what makes a single-command full resync cheap rather than a special mode — the data
 * drifts, a captured surface is stale within the month, and an atlas that could only be built once would be
 * wrong for longer than it was right.
 */
import { existsSync } from "node:fs";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import {
  digestOfKindFile,
  readFileIfPresent,
  readKindFileIfPresent,
  singleFileKindPath,
  stableJson,
} from "../atlasFile.js";

import { type AtlasGenerationError, AtlasGenerationErrors, atlasGenerationErrorLines } from "./generationErrors.js";
import type { AtlasKindStatus } from "./kindStatus.js";
import type { AtlasKindObligations } from "./mandatoryKinds.js";
// biome-ignore lint/correctness/noUnusedImports: `incoherentKinds` is named by this file's {@link}, which Biome does not count as a use
import { incoherentKinds, kindDisagreements } from "./storeCoherence.js";
import { supersedeAdvice } from "./supersedeAdvice.js";
import type { AtlasVolumeDeclaration } from "./volume.js";

/**
 * Carry one kind's assembled file, its manifest status and whatever the platform reports, as one value.
 *
 * The last four lines of every fold — check the assemble, then return the file beside its status and its
 * report — were byte-identical across two atlases and both of their surfaces. What differs is everything
 * ABOVE it: which coverage cell, which gaps, which entities. So the shared part is this join, and the
 * platform keeps the decisions.
 *
 * @param assembled the kind file this fold built, or why it is not storable
 * @param status the manifest status to stamp for the kind
 * @param outcome whatever the platform's own run report carries for this kind
 * @returns the three together, or the reason the file could not be assembled
 */
export function foldedKind<TFile, TOutcome>({
  assembled,
  status,
  outcome,
}: {
  assembled: Result<TFile>;
  status: AtlasKindStatus;
  outcome: TOutcome;
}): Result<{ file: TFile; status: AtlasKindStatus; outcome: TOutcome }> {
  if (assembled.isErr()) {
    return err(assembled.error);
  }
  return ok({ file: assembled.value, outcome, status });
}

/** The minimum a manifest must expose for the kit to grade and stamp it. */
export interface AtlasManifestLike<TKind extends string> {
  readonly kinds: Readonly<Record<TKind, AtlasKindStatus>>;
  readonly schemaVersion: number;
  /**
   * Set by {@link publishAtlas} from the files it publishes, never by a caller — see `manifestClock.ts`.
   * Declared here so a manifest that carries no clock at all cannot reach the store.
   */
  readonly updatedAt: string;
}

/** The minimum a kind file must expose for the kit to count and digest it. */
export interface AtlasKindFileLike {
  readonly entities: readonly { readonly id: string }[];
  readonly schemaVersion: number;
  /** This file's own clock, and the ONLY source the manifest's is derived from — see `manifestClock.ts`. */
  readonly updatedAt: string;
}

/** The shape a Zod `safeParse` returns, depended on structurally so the kit imports no schema library. */
type AtlasParseOutcome<TValue> =
  | { success: true; data: TValue }
  | {
      success: false;
      error: { issues: readonly { path: readonly (string | number | symbol)[]; message: string }[] };
    };

/** Every path one atlas owns. */
export interface AtlasStorePaths<TKind extends string> {
  readonly directory: string;
  /**
   * The state home these paths were resolved from, carried rather than recovered.
   *
   * {@link publishAtlas} takes the publication lock under it on EVERY publish, so this is not a
   * convenience field: without it mutual exclusion would be optional again, because only the resolver that
   * built these paths knows the home they came from. Walking two segments up from `directory` would be an
   * arithmetic that a platform laying its generation out differently breaks silently.
   */
  readonly home: string;
  readonly kinds: Readonly<Record<TKind, string>>;
  readonly manifest: string;
  readonly superseded: string;
}

/** What a platform tells the kit about its own documents. */
export interface AtlasStoreSpec<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
> {
  /** Iterated by every read and write, so a generation is never derived from a directory listing. */
  readonly kinds: readonly TKind[];
  readonly parseKindFile: (input: { json: unknown }) => AtlasParseOutcome<TFile>;
  readonly parseManifest: (input: { json: unknown }) => AtlasParseOutcome<TManifest>;
  readonly platform: string;
  readonly schemaVersion: number;
  /** What to tell an operator holding a generation this build can no longer write. */
  readonly supersedeRemedy: string;
  /**
   * What each kind is worth to a publish — REQUIRED, and required is the whole point.
   *
   * Owner ruling: a change made for one atlas is made so that it applies to all atlases. A required field
   * on this spec is that rule in the type system — a new atlas cannot reach `publishAtlas` without having
   * decided, per kind, whether the generation may be published without it. The same shape one level up: the
   * code makes it structurally impossible to have an integration or atlas that has no policy set.
   *
   * `mandatory` names the publish GROUP that fills the kind; `optional` carries a reason. See
   * `./mandatoryKinds.ts` for why the grouping is load-bearing rather than ceremony.
   */
  readonly kindObligations: AtlasKindObligations<TKind>;
  /**
   * Which families are highly voluminous — REQUIRED, for the same reason {@link kindObligations} is.
   *
   * Owner ruling: an atlas holds everything reachable EXCEPT highly voluminous data, which is stored
   * as a catalogued SHAPE and never as a row per record, and the rule applies to every atlas. A required
   * field is that rule in the type system. `./volume.ts` carries the criterion, the measurement that
   * forced this field, and why an atlas with nothing voluminous declares `{ verdicts: [] }`.
   */
  readonly kindVolumes: AtlasVolumeDeclaration<TKind>;
  /** A platform-specific reason to refuse a publish. Omitted when the platform has none. */
  readonly guardPublish?: (input: { prior: TManifest | null; next: TManifest }) => Result<null>;
  /**
   * How to grade a kind file that exists while the manifest records no SUCCESS for it. Omitted takes the
   * kit default — `unpublished`, a half-written first generation.
   *
   * A platform that stamps `lastAttempt` on every run, success or failure, can tell the two apart: a
   * recorded failed attempt means the manifest and the file honestly agree on "not yet synced", and only a
   * kind the manifest has NO record of ever attempting is a genuine half-write. That is a fact about how a
   * platform's own sync writes its manifest, which is exactly what the kit cannot know.
   */
  readonly gradeNeverSucceeded?: (input: { status: AtlasKindStatus | null }) => "unpublished" | "agrees";
}

/** What an atlas holds right now, as the reader sees it. */
export interface AtlasSnapshot<TKind extends string, TFile, TManifest> {
  readonly files: Readonly<Record<TKind, TFile | null>>;
  readonly manifest: TManifest | null;
  /** The manifest vouches for it and the file is gone. Corruption, not emptiness. */
  readonly missing: readonly TKind[];
  /**
   * This build's `.jsonl` is absent and the previous format's `.json` sibling is sitting beside it — a
   * generation the layout left behind, never one that is gone. The distinction cannot be recovered further
   * up: a view carries what a kind HOLDS, and this is a fact about what is on disk under a name the reader
   * no longer looks under, so the store is the only place that can see it.
   */
  readonly superseded: readonly TKind[];
  /**
   * The file is not the one the manifest published — a later generation under earlier metadata, or a kind
   * that claims a success while its status carries no digest at all, so nothing on disk can be vouched for.
   */
  readonly mismatched: readonly TKind[];
  /** A file on disk the manifest does not vouch for — a half-written first generation. */
  readonly unpublished: readonly TKind[];
}

/** Read and JSON-parse a whole file — the manifest's shape. Distinguishes absent from unreadable from malformed. */
function readJsonIfPresent({ path }: { path: string }): Result<unknown | null, AtlasGenerationError> {
  const raw = readFileIfPresent({ path });
  if (raw.isErr()) {
    return err(AtlasGenerationErrors.sourceUnreadable({ reasons: raw.error }));
  }
  if (raw.value === null) {
    return ok(null);
  }
  try {
    return ok(JSON.parse(raw.value));
  } catch {
    return err(AtlasGenerationErrors.notJson({ path }));
  }
}

/** Whether a parsed document declares a schema version this build does not write. */
function foreignSchemaVersion({ parsed, schemaVersion }: { parsed: unknown; schemaVersion: number }): number | null {
  if (parsed === null || typeof parsed !== "object" || !("schemaVersion" in parsed)) {
    return null;
  }
  const declared = parsed.schemaVersion;
  return typeof declared === "number" && declared !== schemaVersion ? declared : null;
}

/** Validate already-parsed JSON against a platform's schema, naming the path and platform on refusal. */
function validateDocument<TValue>({
  json,
  path,
  platform,
  parse,
}: {
  json: unknown;
  path: string;
  platform: string;
  parse: (input: { json: unknown }) => AtlasParseOutcome<TValue>;
}): Result<TValue, AtlasGenerationError> {
  const parsed = parse({ json });
  if (!parsed.success) {
    return err(AtlasGenerationErrors.schemaUnsatisfied({ issues: parsed.error.issues, path, platform }));
  }
  return ok(parsed.data);
}

/** Read one document, refusing a foreign schema version loudly rather than as a generic validation error. */
function readDocument<TValue>({
  path,
  spec,
  parse,
}: {
  path: string;
  spec: { platform: string; schemaVersion: number; supersedeRemedy: string };
  parse: (input: { json: unknown }) => AtlasParseOutcome<TValue>;
}): Result<TValue | null, AtlasGenerationError> {
  const parsed = readJsonIfPresent({ path });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  if (parsed.value === null) {
    return ok(null);
  }
  const foreign = foreignSchemaVersion({ parsed: parsed.value, schemaVersion: spec.schemaVersion });
  if (foreign !== null) {
    const advice = supersedeAdvice({ found: foreign, spec });
    return err(
      AtlasGenerationErrors.foreignSchemaVersion({ advice, found: foreign, path, writes: spec.schemaVersion }),
    );
  }
  return validateDocument({ json: parsed.value, parse, path, platform: spec.platform });
}

/**
 * Split a kind file into the two halves its `.jsonl` layout writes: the envelope — the document with its
 * entities emptied — and the entities themselves. One definition, so the writer, the digest and the reader
 * cannot disagree about where the boundary is. Exported for `./publish.ts`, which stamps the digest from
 * exactly these bytes, and for the 1Password atlas's publish guard, which scans those same lines one at a time
 * rather than the whole document as one string.
 *
 * @returns the envelope written on line 1, and the entities written one per line after it
 * @internal
 */
export function kindFileParts<TFile extends AtlasKindFileLike>({
  file,
}: {
  file: TFile;
}): { envelope: unknown; entities: readonly unknown[] } {
  return { entities: file.entities, envelope: { ...file, entities: [] } };
}

/**
 * Put a kind file's lines back together into the one document a platform's schema validates. A non-record
 * envelope is handed on unchanged rather than merged into, so the schema reports what is actually wrong
 * with the file instead of a synthesised shape that hides it.
 */
function assembleKindDocument({ envelope, entities }: { envelope: unknown; entities: readonly unknown[] }): unknown {
  return isRecord(envelope) ? { ...envelope, entities } : envelope;
}

/**
 * Read one kind file's `.jsonl`, refusing a foreign schema version loudly rather than as a generic
 * validation error — {@link readDocument}'s contract over the streamed layout.
 */
function readKindDocument<TValue>({
  path,
  spec,
  parse,
  kind,
}: {
  path: string;
  spec: { platform: string; schemaVersion: number; supersedeRemedy: string };
  parse: (input: { json: unknown }) => AtlasParseOutcome<TValue>;
  kind: string;
}): Result<TValue | null, AtlasGenerationError> {
  const parts = readKindFileIfPresent({ path });
  if (parts.isErr()) {
    return err(AtlasGenerationErrors.sourceUnreadable({ reasons: parts.error }));
  }
  if (parts.value === null) {
    return ok(null);
  }
  const document = assembleKindDocument(parts.value);
  const foreign = foreignSchemaVersion({ parsed: document, schemaVersion: spec.schemaVersion });
  if (foreign !== null) {
    const advice = supersedeAdvice({ found: foreign, spec });
    return err(
      AtlasGenerationErrors.foreignSchemaVersion({ advice, found: foreign, path, writes: spec.schemaVersion }),
    );
  }
  const misrouted = kindDisagreements({ document, kind });
  if (misrouted.length > 0) {
    return err(AtlasGenerationErrors.kindMisfiled({ kind, misrouted, path }));
  }
  return validateDocument({ json: document, parse, path, platform: spec.platform });
}

/**
 * Read the manifest — the authority on what has been published.
 *
 * @param paths the resolved atlas paths
 * @param spec the platform's own document contract
 * @returns the manifest, `null` when nothing has been published, or why it cannot be read
 */
export function readManifest<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  paths,
  spec,
}: {
  paths: AtlasStorePaths<TKind>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
}): Result<TManifest | null> {
  return readDocument({ parse: spec.parseManifest, path: paths.manifest, spec }).mapErr((error) =>
    atlasGenerationErrorLines({ error }),
  );
}

/**
 * Read one kind's file.
 *
 * @param paths the resolved atlas paths
 * @param spec the platform's own document contract
 * @param kind which kind to read
 * @returns the file, `null` when absent, or why it cannot be read
 */
export function readKindFile<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  paths,
  spec,
  kind,
}: {
  paths: AtlasStorePaths<TKind>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
  kind: TKind;
}): Result<TFile | null> {
  return readKindDocument({ kind, parse: spec.parseKindFile, path: paths.kinds[kind], spec }).mapErr((error) =>
    atlasGenerationErrorLines({ error }),
  );
}

/**
 * Whether the previous format's file for this kind is on disk — the one fact that separates a generation
 * the layout left behind from a generation that is gone.
 *
 * Stat'd only where this build's own `.jsonl` is already absent, so an ordinary read costs nothing extra.
 */
function singleFileKindExists({ path }: { path: string }): boolean {
  return existsSync(singleFileKindPath({ path }));
}

/**
 * Judge one kind's file against what the manifest published. Pure and total — whether the previous format's
 * file is on disk is decided by {@link readAtlas}, which is the half that touches a filesystem.
 */
function gradeKind<TFile extends AtlasKindFileLike>({
  file,
  status,
  singleFilePresent,
  gradeNeverSucceeded,
}: {
  file: TFile | null;
  status: AtlasKindStatus | null;
  singleFilePresent: boolean;
  gradeNeverSucceeded: ((input: { status: AtlasKindStatus | null }) => "unpublished" | "agrees") | undefined;
}): "agrees" | "unpublished" | "missing" | "mismatched" | "superseded" {
  const published = status === null ? null : status.lastSuccessAt;
  if (file === null) {
    if (singleFilePresent) {
      return "superseded";
    }
    return published === null ? "agrees" : "missing";
  }
  if (status === null || published === null) {
    return gradeNeverSucceeded === undefined ? "unpublished" : gradeNeverSucceeded({ status });
  }
  const digest = status.digest;
  if (digest === null) {
    // A kind claiming a success while vouching for no bytes is the silent half of this grade: the file on
    // disk may be anything at all and no comparison can say. `publishAtlas` refuses to write one, so this
    // arm only ever grades a generation written before that guard — never a fresh one.
    return "mismatched";
  }
  return digestOfKindFile(kindFileParts({ file })) === digest ? "agrees" : "mismatched";
}

/**
 * Read the whole atlas, iterating the platform's kind list rather than the directory.
 *
 * @param paths the resolved atlas paths
 * @param spec the platform's own document contract
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readAtlas<
  TKind extends string,
  TFile extends AtlasKindFileLike,
  TManifest extends AtlasManifestLike<TKind>,
>({
  paths,
  spec,
}: {
  paths: AtlasStorePaths<TKind>;
  spec: AtlasStoreSpec<TKind, TFile, TManifest>;
}): Result<AtlasSnapshot<TKind, TFile, TManifest>> {
  const manifest = readManifest({ paths, spec });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  // `as`: Object.fromEntries widens keys to string; this was built from the platform's own exhaustive kind
  // list, so the narrower TKind-keyed type is sound.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const files = Object.fromEntries(spec.kinds.map((kind) => [kind, null])) as Record<TKind, TFile | null>;
  const errors: string[] = [];
  const graded: Record<"unpublished" | "missing" | "mismatched" | "superseded", TKind[]> = {
    mismatched: [],
    missing: [],
    superseded: [],
    unpublished: [],
  };
  for (const kind of spec.kinds) {
    const file = readKindFile({ kind, paths, spec });
    if (file.isErr()) {
      errors.push(...file.error);
      continue;
    }
    files[kind] = file.value;
    const grade = gradeKind({
      file: file.value,
      gradeNeverSucceeded: spec.gradeNeverSucceeded,
      singleFilePresent: file.value === null && singleFileKindExists({ path: paths.kinds[kind] }),
      status: manifest.value === null ? null : manifest.value.kinds[kind],
    });
    if (grade !== "agrees") {
      graded[grade].push(kind);
    }
  }
  return errors.length > 0 ? err(errors) : ok({ files, manifest: manifest.value, ...graded });
}

/**
 * Serialise as the store writes a MANIFEST, for a caller that needs the bytes without writing them. A kind
 * file no longer has a single-document form on disk — see this module's header — so a caller reaching for
 * this to inspect one is reading the shape the kit assembles in memory, not the file.
 *
 * @param value the document to serialise
 * @returns the stable, pretty-printed JSON
 */
export function atlasJson({ value }: { value: unknown }): string {
  return stableJson({ value });
}
