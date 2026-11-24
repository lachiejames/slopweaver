/**
 * Compaction's write-side check against the owner's protect list, judged in full before its first effect.
 *
 * The listing (`./bronzeStorage.ts`'s `listBronzeFiles`) asks the judge as a READ, which a read-only entry allows.
 * Compaction then WRITES: it renames a staged canonical file into place and unlinks every window file the canonical
 * file superseded, so a read-only window would be deleted by a verb the list let through. So every one of those paths
 * is judged as a write here, the canonical file first, and a single covered one refuses the whole source before the
 * orphan sweep, the staging or any unlink runs. The judge is handed back so the sweep asks the same list about each
 * dead writer's temp file (`./compactOrphanTemps.ts`).
 */
import { err, ok, type Result } from "#lib/result.js";

import type { CorpusJudge, OwnerProtectionResolver } from "./bronzeProtection.js";
import type { BronzeFileStat } from "./bronzeStorage.js";
import { type CompactError, CompactErrors } from "./compact.errors.js";
import { preflightCorpusAccesses } from "./corpusAccessGuard.js";
import type { CorpusSource } from "./types.js";

/**
 * Judge every path compaction will write or unlink, before it touches any of them.
 *
 * @param source the source being compacted, as the refusal names it
 * @param home the Slopweaver home whose registries apply, beside the account's own default
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @param canonicalPath the file the survivors are renamed into
 * @param files every window file the listing returned, each of which is unlinked or replaced
 * @returns the judge for the orphan sweep, or the refusal naming the first covered path
 */
export function compactWritePreflight({
  source,
  home,
  protection,
  canonicalPath,
  files,
}: {
  source: CorpusSource;
  home: string;
  protection: OwnerProtectionResolver | undefined;
  canonicalPath: string;
  files: readonly BronzeFileStat[];
}): Result<CorpusJudge, CompactError> {
  const judged = preflightCorpusAccesses({
    accesses: [canonicalPath, ...files.map((file) => file.path)].map((path) => ({ access: "write", path })),
    home,
    operation: { target: source, verb: "compact" },
    protection,
  });
  if (judged.isErr()) {
    return err(CompactErrors.protectedWrite({ lines: judged.error }));
  }
  return ok(judged.value.judge);
}
