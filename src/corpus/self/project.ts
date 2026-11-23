/**
 * Project scanned files into `CorpusRecord`s — the whole reason this connector is cheap. Emit the one atom and
 * every later stage (dedup, graph, embeddings, retrieval, citations) works unchanged; nothing downstream
 * learns that `self` exists.
 *
 * Pure and deterministic. The event time and the filesystem read are both resolved by the caller, so the same
 * inputs always produce the same records in the same order — which is what makes a re-scan's `sourceId`s
 * stable and the write a no-op.
 *
 * ## No fuzzy dedup, and that inverts the obvious instinct
 *
 * The owner restates the same idea many times over weeks. Collapsing near-duplicates is the naive move and it would
 * destroy the answer they actually want: a note that says when each restatement was made. The repetition IS
 * the signal, so every restatement stays its own dated record and retrieval ranks them. Bronze's exact
 * content-hash dedup still collapses genuine re-scan duplicates.
 */
import { extractRefs } from "../refs.js";
import type { CorpusRecord } from "../types.js";
import { stampVisibility } from "../visibility.js";
import type { SelfTimeSource } from "./eventTime.js";
import type { SelfFile } from "./scan.js";
import { splitIntoSections } from "./sections.js";

/** A file paired with the event time already resolved for it. */
export interface DatedSelfFile {
  readonly file: SelfFile;
  readonly tsIso: string;
  readonly timeSource: SelfTimeSource;
}

/**
 * The low-cardinality grouping for a file: its root plus its top-level directory.
 *
 * `container` exists so retrieval can weigh a live plan differently from a discarded one, and the top level is
 * where that distinction actually lives — measured, the largest directory (`junkyard`, 1,822 files) is exactly
 * the "I raised this a month ago" pile, and the smallest are the current ones. The full relative directory was
 * the alternative and was rejected on cardinality: `container` is documented as a low-cardinality key and is
 * what `capPerContainer` and the audit report bucket by, so thousands of them would make both meaningless. The
 * finer grain is not lost — it rides on `attrs.dir`. Pure.
 *
 * @param file the scanned file
 * @returns `<root>/<top-level dir>`, or just `<root>` for a file sitting at the root
 */
export function selfContainer({ file }: { file: SelfFile }): string {
  const segments = file.relPath.split("/");
  return segments.length > 1 ? `${file.rootName}/${segments[0]!}` : file.rootName;
}

/**
 * The stable identity of one section, across re-scans: root-relative path, then the heading's ordinal and
 * slug, then which budget slice of that heading it is.
 *
 * Positional by construction, and worth being explicit about what that costs: inserting a new heading halfway
 * down a file shifts every later ordinal, so the next re-scan writes those sections again under new ids rather
 * than recognising them as edits. That is the honest behaviour for an append-only lossless store — nothing is
 * lost, the old rows keep their dates — and it is why the ordinal is paired with the slug, which makes a
 * shifted section's id still name what it is about. Pure.
 *
 * @param relPath the file's path relative to its root
 * @param rootName the root's directory name
 * @param ordinal the heading section's 0-based index within the file
 * @param part the budget slice's 0-based index within that heading section
 * @param slug the heading's slug
 * @returns the `sourceId`
 */
export function selfSourceId({
  relPath,
  rootName,
  ordinal,
  part,
  slug,
}: {
  relPath: string;
  rootName: string;
  ordinal: number;
  part: number;
  slug: string;
}): string {
  return `${rootName}/${relPath}#${String(ordinal)}.${String(part)}:${slug}`;
}

/** The relative DIRECTORY of a file, carried on `attrs.dir` — the finer grain `container` deliberately omits. */
function selfDir({ file }: { file: SelfFile }): string {
  const segments = file.relPath.split("/");
  return segments.length > 1 ? segments.slice(0, -1).join("/") : ".";
}

/**
 * Project one dated file into one record per section.
 *
 * Every record is routed through {@link stampVisibility} — the single choke-point — so nothing reaches disk
 * unstamped. `self` is always private: this is the owner's internal thinking, carrying org names, teammate names,
 * internal project names and PII, and the corpus default is PUBLIC, so an unstamped record would read back as
 * public and leak the lot into a non-owner lane.
 *
 * @param dated the file plus its resolved event time
 * @param author the persona the records are attributed to (the profile's id)
 * @returns one record per retrievable section, in file order
 */
export function projectSelfFile({ dated, author }: { dated: DatedSelfFile; author: string }): readonly CorpusRecord[] {
  const { file, tsIso, timeSource } = dated;
  const container = selfContainer({ file });
  const dir = selfDir({ file });
  return splitIntoSections({ text: file.text }).map((section) =>
    stampVisibility({
      record: {
        attrs: {
          dir,
          ordinal: section.ordinal,
          part: section.part,
          parts: section.parts,
          root: file.rootName,
          timeSource,
        },
        author,
        container,
        kind: "document",
        refs: extractRefs({ text: section.text }),
        source: "self",
        sourceId: selfSourceId({
          ordinal: section.ordinal,
          part: section.part,
          relPath: file.relPath,
          rootName: file.rootName,
          slug: section.slug,
        }),
        text: section.text,
        tsIso,
        url: file.absPath,
        ...(section.title.length > 0 ? { title: section.title } : {}),
      },
      visibility: "private",
    }),
  );
}

/**
 * Project every dated file into records.
 *
 * @param files the scanned files, each paired with its resolved event time
 * @param author the persona the records are attributed to (the profile's id)
 * @returns every record, in file order then section order
 */
export function projectSelfRecords({
  files,
  author,
}: {
  files: readonly DatedSelfFile[];
  author: string;
}): readonly CorpusRecord[] {
  const records: CorpusRecord[] = [];
  for (const dated of files) {
    // `appendAll` semantics by hand — never `push(...spread)`. Measured: the spread-argument limit is around
    // 124k and stack-dependent, and this corpus projects tens of thousands of sections.
    for (const record of projectSelfFile({ author, dated })) {
      records.push(record);
    }
  }
  return records;
}
