/**
 * The carry gate's injectable edges, in a module of their own.
 *
 * They live here rather than beside either half of the gate because BOTH push verbs' dep bundles declare
 * one — `pushPrimitives.ts`'s `GithubPushDeps` and `stackPushRun.ts`'s own — while the gate itself has to
 * push through those same primitives. A shared type in its own leaf module is what keeps that from becoming
 * an import cycle.
 */
import type { GithubWriteApi } from "../../../corpus/github/write.js";

/** The measurement edge every stack verb injects, so a test never shells a real `git merge-base`. */
export type StackIsAncestor = (input: { ancestor: string; descendant: string; cwd: string }) => boolean;

/** The GitHub and ancestry edges the carry gate needs beyond the Git deps its caller already holds. */
export interface StackCarryDeps {
  readonly makeApi: (input: { readonly home: string; readonly token: string }) => GithubWriteApi;
  readonly isAncestor: StackIsAncestor;
  /** The GitHub token resolver, injectable so a test never shells the real `gh` CLI. */
  readonly token: (input: { readonly home: string }) => string | undefined;
}
