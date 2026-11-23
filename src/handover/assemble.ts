/**
 * Assembling the board — the reads every consumer of `composeBoardModels` needs before it can call it.
 *
 * Extracted because a second consumer arrived. `slopweaver handover list` had these two helpers private,
 * and `slopweaver session-start` needs exactly the same pair to read the same register; copying them was
 * caught by the `duplicate-windows` gate on the commit that introduced the copy, which is the outcome that
 * gate exists for. The alternative — two readers drifting apart while both claiming to be "the board" — is
 * the failure mode a single register is supposed to prevent in the first place.
 *
 * Effectful: it reads journals off disk. The placement rules it feeds stay pure in
 * {@link ./boardState}.
 */

import { createConcurrencyLimiter } from "#lib/resilience.js";
import type { HandoverDoc } from "./doc.js";
import type { RunEvent } from "./ledger.js";

import { readRunJournal, readRunJournalAsync } from "./runStore.js";
import { CONCURRENT_SCAN_WIDTH, lookupArchivedDoc } from "./store.js";

/**
 * One doc's journal, in the shape `composeBoardModels` takes.
 *
 * @internal the shared contract between the board's two readers.
 */
export interface JournalEvidence {
  readonly events: readonly RunEvent[];
  readonly unreadableLines: readonly number[];
}

/**
 * Every root's current-cycle run-journal evidence, one read per doc slug.
 *
 * A journal that will not read is recorded as unreadable rather than as "no run", so a doc with a corrupt
 * journal refuses loudly instead of silently vanishing off whichever slice is being computed.
 *
 * No aggregate size or FIFO guard yet — `readRunJournal` already refuses to swallow a real read error as
 * "no run", which is the safety property that matters most here; a dedicated cap for a pathologically large
 * journal is real follow-up work, not yet built.
 *
 * @param docs the docs to read journals for
 * @param runsDir the runs directory
 * @returns each doc's events and unreadable line numbers, keyed by slug
 */
export function journalEvidence({
  docs,
  runsDir,
}: {
  docs: readonly HandoverDoc[];
  runsDir: string;
}): ReadonlyMap<string, JournalEvidence> {
  const journals = new Map<string, JournalEvidence>();
  for (const slug of new Set(docs.map((doc) => doc.slug))) {
    const read = readRunJournal({ runsDir, slug });
    journals.set(
      slug,
      read.isOk()
        ? { events: read.value.events, unreadableLines: read.value.unreadable }
        : { events: [], unreadableLines: [0] },
    );
  }
  return journals;
}

/**
 * {@link journalEvidence} with up to {@link CONCURRENT_SCAN_WIDTH} journals open at once: the same map, keyed and
 * valued exactly as the serial read keys and values it, a journal that will not read recorded as unreadable.
 *
 * @param docs the docs to read journals for
 * @param runsDir the runs directory
 * @returns each doc's events and unreadable line numbers, keyed by slug
 */
export async function journalEvidenceConcurrently({
  docs,
  runsDir,
}: {
  docs: readonly HandoverDoc[];
  runsDir: string;
}): Promise<ReadonlyMap<string, JournalEvidence>> {
  const limit = createConcurrencyLimiter({ concurrency: CONCURRENT_SCAN_WIDTH });
  const slugs = [...new Set(docs.map((doc) => doc.slug))];
  const reads = await Promise.all(
    slugs.map((slug) => limit(async () => ({ concurrent: await readRunJournalAsync({ runsDir, slug }), slug }))),
  );
  // A journal that failed 32 wide is read again once every wide read has settled, one file open at a time, as
  // `journalEvidence` reads it: EMFILE under a low descriptor limit is a failure of the width, never of the journal,
  // and a retry inside the wide read would still be competing with the reads holding every slot.
  return new Map(
    reads.map(({ concurrent, slug }) => {
      const read = concurrent.isOk() ? concurrent : readRunJournal({ runsDir, slug });
      const evidence: JournalEvidence = read.isOk()
        ? { events: read.value.events, unreadableLines: read.value.unreadable }
        : { events: [], unreadableLines: [0] };
      return [slug, evidence] as const;
    }),
  );
}

/**
 * Every `blockedBy` slug no top-level doc claims, resolved from `archive/` when it exists there.
 *
 * A targeted lookup per unresolved slug — never an archive-wide enumeration — so a dependent doc's terminal
 * closure keeps its exact reason and `via` chain instead of degrading to a generic "missing dependency" once
 * its prerequisite is archived. Docs found here are used only to RESOLVE dependencies; they never become
 * board roots, so they cannot appear in `--all`, collisions, or stale-repository checks.
 *
 * @param docs every top-level doc on the board
 * @param handoverDir the top-level handovers directory
 * @returns the archived docs that resolve an otherwise-unclaimed `blockedBy` slug
 */
export function archivedDependencies({
  docs,
  handoverDir,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
}): readonly HandoverDoc[] {
  const known = new Set(docs.map((doc) => doc.slug));
  const unresolved = new Set(docs.flatMap((doc) => doc.blockedBy).filter((slug) => !known.has(slug)));
  const archived: HandoverDoc[] = [];
  for (const slug of unresolved) {
    const found = lookupArchivedDoc({ handoverDir, slug });
    if (found !== undefined) {
      archived.push(found);
    }
  }
  return archived;
}
