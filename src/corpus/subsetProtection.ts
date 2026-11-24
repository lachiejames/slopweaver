/**
 * A subset build's check against the owner's protect list, judged in full before the first byte is copied.
 *
 * A build READS whole trees out of the source home (every bronze source directory, the history stream, the
 * scaffolding) and WRITES a whole new home. A copy that skipped a no-access entry would hand back a subset home
 * whose manifest claims a window it does not hold, so every tree it reads is judged as a SEARCH, which refuses
 * one at or under a no-access entry and one holding a no-access entry below it, and the destination as a
 * `tree-write`, refused when any entry covers it or lies beneath it. The first refusal stops the build.
 *
 * The scaffolding pairs live here rather than in `./subsetBuild.ts` so the preflight and the copy read the SAME
 * list: a path added to one and not the other would be copied unjudged.
 */
import { join } from "node:path";

import { BRONZE_SOURCES } from "../integrations/corpusSources.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import type { CorpusJudge, OwnerProtectionResolver } from "./bronzeProtection.js";
import { type CorpusAccess, preflightCorpusAccesses } from "./corpusAccessGuard.js";
import { bronzeSourceDir, historyDir } from "./corpusPaths.js";
import { type SubsetBuildError, SubsetBuildErrors } from "./subsetBuild.errors.js";

/** The root-level home entries the query path reads, copied verbatim so a subset home can answer at all. */
const COPIED_ROOT_ENTRIES: readonly string[] = ["profile.json", "capability-profile.json", "judgement"];

/**
 * The scaffolding a subset home needs to resolve people, containers and the owner lens, as source and
 * destination pairs. Pure.
 *
 * @param sourceHome the full corpus home being sliced
 * @param outHome the subset home being written
 * @returns every pair, where it is read from and where it lands, in the order the copy runs them
 */
export function subsetScaffoldPairs({
  sourceHome,
  outHome,
}: {
  sourceHome: string;
  outHome: string;
}): readonly { readonly from: string; readonly to: string }[] {
  const src = stateHomePaths({ home: sourceHome });
  const out = stateHomePaths({ home: outHome });
  return [
    { from: src.corpus.members, to: out.corpus.members },
    { from: src.corpus.structures, to: out.corpus.structures },
    { from: src.corpus.watermark, to: out.corpus.watermark },
    { from: src.corpus.githubReposWatermark, to: out.corpus.githubReposWatermark },
    { from: src.corpus.slackThreads, to: out.corpus.slackThreads },
    { from: src.corpus.slackChannelsWatermark, to: out.corpus.slackChannelsWatermark },
    { from: join(src.corpus.root, "watermarks"), to: join(out.corpus.root, "watermarks") },
    { from: src.homeVersion, to: out.homeVersion },
    ...COPIED_ROOT_ENTRIES.map((entry) => ({ from: join(sourceHome, entry), to: join(outHome, entry) })),
  ];
}

/**
 * Judge every tree a subset build reads and the home it writes, before it lists or copies anything.
 *
 * @param sourceHome the full corpus home being sliced, whose registries apply beside the account's own default
 * @param outHome the subset home being written
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the judge each sink asks of its own path, or the refusal naming the first covered path
 */
export function subsetPreflight({
  sourceHome,
  outHome,
  protection,
}: {
  sourceHome: string;
  outHome: string;
  protection: OwnerProtectionResolver | undefined;
}): Result<CorpusJudge, SubsetBuildError> {
  const reads: CorpusAccess[] = [
    ...BRONZE_SOURCES.map((source) => bronzeSourceDir({ home: sourceHome, source })),
    historyDir({ home: sourceHome }),
    ...subsetScaffoldPairs({ outHome, sourceHome }).map(({ from }) => from),
  ].map((path) => ({ access: "search", path }));
  const judged = preflightCorpusAccesses({
    accesses: [{ access: "tree-write", path: outHome }, ...reads],
    home: sourceHome,
    operation: { target: outHome, verb: "build a subset into" },
    protection,
  });
  if (judged.isErr()) {
    return err(SubsetBuildErrors.protectedPath({ lines: judged.error }));
  }
  return ok(judged.value.judge);
}
