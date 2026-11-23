/**
 * `slopweaver atlas graphql-hive walk [--observation <path>] [--json] [--home <dir>]` — the BROWSER
 * surface, in the two halves `docs/browser-route/proof-and-capture-verbs.md` prescribes.
 *
 * The DRIVER is `atlas/kit/walkVerb.ts` — the two halves, their flags and their exit codes are the same for
 * every platform, and were written twice before that module existed. What is left here is exactly what is
 * this atlas's: which addresses, which document, which publish, and what one line of summary says.
 *
 * ## The screenshot is copied by the DRIVER, not trusted from the document
 *
 * A document names a local path; the digest is computed from the bytes actually read, and the artifact is
 * stored under that digest — which is the property a screenshot-as-proof needs to be worth anything. That
 * judgement now lives once, in `storeWalkScreenshots`.
 */
import {
  type HiveWalkDocument,
  hiveWalkBrief,
  parseHiveWalkDocument,
  publishHiveWalk,
} from "../../../atlas/graphqlHive/browserSurface.js";
import { readGraphqlHiveSnapshot } from "../../../atlas/graphqlHive/readAdapter.js";
import { hiveAtlasPaths, hivePageArtifactPath } from "../../../atlas/graphqlHive/store.js";
import {
  type AtlasDeclaredPage,
  type AtlasWalkVerbSpec,
  declaredPagesFrom,
  runAtlasWalkVerb,
} from "../../../atlas/kit/walkVerb.js";
import { err, type Result } from "../../../lib/result.js";

import { HIVE_VERB_INDEX } from "./syncRun.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const HIVE_WALK_USAGE =
  "usage: slopweaver atlas graphql-hive walk [--observation <path>] [--json] [--home <dir>]";

/**
 * Read the declared console addresses the API channel published.
 *
 * @param home the state home to read from
 * @returns every declared page, or why the generation could not be read
 */
function declaredPages({ home }: { home: string }): Result<readonly AtlasDeclaredPage[]> {
  const snapshot = readGraphqlHiveSnapshot({ home });
  if (snapshot.isErr()) {
    return err([snapshot.error.message]);
  }
  return declaredPagesFrom({ fallbackPurpose: "a declared console page", snapshot: snapshot.value }).mapErr((error) => [
    error.message,
  ]);
}

/** Everything this atlas contributes to the kit's walk driver. */
const HIVE_WALK_SPEC: AtlasWalkVerbSpec<HiveWalkDocument> = {
  artifactPath: hivePageArtifactPath,
  atlasDirectory: ({ home }) => hiveAtlasPaths({ home }).directory,
  buildBrief: hiveWalkBrief,
  declaredPages,
  documentPages: ({ document }) => document.pages,
  finishCommand: ({ home }) => `slopweaver atlas graphql-hive walk --observation <path> --home ${home}`,
  noPagesMessage:
    "no console address has been declared yet — run `slopweaver atlas graphql-hive sync` first, which " +
    "expands every declared route against the registry's own slugs",
  parseDocument: parseHiveWalkDocument,
  publish: ({ home, document, screenshots, at }) =>
    publishHiveWalk({ at, document, paths: hiveAtlasPaths({ home }), screenshots }),
  summaryLine: ({ counts }) =>
    `graphql-hive console walk — ${String(counts.reachedCount)} of ${String(counts.declaredCount)} page(s) ` +
    `reached, ${String(counts.photographedCount)} photographed, ${String(counts.unreachableCount)} ` +
    "recorded as gaps",
  usage: HIVE_WALK_USAGE,
  verbIndex: HIVE_VERB_INDEX,
};

/**
 * Run the GraphQL Hive console walk, in whichever half the flags asked for.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function graphqlHiveAtlasWalkCommand(argv: readonly string[]): number {
  return runAtlasWalkVerb({ argv, spec: HIVE_WALK_SPEC });
}
