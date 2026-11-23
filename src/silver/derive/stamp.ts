/**
 * The effectful edge of the freshness contract: observe what the sources hold, and read/write the stamp that
 * records what derive was built from.
 *
 * Everything here is behind `safeFs`, so a missing home observes as zeroes rather than throwing — and zeroes
 * compare as "moved" against any real source, which fails toward re-deriving rather than toward sending
 * against state nobody measured.
 *
 * The observation is deliberately cheap: one `readdir` plus a `stat` per bronze window file, three `stat`s
 * per source, and one small JSON read per source's cursor. No bronze record is parsed and no digest is
 * computed, because this runs on every mention resolution. {@link observeCorpus} is the one dearer walk, and
 * only a derive takes it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { absentAsNull } from "#lib/absent.js";
import { bronzeSourceDir, memberFile, silverIndexDir, structureFile } from "../../corpus/corpusPaths.js";
import { resolveCorpusScan } from "../../corpus/corpusResolve.js";
import type { CorpusSource } from "../../corpus/types.js";
import { readWatermark } from "../../corpus/watermark.js";
import { writeJsonFile } from "../../lib/jsonFile.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { stateHomePaths } from "../../stateHome.js";
import type { IdentitySource } from "../identity.js";
import {
  type ArtefactWitness,
  type CorpusWitness,
  type FreshnessObservation,
  type FreshnessStamp,
  parseFreshnessStamp,
  type SourceWitness,
  witnessMap,
} from "./freshness.js";

/**
 * The stamp derive writes beside `identities.json`.
 *
 * @param home the Slopweaver home
 * @returns the absolute path to the freshness stamp
 */
export function freshnessStampPath({ home }: { home: string }): string {
  return join(silverIndexDir({ home }), "freshness.json");
}

/** A file's size in bytes, or 0 when it does not exist. */
function sizeOf({ path }: { path: string }): number {
  const stat = safeFs({ execute: () => statSync(path), operation: "statForFreshness", path });
  return stat.isOk() && stat.value.isFile() ? stat.value.size : 0;
}

/** How many files one bronze source dir holds, and their total size. Missing dir ⇒ zero of both. */
function bronzeExtent({ dir }: { dir: string }): { files: number; bytes: number } {
  const listed = safeFs({
    execute: () => readdirSync(dir, { withFileTypes: true }),
    operation: "readdirForFreshness",
    path: dir,
  });
  if (listed.isErr()) {
    return { bytes: 0, files: 0 };
  }
  const files = listed.value.filter((entry) => entry.isFile());
  return {
    bytes: files.reduce((total, entry) => total + sizeOf({ path: join(dir, entry.name) }), 0),
    files: files.length,
  };
}

/** The identity-lane name for a source, or undefined for `gold`, which has no member/structure lane. */
function identityLane({ source }: { source: CorpusSource }): IdentitySource | undefined {
  return source === "gold" ? undefined : source;
}

/** Witness ONE source: its resume cursor plus the size of everything derive reads for it. */
function observeSource({ home, source }: { home: string; source: CorpusSource }): SourceWitness {
  const extent = bronzeExtent({ dir: bronzeSourceDir({ home, source }) });
  const identitySource = identityLane({ source });
  return {
    bronzeBytes: extent.bytes,
    bronzeFiles: extent.files,
    cursorIso: absentAsNull({ value: readWatermark({ home, source }) }),
    memberBytes: identitySource === undefined ? 0 : sizeOf({ path: memberFile({ home, source: identitySource }) }),
    structureBytes:
      identitySource === undefined ? 0 : sizeOf({ path: structureFile({ home, source: identitySource }) }),
  };
}

