/**
 * Which `<passId>.scratch` workspaces under `orchestration` are spent, and the answer to the question the
 * owner actually asked — **why is there a `node_modules` in a user-level home at all?**
 *
 * `../../codex/artifactStore.ts`'s `createPassScratch` is the whole answer, and it is a rail rather than an
 * oversight. Codex runs under a `workspace-write` sandbox: the repository is deliberately NOT writable and
 * deliberately NOT in `additionalDirectories`, which is the only reason a pass can run arbitrary commands
 * while the checkout stays safe from it. The one directory a pass may write is the scratch this home mints
 * for it. So a pass that has to reproduce a bug, clone the repository, build a mutant or install a dependency
 * has exactly one place to put the result, and that place is `$SLOPWEAVER_HOME/orchestration/<passId>.scratch`.
 *
 * What follows from that, and is the rule below: the pass's OUTPUT is its record directory, `<passId>/`,
 * which this verb never takes. Its scratch is the bench it worked at, spent the moment its artifact is
 * written; `./roots.ts` carries why it goes whole rather than tree by tree.
 */

/** One finished pass's scratch workspace, sized. */
export interface SpentScratch {
  /** The `<passId>.scratch` directory's name, directly below `$SLOPWEAVER_HOME/orchestration`. */
  readonly relativePath: string;
  /**
   * Allocated bytes a removal frees — a file sharing its inode with another path frees nothing and is not
   * counted, and a sparse file counts the blocks it holds, never its logical length.
   */
  readonly bytes: number;
}

/**
 * Whether a `<passId>.scratch` directory belongs to a pass that has finished.
 *
 * `../../codex/artifactStore.ts` writes `artifact.md` into the sibling `<passId>/` directory last, so its
 * presence is the liveness test — and a scratch whose pass may still be running is never taken. The cost
 * of that conservatism is measured in `./roots.ts`: 21 directories, 2.9 MB.
 *
 * @param entryName the `<passId>.scratch` directory's own name
 * @param finishedPassIds every pass id whose artifact exists
 * @returns whether the scratch may be reclaimed
 */
export function isFinishedScratch({
  entryName,
  finishedPassIds,
}: {
  entryName: string;
  finishedPassIds: ReadonlySet<string>;
}): boolean {
  if (!entryName.endsWith(".scratch")) {
    return false;
  }
  return finishedPassIds.has(entryName.slice(0, -".scratch".length));
}
