/**
 * The write half of `./originBinding.ts`: read a live checkout's `origin` so a pass record or fallback request can
 * carry it. IO edge, kept apart so the parsers that validate the field stay pure.
 */

import { originRepositoryOf } from "../config.js";
import { originRepositoryField } from "./originBinding.js";

/**
 * Read a live checkout's `origin` as the binding to record beside a pass.
 *
 * A failed read never stops a pass: it only leaves that record unable to be re-proved once its path is gone.
 *
 * @param repoRoot the checkout the pass is being taken in
 * @returns `{ originRepository }` when `origin` reads as a well-formed slug, else an empty object
 */
export function liveOriginRepositoryField({ repoRoot }: { repoRoot: string }): { readonly originRepository?: string } {
  const origin = originRepositoryOf({ cwd: repoRoot });
  if (origin.isErr()) {
    return {};
  }
  return originRepositoryField({ value: `${origin.value.owner}/${origin.value.repo}` });
}
