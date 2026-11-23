/**
 * The multi-source driver of corpus compaction: {@link compactSource} once per requested source, gathering what
 * compacted, what failed and what to warn about. What compaction does to one source, and why it is safe, is
 * `./compact.ts`'s header.
 */

import { ok, type Result } from "#lib/result.js";
import { slopweaverHome } from "../config.js";
import { BRONZE_SOURCES } from "../integrations/corpusSources.js";
import type { OwnerProtectionResolver } from "./bronzeProtection.js";
import { type CompactPlan, compactSource } from "./compact.js";
import { type CorpusSource } from "./types.js";

/** Which sources compacted, and which failed — a partial success is never presented as a clean run. */
export interface CompactRun {
  readonly plans: readonly CompactPlan[];
  readonly failed: readonly CorpusSource[];
  readonly warnings: readonly string[];
}

/**
 * Compact every requested source, one after another. A source that fails (corrupt line, unwritable file)
 * is reported and the rest still run — one bad source must not block the corpus's lifecycle — but it is
 * named in `failed` so the caller can exit non-zero rather than claim success.
 *
 * @param sources the sources to compact (defaults to every source with bronze on disk)
 * @param olderThanIso an explicit age horizon (omit for the lossless default)
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the per-source plans that succeeded plus the sources that failed, with a warning for each
 */
export function compactCorpus({
  sources = BRONZE_SOURCES,
  olderThanIso,
  home = slopweaverHome(),
  protection,
}: {
  sources?: readonly CorpusSource[];
  olderThanIso?: string;
  home?: string;
  protection?: OwnerProtectionResolver | undefined;
} = {}): Result<CompactRun> {
  const plans: CompactPlan[] = [];
  const failed: CorpusSource[] = [];
  const warnings: string[] = [];
  for (const source of sources) {
    const compacted = compactSource({
      home,
      protection,
      source,
      ...(olderThanIso !== undefined ? { olderThanIso } : {}),
    });
    if (compacted.isOk()) {
      plans.push(compacted.value);
      for (const failure of compacted.value.orphanTemps.failures) {
        warnings.push(`${source}: ${failure}`);
      }
      if (compacted.value.rejected > 0) {
        warnings.push(
          `${source}: ${String(compacted.value.rejected)} row(s) rejected (failed the required-field ` +
            `gate) and dropped, e.g. ${compacted.value.rejectedSamples.join("; ")}`,
        );
      }
    } else {
      failed.push(source);
      warnings.push(`${source}: ${compacted.error.message}`);
    }
  }
  return ok({ failed, plans, warnings });
}