/**
 * Witness every source derive reads, plus the human override roster and the sync-author denylist. The corpus
 * tree is left unwitnessed (`corpus: null`): a send does not compare it, so it does not pay for the walk.
 *
 * The roster is witnessed by the revision of the snapshot the CALLER already read, never by a read of its own:
 * the records a derive or a send resolves people with and the revision it stamps or compares must be the same
 * snapshot, or a replacement landing between two reads would stamp an artefact with a roster that did not build it.
 *
 * @param home the Slopweaver home
 * @param rosterRevision the identity roster revision of the snapshot this operation reads its records from; null
 *   when the store holds no roster row
 * @returns the observation to stamp or to compare against one
 */
export function observeSources({
  home,
  rosterRevision,
}: {
  home: string;
  rosterRevision: number | null;
}): FreshnessObservation {
  const paths = stateHomePaths({ home });
  return {
    corpus: null,
    exclusionBytes: sizeOf({ path: paths.syncAuthorDenylist }),
    overrideRevision: rosterRevision,
    sources: witnessMap({ of: (source) => observeSource({ home, source }) }),
  };
}

/**
 * Witness the tree derive's corpus reader walks: the same root `resolveCorpusDir` resolves and the same
 * recursive `.jsonl` scan, so whatever the reader would load, this counts. A recursive `stat` walk — dearer than
 * {@link observeSources}, so only a derive and a refresh deciding whether to derive take it.
 *
 * A tree the owner's protect list refuses is not walked and not witnessed: `null`, which `silverCurrency` reads as a
 * rebuild, and the derive that follows refuses with the protect list's own line rather than reading the tree.
 *
 * @param corpus an explicit corpus directory, when the derive overrides the home's own bronze
 * @returns the resolved root, its `.jsonl` file count and bytes, and how many paths could not be listed, or `null`
 *   when the protect list refuses the walk
 */
export function observeCorpus({ home, corpus }: { home: string; corpus?: string }): CorpusWitness | null {
  const resolved = resolveCorpusScan({ home, ...(corpus !== undefined ? { corpus } : {}) });
  if (resolved.isErr()) {
    return null;
  }
  const scan = resolved.value;
  return {
    bytes: scan.diskBytes,
    files: scan.fileCount,
    root: scan.dir,
    unreadable: scan.unreadableDirs.length,
  };
}

/**
 * One artefact file's exact size and modification time — what the stamp records as written and what refresh
 * pairs against it.
 *
 * @param path the artefact file
 * @returns its witness, or undefined when it cannot be stat'd
 */
export function readArtefactWitness({ path }: { path: string }): ArtefactWitness | undefined {
  const stat = safeFs({ execute: () => statSync(path), operation: "readArtefactWitness", path });
  if (stat.isErr()) {
    return undefined;
  }
  return { bytes: stat.value.size, mtimeMs: stat.value.mtimeMs };
}

/**
 * Read the stamp beside the derived roster.
 *
 * @param home the Slopweaver home
 * @returns the stamp, or undefined when it is missing or not a stamp
 */
export function readFreshnessStamp({ home }: { home: string }): FreshnessStamp | undefined {
  const path = freshnessStampPath({ home });
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readFreshnessStamp", path });
  return read.isOk() ? parseFreshnessStamp({ content: read.value }) : undefined;
}

/**
 * Write the stamp. Called by whatever derives silver, in the same step as the artefacts — a stamp written
 * anywhere else could describe a derive that did not happen.
 *
 * @param home the Slopweaver home
 * @param observation what the sources held when this derive read them
 * @param observedAtIso when that observation was taken, read just before it
 * @param derivedAtIso when the derive ran
 * @param artefacts each artefact this derive wrote, as `stat` saw it straight after; null when it wrote none
 * @returns the path written
 */
export function writeFreshnessStamp({
  home,
  observation,
  observedAtIso,
  derivedAtIso,
  artefacts,
}: {
  home: string;
  observation: FreshnessObservation;
  observedAtIso: string;
  derivedAtIso: string;
  artefacts: Readonly<Record<string, ArtefactWitness>> | null;
}): string {
  const path = freshnessStampPath({ home });
  const stamp: FreshnessStamp = { ...observation, artefacts, derivedAtIso, observedAtIso, version: 1 };
  writeJsonFile({ path, value: stamp });
  return path;
}
