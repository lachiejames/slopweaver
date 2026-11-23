/**
 * Which remedy a FOREIGN schema version earns, and why the direction decides it.
 *
 * Its own module rather than a helper inside `./store.ts` because it is a policy about destructive advice
 * rather than part of the generation protocol — and because `store.ts` sits on the file-size floor, so the
 * next thing added to it would have to displace something anyway.
 */

/**
 * The remedy line a foreign schema version earns, which is NOT the same line in both directions.
 *
 * MEASURED, and it is the loop this function exists to break. Every platform's
 * {@link AtlasStoreSpec.supersedeRemedy} names its own `reset --confirm archive`, and the reader printed it
 * for ANY mismatch. On one install a build writing Vanta schema 5 met a generation written at 6 and was
 * told to reset — that is, to archive every entity it simply could not parse yet, in favour of an empty
 * generation, on the strength of being the OLDER binary. Reproduce the shape:
 * `grep -rn supersedeRemedy src/atlas --include=store.ts | head`.
 *
 * A generation NEWER than this build is not corrupt and nothing is wrong with it. The remedy is a newer
 * build, and — if a reset already happened — `restore`, which is the verb that exists to undo one. Only an
 * OLDER generation is a case where installing a fresh one is sane advice, so only then is the platform's own
 * line printed.
 *
 * The line also names WHERE a newer build comes from, because "use a newer build" is unactionable to a
 * checkout that is already current on its upstream — and that is the common case, not the odd one.
 * MEASURED: a feature worktree ran the Datadog walk into the shared home
 * (`ls $SLOPWEAVER_HOME/atlas/datadog/_walk`, epoch-ms names), writing schema 2; the scheduler on `main`
 * refused while `checkout status` reported it current, and filed a finding card rather than
 * waiting; once that branch landed the block cleared itself. A home is written by whichever build ran
 * last (`docs/atlases/sync-and-reset.md` § the two-sided version check), and the `slopweaver` shell function resolves to
 * the cwd worktree's own `bin`, so an unmerged branch's session is the writer whenever a current checkout
 * meets a newer generation. The non-action is the advice: retry once that branch lands.
 *
 * @param found the version the document on disk declares
 * @param spec the platform's own name, the version this build writes, and its own reset advice
 * @returns the remedy line to print beneath the mismatch
 */
export function supersedeAdvice({
  found,
  spec,
}: {
  found: number;
  spec: { platform: string; schemaVersion: number; supersedeRemedy: string };
}): string {
  if (found > spec.schemaVersion) {
    return (
      `this generation is NEWER than this build, not corrupt — use a build that writes version ${String(found)}. ` +
      `Do NOT reset: that archives a generation this build cannot read but a newer one can. ` +
      `A checkout already current on its upstream means the writer is on an unmerged branch — a worktree ` +
      `session ran that branch's own sync into this home — so retry after it lands. ` +
      `If a reset already happened, run: slopweaver atlas ${spec.platform} restore`
    );
  }
  return spec.supersedeRemedy;
}
