/**
 * The triage view: every leaf in a corpus, laid out with the signals that make a keep/adjust/drop decision fast.
 * Pure — hand it a corpus and a clock reading and it returns rows.
 *
 * ## It presents; it does not judge
 *
 * There is no verdict, no score and no model call. A marker-matching heuristic for "has this gone stale" was
 * tried against a real corpus during the checker's work and produced false positives, so judging whether a
 * memory is still TRUE was ruled out on evidence rather than taste. What was actually missing was not a
 * judgement — it was a legible list. Everything here is a fact read off the file.
 *
 * ## The two age sources are never merged
 *
 * Claude Code stamps `metadata.modified`, but only from v2.1.214 and only when it rewrites a file that already
 * had frontmatter — measured on a real 213-leaf corpus, 40 leaves carry it and 173 do not. So age has two
 * possible sources with genuinely different meanings: the declared field is when Claude last rewrote the
 * memory, the filesystem mtime is when the bytes last changed, which a `git checkout` or a file copy disturbs
 * without the memory changing at all.
 *
 * Every row therefore carries BOTH raw timestamps and labels which one its {@link MemorySweepRow.ageDays} came
 * from. A single blended "age" column would look authoritative and be a mixture of two different questions —
 * exactly the confident-wrong-number failure this whole programme of work exists to stop.
 *
 * ## Routing comes from the checker, not from here
 *
 * {@link routingTable} is imported rather than re-derived. Two readers of one corpus drift, and a sweep that
 * disagreed with `memory check` about which index owns a memory would be a finding about the tooling.
 *
 * The checker's FINDINGS ride on the rows for the same reason. A memory that is both orphaned and old should
 * read as one row rather than two tools' output, and running the real `checkMemoryCorpus` rather than
 * re-deriving a subset of it makes the two verbs incapable of disagreeing. Findings about an INDEX file (a dead
 * pointer, say) are attributed to that index by the checker, so they simply do not land on any leaf row — which
 * is correct: they are defects in the routing, not in a memory.
 */
import { absentAs } from "#lib/absent.js";
import { addInto, pushInto } from "#lib/collections.js";
import { checkMemoryCorpus, routingTable } from "./check.js";
import type { MemoryAgeSource, MemoryCorpus, MemoryFinding, MemoryLeaf, MemorySweep, MemorySweepRow } from "./types.js";
import { ROOT_INDEX_FILE } from "./types.js";

/** Milliseconds in a day, for turning a timestamp difference into whole days. */
const DAY_MS = 86_400_000;

/**
 * How many distinct OTHER leaves wikilink to each identity.
 *
 * Counted per LINKING FILE rather than per occurrence: a memory that mentions another three times in one body
 * is one memory depending on it, and counting three would inflate a hub for being wordy. Self-links are dropped
 * for the same reason — a file referring to itself is not something depending on it.
 */
function inboundLinkCounts({ corpus }: { corpus: MemoryCorpus }): ReadonlyMap<string, ReadonlySet<string>> {
  const linkers = new Map<string, Set<string>>();
  for (const leaf of corpus.leaves) {
    for (const link of leaf.wikilinks) {
      addInto({ key: link.target, sets: linkers, value: leaf.file });
    }
  }
  return linkers;
}

/** The set `key` names, or an empty one when the map never saw that key. */
function membersOf({
  sets,
  key,
}: {
  sets: ReadonlyMap<string, ReadonlySet<string>>;
  key: string;
}): ReadonlySet<string> {
  const members = sets.get(key);
  if (members === undefined) {
    return new Set();
  }
  return members;
}

/** Every identity a wikilink could use to reach this leaf: its filename stem, and its declared `name`. */
function identitiesOf({ leaf }: { leaf: MemoryLeaf }): readonly string[] {
  return leaf.declaredName === null || leaf.declaredName === leaf.stem ? [leaf.stem] : [leaf.stem, leaf.declaredName];
}

/** Distinct other leaves linking to any of this leaf's identities. */
function inboundFor({
  leaf,
  linkers,
}: {
  leaf: MemoryLeaf;
  linkers: ReadonlyMap<string, ReadonlySet<string>>;
}): number {
  const sources = new Set<string>();
  for (const identity of identitiesOf({ leaf })) {
    for (const source of membersOf({ key: identity, sets: linkers })) {
      if (source !== leaf.file) {
        sources.add(source);
      }
    }
  }
  return sources.size;
}

