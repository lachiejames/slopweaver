/**
 * Which of a source's bronze files a STORE pass has to replay, and why the canonical one is not among
 * them by default.
 *
 * ## The defect this exists for
 *
 * MEASURED on a real home. `slopweaver store detail --source slack --id
 * D0SYN000001:1789861718.766449` answered "the store has never held one" while the record sat in
 * `corpus/bronze/slack/2026-09-15_2026-09-20.jsonl` the whole time. Re-reading that ONE file put it in
 * the store. Re-reading every source's window files put **over ten thousand** rows in that bronze held and the
 * store did not — most of them slack, about a thousand linear, hundreds each of notion and github, dozens
 * of gmail, one calendar — adding about one percent to a store of over a million rows.
 *
 * The hole was permanent, and that is the part worth stating rather than the count. Two mechanisms meet:
 * `../cli/commands/refresh/storeLeg.ts` used to ingest only the window file THIS run wrote, and
 * `../corpus/corpusWriter.ts` dedups per `sourceId` against everything bronze already holds. So a record
 * that reached bronze in a run without `--store` is deduped out of every LATER window file, and the leg
 * could never see it again. Reproduced live: re-running the refresh over that DM's own window printed
 * `wrote 1 new, deduped <n> (from <n + 1> projected)` and then `--store: slack: 1 row(s) stored from 1
 * line(s)` — the thousand-odd rows the store was missing stayed missing. No number of refreshes repaired it.
 *
 * So a store pass replays the WINDOW FILES rather than one file, and the cost of doing so is measured
 * rather than assumed: `store ingest --source slack --all` over all of a real home's few dozen slack window
 * files read over a hundred thousand lines and upserted tens of thousands of rows in **about forty seconds**
 * (`linear` about as long, `github` a third of that). Reproduce
 * with `time slopweaver store ingest --source <s> --limit 2000 --all --from-file <first window basename>`.
 *
 * ## Why the canonical file is omitted, and when it is not
 *
 * `compact.jsonl` is several gigabytes for slack alone, and it is read FIRST in bronze read order
 * (`../corpus/corpusPaths.ts#sortBronzeEntries`) precisely because every window file written afterwards
 * supersedes it. Replaying it on every pass would cost hours to re-assert rows a window file is about to
 * overwrite anyway. Omitting it is therefore a claim about COST, never about coverage — which is why the
 * omission is a reported field rather than a silent filter, and why `full` scope exists for the case
 * where compaction has folded an unrepaired gap into the canonical file.
 */
import type { BronzeFileStat } from "../corpus/bronzeStorage.js";
import { bronzeCompactFile } from "../corpus/corpusPaths.js";
import type { CorpusSource } from "../corpus/types.js";

/**
 * How much of a source's bronze a store pass reads.
 *
 * `windows` omits the canonical compacted file; `full` reads everything in bronze read order. Named as a
 * scope rather than a boolean because the report has to PRINT which one it ran under — a count of missing
 * rows means different things under each, and a reader who cannot tell them apart has a number with no
 * claim attached.
 */
export type BronzeScanScope = "windows" | "full";

/** A source's files split into the ones a pass reads and the ones its scope left out. */
export interface BronzeWindowPlan {
  /** The files to read, in bronze read order, unchanged. */
  readonly read: readonly BronzeFileStat[];
  /** The files the scope omitted — empty under `full`, the canonical file under `windows`. */
  readonly omitted: readonly BronzeFileStat[];
}

/**
 * Split one source's bronze files by scope, preserving bronze read order exactly.
 *
 * The canonical file is matched by its exact PATH ({@link bronzeCompactFile}), never by basename: bronze
 * listing is recursive, so a nested directory may legitimately hold a file called `compact.jsonl` that is
 * not this source's canonical one, and dropping it by name would omit real records while reporting the
 * omission as the canonical file. Pure.
 *
 * @param files the source's files, already in bronze read order
 * @param home the Slopweaver home the canonical path is resolved under
 * @param scope how much of bronze this pass reads
 * @returns the files to read and the files the scope omitted
 */
export function planBronzeWindows({
  files,
  home,
  scope,
  source,
}: {
  files: readonly BronzeFileStat[];
  home: string;
  scope: BronzeScanScope;
  source: CorpusSource;
}): BronzeWindowPlan {
  if (scope === "full") {
    return { omitted: [], read: files };
  }
  const canonical = bronzeCompactFile({ home, source });
  return {
    omitted: files.filter((file) => file.path === canonical),
    read: files.filter((file) => file.path !== canonical),
  };
}

/**
 * Total bytes across a list of bronze files — what the report names when it says what it did not read.
 *
 * @param files the files to total
 * @returns the sum of their sizes in bytes
 */
export function bronzeBytes({ files }: { files: readonly BronzeFileStat[] }): number {
  return files.reduce((sum, file) => sum + file.bytes, 0);
}
