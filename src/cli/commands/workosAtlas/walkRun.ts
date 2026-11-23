/**
 * `slopweaver atlas workos walk [--observation <path>] [--json] [--home <dir>]` — the BROWSER surface, in
 * the two halves `docs/browser-route/proof-and-capture-verbs.md` prescribes.
 *
 * The DRIVER is `atlas/kit/walkVerb.ts` — the two halves, their flags and their exit codes are the same for
 * every platform, and were written twice before that module existed. What is left here is exactly what is
 * this atlas's: which addresses, which document, which publish, and what one line of summary says.
 *
 * ## The brief's first step is a sign-in CHECK, and the publish half refuses a walk that failed it
 *
 * MEASURED: `dashboard.workos.com` answers the same sign-in redirect to every path, real or
 * invented. So an unsigned walk lands on `/signin` at every address and would report every declared page as
 * unreachable — fourteen confident wrong answers about WorkOS. `browserSurface.ts` makes `signedIn` a
 * required field and refuses a `false`, which is why this verb can print a brief that simply asks.
 */
import {
  type AtlasDeclaredPage,
  type AtlasWalkVerbSpec,
  declaredPagesFrom,
  runAtlasWalkVerb,
} from "../../../atlas/kit/walkVerb.js";
import {
  parseWorkosWalkDocument,
  publishWorkosWalk,
  type WorkosWalkDocument,
  workosWalkBrief,
} from "../../../atlas/workos/browserSurface.js";
import { readWorkosSnapshot } from "../../../atlas/workos/readAdapter.js";
import { workosAtlasPaths, workosPageArtifactPath } from "../../../atlas/workos/store.js";
import { err, type Result } from "../../../lib/result.js";

import { WORKOS_VERB_INDEX } from "./syncRun.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const WORKOS_WALK_USAGE = "usage: slopweaver atlas workos walk [--observation <path>] [--json] [--home <dir>]";

/**
 * Read the declared dashboard addresses the API channel published.
 *
 * @param home the state home to read from
 * @returns every declared page, or why the generation could not be read
 */
function declaredPages({ home }: { home: string }): Result<readonly AtlasDeclaredPage[]> {
  const snapshot = readWorkosSnapshot({ home });
  if (snapshot.isErr()) {
    return err([snapshot.error.message]);
  }
  return declaredPagesFrom({ fallbackPurpose: "a declared dashboard page", snapshot: snapshot.value }).mapErr(
    (error) => [error.message],
  );
}

/** Everything this atlas contributes to the kit's walk driver. */
const WORKOS_WALK_SPEC: AtlasWalkVerbSpec<WorkosWalkDocument> = {
  artifactPath: workosPageArtifactPath,
  atlasDirectory: ({ home }) => workosAtlasPaths({ home }).directory,
  buildBrief: workosWalkBrief,
  declaredPages,
  documentPages: ({ document }) => document.pages,
  finishCommand: ({ home }) => `slopweaver atlas workos walk --observation <path> --home ${home}`,
  noPagesMessage:
    "no dashboard address has been declared yet — run `slopweaver atlas workos sync` first, which " +
    "publishes every declared route with its exact URL",
  parseDocument: parseWorkosWalkDocument,
  publish: ({ home, document, screenshots, at }) =>
    publishWorkosWalk({ at, document, paths: workosAtlasPaths({ home }), screenshots }),
  summaryLine: ({ counts }) =>
    `workos dashboard walk — ${String(counts.reachedCount)} of ${String(counts.declaredCount)} page(s) ` +
    `reached, ${String(counts.photographedCount)} photographed, ${String(counts.unreachableCount)} ` +
    "recorded as gaps",
  usage: WORKOS_WALK_USAGE,
  verbIndex: WORKOS_VERB_INDEX,
};

/**
 * Run the WorkOS dashboard walk, in whichever half the flags asked for.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function workosAtlasWalkCommand(argv: readonly string[]): number {
  return runAtlasWalkVerb({ argv, spec: WORKOS_WALK_SPEC });
}
