/**
 * Walk an extracted zip — the SAME extraction the direct proof scans (`./referenceExport.ts`) — and collect every
 * indirect candidate place (`./indirectScan.ts`): every candidate-map row over every file's text and path, and the
 * dictionary harvest over every text file it does not skip. An extraction holding a different number of entries
 * than the commit is refused, exactly as the direct walk refuses it.
 */
import { isUtf8 } from "node:buffer";
import { type Dirent, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";

import { appendAll } from "../lib/arrays.js";
import { err, ok, type Result } from "../lib/result.js";
import type { IndirectMapRow } from "./indirectMap.js";
import { type HarvestDictionary, harvestPlaces, type IndirectPlace, scanCandidateMap } from "./indirectScan.js";
import { type ReferenceExportError, ReferenceExportErrors } from "./referenceExportErrors.js";

/** What one walk found: every place, and how many files it read and how many of those were binary. */
export interface IndirectTreeScan {
  readonly filesScanned: number;
  readonly binaryFiles: number;
  readonly harvestSkipped: number;
  readonly places: readonly IndirectPlace[];
}

/**
 * Paths the harvest does not read, each for a stated reason. The candidate map still reads every one of them.
 * A generated atlas surface is a provider's own published vocabulary, a lockfile is package names, and a cassette
 * is a recorded response whose names the cassette redactor already replaced with synthetic ones.
 */
const HARVEST_SKIPS: readonly RegExp[] = [/(^|\/)generated\//, /(^|\/)yarn\.lock$/, /\.har$/];

/**
 * Pure: whether the harvest skips a path.
 *
 * @param path a tree-relative path
 * @returns whether a {@link HARVEST_SKIPS} entry matches it
 */
export function harvestSkips({ path }: { path: string }): boolean {
  return HARVEST_SKIPS.some((skip) => skip.test(path));
}

/**
 * Read one entry: a link's target bytes, or a file's. A binary is read twice — its bytes as they are, and with
 * every NUL dropped so a UTF-16 string reads as the word it spells — because a row may match either. A link target
 * is classified exactly as file contents are, so one that is not UTF-8 is not decoded lossily either.
 *
 * @param absolute the entry's path on disk
 * @returns every reading of what it holds, or undefined when it could not be read
 */
function readEntry({ absolute }: { absolute: string }): { texts: readonly string[]; binary: boolean } | undefined {
  try {
    const bytes = lstatSync(absolute).isSymbolicLink()
      ? readlinkSync(absolute, { encoding: "buffer" })
      : readFileSync(absolute);
    // Not UTF-8 is binary too: decoding it as UTF-8 would turn the bytes a row matches into replacement characters.
    if (bytes.includes(0) || !isUtf8(bytes)) {
      const stripped = Buffer.from(bytes.filter((byte) => byte !== 0)).toString("latin1");
      return { binary: true, texts: [bytes.toString("latin1"), stripped] };
    }
    return { binary: false, texts: [bytes.toString("utf8")] };
  } catch {
    return undefined;
  }
}

/**
 * Pure: a binary's places, once per class and term — its two readings would otherwise count one string twice, and
 * a binary has no lines worth counting.
 *
 * @param places every place found across its readings
 * @returns the first place of each class-and-term pair
 */
function oncePerTerm({ places }: { places: readonly IndirectPlace[] }): readonly IndirectPlace[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    // The disposition is in the key: two rows of one class may match one term and ask different things of it.
    const key = `${place.className}\u0000${place.disposition}\u0000${place.term}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Walk the extracted tree and collect every candidate place.
 *
 * @param treeRoot the extracted zip's root folder
 * @param expected how many entries the commit holds, which the extraction must match
 * @param map the candidate map's rows
 * @param dictionary the system dictionary's two sets, for the harvest
 * @returns every place and the walk's counts, or why the extraction cannot be scanned
 */
export function scanIndirectTree({
  treeRoot,
  expected,
  map,
  dictionary,
}: {
  treeRoot: string;
  expected: number;
  map: readonly IndirectMapRow[];
  dictionary: HarvestDictionary;
}): Result<IndirectTreeScan, ReferenceExportError> {
  let entries: Dirent[];
  try {
    entries = readdirSync(treeRoot, { recursive: true, withFileTypes: true });
  } catch (cause: unknown) {
    return err(ReferenceExportErrors.stepFailed({ cause, step: "walk" }));
  }
  const files = entries.filter((entry) => !entry.isDirectory());
  if (files.length !== expected) {
    const why = `the commit holds ${String(expected)} entries and the extracted zip ${String(files.length)}`;
    return err(ReferenceExportErrors.incomplete({ why }));
  }
  const places: IndirectPlace[] = [];
  const unreadable: string[] = [];
  let binaryFiles = 0;
  let harvestSkipped = 0;
  for (const entry of files) {
    const absolute = join(entry.parentPath, entry.name);
    const path = relative(treeRoot, absolute);
    const read = readEntry({ absolute });
    if (read === undefined) {
      unreadable.push(path);
      continue;
    }
    if (read.binary) {
      const found = read.texts.flatMap((text) => scanCandidateMap({ map, path, text }));
      appendAll({ from: oncePerTerm({ places: found }), into: places });
      binaryFiles += 1;
      continue;
    }
    const text = read.texts[0]!;
    appendAll({ from: scanCandidateMap({ map, path, text }), into: places });
    if (harvestSkips({ path })) {
      harvestSkipped += 1;
      continue;
    }
    appendAll({ from: harvestPlaces({ dictionary, path, text }), into: places });
  }
  if (unreadable.length > 0) {
    return err(ReferenceExportErrors.unreadableFiles({ paths: unreadable }));
  }
  return ok({ binaryFiles, filesScanned: files.length, harvestSkipped, places });
}
