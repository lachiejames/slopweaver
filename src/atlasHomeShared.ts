/**
 * The two things every atlas path resolver uses, in a module neither of its callers owns.
 *
 * Extracted when `atlasHomeJumpcloud.ts` was split out and the two files formed an import CYCLE — the
 * linter's own advice, and the right shape regardless: a resolver depending on the module that collects
 * resolvers is backwards. `atlasHome.ts` and every per-platform module import DOWN into this one.
 */
import { join } from "node:path";

import type { AtlasPlatformPaths } from "./stateHome.js";

/**
 * One kind file's name, with the EXTENSION this build writes rather than whichever one a caller declared.
 *
 * A kind file's extension is a property of the FORMAT, and the format belongs to `atlas/kit/store.ts` — one
 * envelope line and one entity per line after it, streamed both ways (`atlas/atlasFile.ts`'s header carries
 * why). A platform chooses the NAME. It has never chosen the format, and a map that spells the extension
 * anyway is 27 copies of one decision.
 *
 * MEASURED, which is why this normalises rather than trusts: six atlases landed on the base
 * branch while the format was being changed, every one of them declaring `.json`, every one of them rebasing
 * in CLEANLY, and every one of them writing a whole-document artifact until a red CI run said so. Nothing in
 * a conflict-free rebase can catch that. Deriving it here can.
 *
 * @param file the name a platform declared, with or without an extension
 * @returns that name carrying this build's kind-file extension
 * @internal
 */
export function kindFileName({ file }: { file: string }): string {
  return `${file.replace(/\.jsonl?$/, "")}.jsonl`;
}

/**
 * One atlas's sub-tree, from the platform directory name and the file each kind's records live in.
 *
 * Every atlas lays its generation out identically — a manifest written last, one file per kind, a
 * `_sensitive` companion directory and an archive slot under `_superseded` — so those four paths are
 * derived here once rather than restated by each platform. What genuinely differs between atlases is only
 * the kind-to-filename mapping, which is what each caller supplies; its extension is {@link kindFileName}'s.
 *
 * @param platform the directory name under `$home/atlas`, which is also the archive slot's name
 * @param files each kind's own file name, keyed by kind
 * @returns that platform's absolute paths
 */
export function atlasPlatformPaths({
  atlasRoot,
  platform,
  files,
}: {
  atlasRoot: string;
  platform: string;
  files: Readonly<Record<string, string>>;
}): AtlasPlatformPaths {
  const root = join(atlasRoot, platform);
  const kinds: Record<string, string> = {};
  for (const [kind, file] of Object.entries(files)) {
    kinds[kind] = join(root, kindFileName({ file }));
  }
  return {
    kinds,
    manifest: join(root, "manifest.json"),
    root,
    sensitive: join(root, "_sensitive"),
    superseded: join(atlasRoot, "_superseded", platform),
  };
}