/** A timestamp string as epoch millis, or `null` when it is not one this runtime can read. */
function epochOf({ iso }: { iso: string | null }): number | null {
  if (iso === null) {
    return null;
  }
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Pick the age source and compute the age in whole days.
 *
 * The declared field wins when it is legible, because it answers the question the owner is actually asking —
 * "when did this memory last change" — and mtime only approximates it. An ILLEGIBLE declared value falls
 * through to mtime rather than reporting `none`: the stamp being unreadable says nothing about the file, and
 * the row still labels the source it used so nothing is hidden.
 *
 * A negative result is left as it is rather than clamped to zero. A file dated in the future is a real thing to
 * see — a clock skew, a bad stamp — and flooring it would erase the only evidence of it.
 */
function ageOf({ leaf, now }: { leaf: MemoryLeaf; now: number }): {
  readonly ageDays: number | null;
  readonly ageSource: MemoryAgeSource;
} {
  const declared = epochOf({ iso: leaf.declaredModified });
  if (declared !== null) {
    return { ageDays: Math.floor((now - declared) / DAY_MS), ageSource: "declared" };
  }
  if (leaf.mtimeMs !== null) {
    return { ageDays: Math.floor((now - leaf.mtimeMs) / DAY_MS), ageSource: "mtime" };
  }
  return { ageDays: null, ageSource: "none" };
}

/** An epoch reading as an ISO string, or `null`. Kept next to the declared string so both are always visible. */
function isoOf({ epochMs }: { epochMs: number | null }): string | null {
  return epochMs === null ? null : new Date(epochMs).toISOString();
}

/**
 * Where a row sorts within the default (route-grouped) order: the root index first, then topic indexes
 * alphabetically, then the leaves nothing routes. A memory's position in the hierarchy is most of its context,
 * so reading the list index by index is how a review actually goes.
 */
function routeSortKey({ routedBy }: { routedBy: readonly string[] }): readonly [number, string] {
  if (routedBy.length === 0) {
    return [2, ""];
  }
  return routedBy.includes(ROOT_INDEX_FILE) ? [0, ROOT_INDEX_FILE] : [1, routedBy[0]!];
}

/** Every `memory check` finding, grouped by the file it is attributed to, in the checker's canonical order. */
function findingsByFile({ corpus }: { corpus: MemoryCorpus }): ReadonlyMap<string, readonly MemoryFinding[]> {
  const byFile = new Map<string, MemoryFinding[]>();
  for (const finding of checkMemoryCorpus({ corpus })) {
    pushInto({ buckets: byFile, key: finding.file, value: finding });
  }
  return byFile;
}

/**
 * The `memory check` findings against one file. The checker only files a finding where it found a defect, so a
 * file with nothing wrong never appears in {@link findingsByFile} and has no findings.
 */
function findingsAgainst({
  findings,
  file,
}: {
  findings: ReadonlyMap<string, readonly MemoryFinding[]>;
  file: string;
}): readonly MemoryFinding[] {
  const filed = findings.get(file);
  if (filed === undefined) {
    return [];
  }
  return filed;
}

/** Build one row. Split out so {@link sweepMemoryCorpus} reads as its ordering rather than its field mapping. */
function rowFor({
  leaf,
  routes,
  linkers,
  findings,
  now,
  staleAfterDays,
}: {
  leaf: MemoryLeaf;
  routes: ReadonlyMap<string, ReadonlySet<string>>;
  linkers: ReadonlyMap<string, ReadonlySet<string>>;
  findings: ReadonlyMap<string, readonly MemoryFinding[]>;
  now: number;
  staleAfterDays: number | null;
}): MemorySweepRow {
  const { ageDays, ageSource } = ageOf({ leaf, now });
  return {
    ageDays,
    ageSource,
    declaredModifiedIso: leaf.declaredModified,
    declaredType: leaf.declaredType,
    description: leaf.description,
    file: leaf.file,
    fileModifiedIso: isoOf({ epochMs: leaf.mtimeMs }),
    findings: findingsAgainst({ file: leaf.file, findings }),
    inboundLinks: inboundFor({ leaf, linkers }),
    name: absentAs({ value: leaf.declaredName, whenAbsent: leaf.stem }),
    routedBy: [...membersOf({ key: leaf.stem, sets: routes })].toSorted(),
    stale: staleAfterDays !== null && ageDays !== null && ageDays >= staleAfterDays,
  };
}

/**
 * Lay a whole corpus out for triage.
 *
 * Ordering: stale rows first when `--stale-after` is set (the flag orders attention, it never filters — the
 * owner is reviewing everything), then grouped by routing index, then by filename. Deliberately NOT ordered by
 * inbound links or by age across the whole list: ranking by age would put the two sources in one ordering, and
 * ranking by inbound links would promote whatever is oldest, since links accumulate with time. Both signals are
 * presented on the row for the owner to weigh; neither decides what the owner reads first.
 *
 * @param corpus the classified corpus
 * @param now the current epoch milliseconds, injected so this stays pure and every age is reproducible
 * @param staleAfterDays mark rows at least this many days old, or `null` to mark none
 * @returns every leaf as a row, in the order described above; no rows at all when there is no root index
 */
export function sweepMemoryCorpus({
  corpus,
  now,
  staleAfterDays,
}: {
  corpus: MemoryCorpus;
  now: number;
  staleAfterDays: number | null;
}): MemorySweep {
  // No `MEMORY.md` means this is not a memory corpus, and listing whatever markdown the directory happens to
  // hold as "your memories" is the confident wrong answer that requiring `--dir` exists to prevent. The same
  // decision `checkMemoryCorpus` makes, for the same reason.
  if (corpus.root === null) {
    return { rootIndexMissing: true, rows: [], staleAfterDays };
  }
  const linkers = inboundLinkCounts({ corpus });
  const routes = routingTable({ corpus });
  const findings = findingsByFile({ corpus });
  const rows = corpus.leaves
    .map((leaf) => rowFor({ findings, leaf, linkers, now, routes, staleAfterDays }))
    .toSorted((a, b) => {
      const [aRank, aRoute] = routeSortKey({ routedBy: a.routedBy });
      const [bRank, bRoute] = routeSortKey({ routedBy: b.routedBy });
      return (
        Number(b.stale) - Number(a.stale) ||
        aRank - bRank ||
        aRoute.localeCompare(bRoute) ||
        a.file.localeCompare(b.file)
      );
    });
  return { rootIndexMissing: false, rows, staleAfterDays };
}
