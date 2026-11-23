/**
 * What the store must stop holding, decided from what it holds: the pure half of the retention reconciliation the
 * authored import runs before it projects the home (`./authoredRetentionStore.ts` is the effectful half).
 *
 * The owner's ruling: the
 * backup keeps their words and the record, and leaves call threads and tool answers out. Changing the import alone keeps NEW
 * rows out; the rows an earlier import already wrote stay in every later dump until something removes them. So:
 *
 * - **A stored path the classification now calls `scratch` is removed**, every version of it, and its
 *   `authored_absent` row with it. Only an explicit `scratch` row purges: an unclassified path, a `split` entry, a
 *   `credential` or `other-class` one is left alone, because a classification defect that left a path unnamed must
 *   never delete the only stored copy of it.
 * - **A stored call-file version still carrying a tool answer is rewritten**: the stripped body is inserted at the same
 *   path and `fileModifiedAt`, then the unstripped location goes. A call whose file has since vanished from disk keeps
 *   its `authored_absent` row, so a restore still leaves it out exactly as before.
 */
import { createHash } from "node:crypto";

import type { NewAuthoredBodyRecord, NewAuthoredFileRecord } from "../schema/authored.js";

import { classifyHomePath } from "./authoredDirectories.js";
import { isCallFilePath, stripCallToolAnswers } from "./callToolAnswerStrip.js";

/** One stored location, bodies left out. */
export interface StoredAuthoredLocation {
  readonly relativePath: string;
  readonly bodySha256: string;
}

/** A stored call-file version whose body may still carry a tool answer. */
export interface StoredCallVersion extends StoredAuthoredLocation {
  readonly directory: string;
  readonly fileModifiedAt: Date;
  readonly body: Buffer;
}

/** One stored call version replaced by its stripped body. */
export interface CallVersionRewrite {
  readonly remove: StoredAuthoredLocation;
  readonly body: NewAuthoredBodyRecord;
  readonly location: NewAuthoredFileRecord;
}

/**
 * The stored locations whose path the classification explicitly calls `scratch` — local-only, so out of the store.
 *
 * @param locations every stored location
 * @returns the ones to delete, in the order given
 */
export function scratchLocations({
  locations,
}: {
  locations: readonly StoredAuthoredLocation[];
}): readonly StoredAuthoredLocation[] {
  return locations.filter((location) => isScratchPath({ relativePath: location.relativePath }));
}

/**
 * The paths among `paths` the classification explicitly calls `scratch` — an `authored_absent` row naming one goes too.
 *
 * @param paths home-relative paths, in any order
 * @returns the scratch ones, in the order given
 */
export function scratchPaths({ paths }: { paths: readonly string[] }): readonly string[] {
  return paths.filter((relativePath) => isScratchPath({ relativePath }));
}

/** Whether a path's deepest classification row is an explicit `scratch` row. */
function isScratchPath({ relativePath }: { relativePath: string }): boolean {
  return classifyHomePath({ relativePath })?.directoryClass === "scratch";
}

/**
 * The stored call version rewritten without its tool answers, or `undefined` when it carries none.
 *
 * @param version one stored call-file version, its body included
 * @returns the rewrite, or `undefined` when stripping changes nothing
 */
export function callVersionRewrite({ version }: { version: StoredCallVersion }): CallVersionRewrite | undefined {
  // The SAME call-path test the import strips by, so a file nested under `talk/calls/` that the import stores whole is
  // never rewritten here — two definitions would alter a row the import then writes back, every run.
  if (!isCallFilePath({ relativePath: version.relativePath })) {
    return undefined;
  }
  const stripped = stripCallToolAnswers({ bytes: version.body });
  if (stripped.stripped === 0) {
    return undefined;
  }
  const buffer = Buffer.from(stripped.bytes);
  const bodySha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    body: { body: buffer, bodySha256, byteLength: buffer.length },
    location: {
      bodySha256,
      directory: version.directory,
      fileModifiedAt: version.fileModifiedAt,
      relativePath: version.relativePath,
    },
    remove: { bodySha256: version.bodySha256, relativePath: version.relativePath },
  };
}
