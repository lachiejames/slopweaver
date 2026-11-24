/**
 * The effectful half of `./builtState.ts`: read where a built tree stands, and wait out a rebuild in flight with the
 * same bounded poll a console child uses (`./consoleRebuildWait.ts`) — from the PARENT, so the children it launches
 * afterwards meet a fresh build instead of each refusing, or each waiting, on its own.
 *
 * The guard's rule stands: nothing here runs a stale build or opens `SLOPWEAVER_ALLOW_STALE_BUILD`. A parent that
 * waited and saw no fresh build launches its child anyway, and that child refuses exactly as before.
 */
import { existsSync } from "node:fs";

import type { BuiltState } from "./builtState.js";
import { type RebuildWaitOutcome, waitForFreshBuild } from "./consoleRebuildWait.js";
import { pinnedToJudgedRoot, productionWaitSeams } from "./invocationGuard.js";
import { scanSourceStamps } from "./sourceScan.js";
import { parseBuildManifest, type SourceStamp, stalenessOf } from "./staleness.js";

/**
 * Where one built tree stands against its source, now: one manifest read and, over a valid one, one source scan —
 * the same scan every built-CLI invocation's own guard makes.
 *
 * @param builtRoot the built tree's directory, absolute
 * @returns its standing
 */
export function readBuiltState({ builtRoot }: { builtRoot: string }): BuiltState {
  const manifestText = productionWaitSeams({ builtRoot }).readManifest();
  if (manifestText === undefined) {
    return { kind: "unbuilt" };
  }
  const manifest = parseBuildManifest({ text: manifestText });
  if (manifest === undefined || !existsSync(manifest.root)) {
    return { kind: "unjudgeable" };
  }
  let current: readonly SourceStamp[];
  try {
    current = scanSourceStamps({ root: manifest.root });
  } catch {
    // A root that is no directory, or one gone between the check above and the scan, proves no rebuild: judged
    // nothing, never thrown at the capture, which would lose every reading instead of one.
    return { kind: "unjudgeable" };
  }
  const staleness = stalenessOf({ current, manifest });
  if (staleness.stale) {
    return { evidence: staleness.why, kind: "stale", manifestText };
  }
  return { kind: "fresh", manifestText };
}

/**
 * Wait for a fresh build of the checkout a stale manifest names, bounded exactly as a console child's wait is.
 *
 * @param builtRoot the built tree's directory, absolute
 * @param judgedText the stale manifest's text, as {@link readBuiltState} read it
 * @returns fresh once a finished build of that checkout lands, or timed-out at the bound
 */
export async function waitForBuiltTree({
  builtRoot,
  judgedText,
}: {
  builtRoot: string;
  judgedText: string;
}): Promise<RebuildWaitOutcome> {
  return waitForFreshBuild({
    judgedText,
    seams: pinnedToJudgedRoot({ judgedText, seams: productionWaitSeams({ builtRoot }) }),
  });
}
