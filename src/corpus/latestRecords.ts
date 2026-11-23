/**
 * The LOGICAL LATEST-RECORD VIEW — one record per logical entity, chosen by one rule that every reader
 * shares.
 *
 * Bronze is append-only: a genuine edit writes a NEW line beside the old one (see {@link ./corpusWriter}).
 * That is correct for a durable capture and wrong for everything that reads it, because a reader handed
 * every physical line scores stale versions of the same entity as independent documents. Measured on a real
 * corpus before this module existed: 2,868 of 227,084 records (1.26%) were superseded versions still being
 * indexed, one entity carrying six of them.
 *
 * ## The identity key is `(source, container, sourceId)` — and the container is load-bearing
 *
 * `sourceId` alone is NOT unique. GitHub numbers issues PER REPOSITORY, so `#<number>` exists in every repo the
 * corpus has ever seen; on the corpus this was written against, 33 GitHub `sourceId`s spanned more than one
 * container and one spanned six. Collapsing on `(source, sourceId)` would silently merge unrelated issues
 * and drop the losers from every answer forever.
 *
 * It is worth being precise about what kind of defect that would be: a read-time VIEW defect, not data
 * corruption. The bronze bytes stay correct and complete — rebuilding the corpus would not fix it, because
 * the merge happens on the way out, on every query. Linear and Slack ids happen to be globally unique, so a
 * test suite exercising either alone passes while GitHub silently loses records.
 *
 * ## The winner rule, including the cases that are easy to get wrong
 *
 * Newest `tsIso` wins. Three further tie-breaks exist so the rule is a TOTAL order — a partial order would let
 * the winner depend on directory read order, which varies by filesystem and would make retrieval
 * non-deterministic between two runs over identical bytes:
 *
 *  1. **A capture that declares itself incomplete loses a tie to one that does not**, when the two carry
 *     identical `text`. This rule is not a precaution: `slopweaver dev capture-conflicts --source notion`
 *     reported **14,613** groups holding both a `capture: "partial"` row and a complete one at the same
 *     instant and text, and rule 2 below gave every single one of them to the TRUNCATED row —
 *     because a repaired capture is byte-for-byte its predecessor MINUS `,"capture":"partial"`, so the marker
 *     that says a row is incomplete is exactly what made it the longer one. The equal-`text` guard is what
 *     keeps this from overruling rule 2 in the other direction; {@link supersedes} carries the counterexample.
 *  2. **Richer content wins a timestamp tie.** Two captures at the same instant are usually the same entity
 *     seen through a narrower and a wider projection; preferring the longer canonical serialisation stops an
 *     incomplete snapshot from evicting a complete one.
 *  3. **Canonical serialisation breaks a remaining tie**, purely so the choice is stable rather than
 *     arbitrary.
 *
 * Nothing here mutates or merges records. The loser is hidden from the view, never deleted from bronze —
 * bronze remains the durable capture.
 */
import { serialiseRecord } from "./recordSerialisation.js";
import { CAPTURE_ATTR, CAPTURE_PARTIAL, type CorpusRecord } from "./types.js";

/** The separator the identity key joins on: NUL, which no ESCAPED part can contain. */
const IDENTITY_SEPARATOR = "\u0000";

/** The sources whose timestamp ties are settled by position, every row a whole re-projection: see {@link rescanWins}. */
const READ_WHOLE_SOURCES: ReadonlySet<string> = new Set(["chatgpt", "self"]);

/**
 * Make one part of an identity key unable to forge the separator: a backslash doubles, and a NUL becomes
 * the two characters `\\0`. A part containing neither — every id and container any connector has ever
 * produced — comes back byte-identical, so no existing key moves. Pure.
 */
function escapePart({ part }: { part: string }): string {
  return part.replaceAll("\\", "\\\\").replaceAll(IDENTITY_SEPARATOR, "\\0");
}

/**
 * The logical identity of a record: `source`, `container` and `sourceId`, each escaped, joined by NUL.
 *
 * The escape is not ceremony. This module used to assert that a NUL "cannot occur in any of the three" —
 * but `corpusStore.validateRowCore` accepts any non-empty string, so a row whose container is
 * `acme<NUL>api` keys identically to one whose container is `acme` and whose sourceId is `api<NUL>#1`.
 * Two unrelated records would collapse into one, and the loser would be counted as a superseded version:
 * the exact silent loss this collapse exists to prevent, wearing the collapse's own clothes. No connector
 * produces such an id today, so the invariant is now ENFORCED rather than assumed and asserted. Pure.
 *
 * @param record the record to key
 * @returns the logical identity key
 */
export function recordIdentity({ record }: { record: CorpusRecord }): string {
  return identityOf({ container: record.container, source: record.source, sourceId: record.sourceId });
}

/**
 * The same identity key computed from the three fields alone, for a caller holding a REFERENCE to a record
 * rather than the record itself.
 *
 * Split out so a pinned brief ref and a loaded record can never disagree about what "the same record" means:
 * there is exactly one escaping-and-joining implementation, and both go through it. The alternative — a
 * caller assembling a partial object and asserting it is a `CorpusRecord` — is a cast this repo bans, and it
 * would be a lie about a value that has none of the other fields.
 *
 * @param source the record's source
 * @param container the container within that source
 * @param sourceId the id within that container
 * @returns the logical identity key
 */
export function identityOf({
  source,
  container,
  sourceId,
}: {
  source: string;
  container: string;
  sourceId: string;
}): string {
  return [source, container, sourceId].map((part) => escapePart({ part })).join(IDENTITY_SEPARATOR);
}

/**
 * The instant a `tsIso` denotes, ranked so the winner rule stays a TOTAL order: a value no parser accepts
 * ranks `-Infinity`, below every real timestamp, rather than `NaN`.
 *
 * `NaN` would be fatal here, and not only because every comparison against it is false. Letting an
 * unparseable pair "fall through" to the content tie-breaks makes the relation NON-TRANSITIVE: a long
 * unparseable row beats a short dated one on length, that dated row beats a long dated one on nothing at
 * all, and the dated rows order by instant — a cycle, which `latestRecords` folds through a Map, so the
 * survivor becomes whichever row was read first. Ranking unparseable as `-Infinity` keeps the comparison a
 * lexicographic order on (instant, length, row), every part of which is total. Pure.
 */
function instantOf({ tsIso }: { tsIso: string }): number {
  const parsed = Date.parse(tsIso);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Whether one `tsIso` is LATER than a DIFFERENT one — the whole of the winner rule whenever two versions'
 * timestamps are not the same string. Pure, and a total order over distinct strings.
 *
 * Split out of {@link supersedes} so the streaming census can decide a differing-timestamp pair from the two
 * strings it keeps, without re-reading either row: every other branch of the rule needs record content, and
 * this one provably does not.
 *
 * @param candidate the later-read version's `tsIso`
 * @param incumbent the held version's `tsIso`, which must differ from `candidate`
 * @returns true when `candidate` is the later timestamp
 */
export function laterTimestamp({ candidate, incumbent }: { candidate: string; incumbent: string }): boolean {
  const candidateAt = instantOf({ tsIso: candidate });
  const incumbentAt = instantOf({ tsIso: incumbent });
  // Compare INSTANTS, not the strings. `corpusStore` accepts any non-empty `tsIso`, and 12.2% of the
  // records measured here carry a `+10:00` offset rather than `Z` — and `"…T00:30:00+10:00"` sorts ABOVE
  // a `Z` instant at midnight of the same date while being the EARLIER moment. Comparing strings would then keep the older row and
  // hand the stale prose to the only verb that spends tokens. No entity currently mixes the two formats
  // (0 of 7,663 multi-version entities, so this changes no winner today), but nothing prevents one: a
  // connector that changes its timestamp rendering is all it takes.
  if (candidateAt !== incumbentAt) {
    return candidateAt > incumbentAt;
  }
  // Equal RANK, but the strings still differ — the same instant written two ways (`+10:00` vs `Z`), both
  // unparseable, or two timestamps `Date.parse` truncated to the same millisecond. That last case is why
  // the raw strings are compared BEFORE content: `…00.0009Z` and `…00.0001Z` are one instant to
  // `Date.parse`, and deciding between them on serialised length would let a longer, EARLIER row win.
  // Comparing the strings keeps sub-millisecond ordering that the instant comparison cannot see.
  return candidate > incumbent;
}

/**
 * Whether `candidate` supersedes `incumbent` under the shared winner rule. Pure, and a TOTAL order, so the
 * outcome never depends on the order records were read in.
 *
 * @param candidate the record being considered
 * @param incumbent the record currently held for this identity
 * @returns true when the candidate should replace the incumbent
 */
export function supersedes({ candidate, incumbent }: { candidate: CorpusRecord; incumbent: CorpusRecord }): boolean {
  if (candidate.tsIso !== incumbent.tsIso) {
    return laterTimestamp({ candidate: candidate.tsIso, incumbent: incumbent.tsIso });
  }
  // Same instant, same text: the row that does NOT declare itself incomplete wins. This runs BEFORE the
  // length tie-break because the marker MAKES a row longer — a repaired capture is byte-for-byte its
  // truncated predecessor minus `,"capture":"partial"`, so length alone systematically keeps the truncated
  // one. Guarded on equal `text` so it can only ever break a tie the length rule was going to get wrong,
  // never overrule a genuinely richer body: the databases lane writes a comments-only row as COMPLETE with
  // no block body at all, and preferring "complete" unconditionally would let that evict a fuller page-lane
  // capture of the same row.
  if (
    candidate.text === incumbent.text &&
    declaresPartial({ candidate }) !== declaresPartial({ candidate: incumbent })
  ) {
    return !declaresPartial({ candidate });
  }
  const candidateRow = serialiseRecord({ record: candidate });
  const incumbentRow = serialiseRecord({ record: incumbent });
  if (candidateRow.length !== incumbentRow.length) {
    return candidateRow.length > incumbentRow.length;
  }
  return candidateRow > incumbentRow;
}

/** Whether a record's own attrs declare its capture incomplete (see {@link ./types.CAPTURE_ATTR}). Pure. */
function declaresPartial({ candidate }: { candidate: CorpusRecord }): boolean {
  return candidate.attrs?.[CAPTURE_ATTR] === CAPTURE_PARTIAL;
}

/**
 * Whether a LATER-READ record replaces the one currently held for its identity — the whole winner rule
 * {@link latestRecords} folds with, as one call.
 *
 * Exported for the streaming census (`./corpusCensus.ts`), which holds a byte range rather than a record and
 * re-reads both rows only when their timestamps tie. Two copies of this rule is how two readers of one
 * corpus start disagreeing about which version is current ({@link laterCaptureWins} carries that history),
 * so the census calls this rather than restating it. Pure.
 *
 * @param candidate the record read later
 * @param incumbent the record currently held for the same identity
 * @returns true when the candidate should replace the incumbent
 */
export function latestWins({ candidate, incumbent }: { candidate: CorpusRecord; incumbent: CorpusRecord }): boolean {
  return supersedes({ candidate, incumbent }) || rescanWins({ candidate, incumbent });
}

/**
 * Collapse records to the logical latest view: one record per `(source, container, sourceId)`, chosen by
 * {@link latestWins}. Input order is preserved for the survivors, so a caller that fed records in a
 * meaningful order still gets that order back. Pure.
 *
 * @param records the records to collapse (any order, any number of versions per identity)
 * @returns one record per logical identity, in first-seen order
 */
export function latestRecords({ records }: { records: readonly CorpusRecord[] }): readonly CorpusRecord[] {
  // A Map keeps FIRST-insertion order even when an existing key is overwritten, so replacing a superseded
  // record in place preserves the position its identity first appeared at — no parallel order array needed.
  const winners = new Map<string, CorpusRecord>();
  for (const record of records) {
    const key = recordIdentity({ record });
    const incumbent = winners.get(key);
    if (incumbent === undefined || latestWins({ candidate: record, incumbent })) {
      winners.set(key, record);
    }
  }
  return [...winners.values()];
}

/**
 * Whether a LATER-READ row should win a timestamp tie because it can only be a re-scan of edited content.
 *
 * The general rule prefers the richer capture on a tie, and that is right for a network source: two captures
 * at one instant are usually the same entity through a narrower and a wider projection, so the longer one is
 * the more complete one. `self` has no such pair. A file is read whole, once, per scan — so two rows sharing
 * an identity AND a timestamp can only be two scans of a file that was EDITED between them, and its `tsIso`
 * is the file's event time, which an edit does not move.
 *
 * Measured on the real corpus before this existed: 22 records were shadowed this way, and 15 of them held
 * sentences their winner did not. Editing a note to say something SHORTER wrote a row that lost to its own
 * stale predecessor, permanently — so the latest view served text that was no longer on disk. Verified on
 * one identity: two rows of 1,144 and 1,101 characters, the 1,144 winning while only the 1,101 still
 * matched the file. Whether the lost sentences were reachable ELSEWHERE varied — duplicate backup copies
 * often carried them — so the honest claim is that the canonical record was wrong, not that the content
 * was universally unreachable.
 *
 * Position is the signal, and it is trustworthy: bronze is append-only and {@link ./corpusStore} now reads
 * its files in sorted order, so later-in-input means later-written.
 *
 * The `transcript` kind has the SAME property, and needed it for the same reason. A meeting record's
 * `tsIso` is the carrier email's send instant, which no re-projection moves, and the notes document is
 * read whole in one call — so two rows sharing an identity AND a timestamp can only be two projections of
 * one meeting, and the later one is the current projection by construction. Measured on the owner's corpus,
 * when {@link ./gmail/project.meetingBody} stopped storing Gemini's summary: the transcript
 * was 68.4% of the stored characters across 40 read documents, so every re-projected meeting was SHORTER
 * than the row it replaced and would have lost to its own stale predecessor — the ruling would have had no
 * visible effect on a single answer. The population is the `transcript` rows in the owner's own corpus; the
 * command that took the reading has since been retired, so the figure stands on its date rather than on a
 * repro this file cannot honestly hand a reader.
 *
 * The `chatgpt` source has it too. A message's `tsIso` is the instant it was said, which renaming its chat or
 * switching which reply is current does not move, and each version of a conversation is projected whole, from
 * its latest version across every held export (`./chatgpt/ingest.ts`) — so two rows sharing an identity AND a
 * timestamp are two projections of one message, and the later-written is the current one. Left to length, a
 * chat renamed to a shorter title, or a reply moved back from `alternate` to `current`, kept serving its stale
 * predecessor while the store held the new one.
 *
 * Confined to `self`, `chatgpt` and `transcript` so no other network source's narrow/wide semantics change.
 *
 * @param candidate the record being considered (later in the input than the incumbent)
 * @param incumbent the record currently held for this identity
 * @returns true when the candidate is a later capture of the same entity at the same event time
 */
function rescanWins({ candidate, incumbent }: { candidate: CorpusRecord; incumbent: CorpusRecord }): boolean {
  return (
    candidate.tsIso === incumbent.tsIso &&
    laterCaptureWins({
      candidate: { kind: candidate.kind, source: candidate.source },
      incumbent: { kind: incumbent.kind, source: incumbent.source },
    })
  );
}

/**
 * Whether a timestamp tie between these two rows is settled by POSITION rather than by content — the
 * read-once test, split out from {@link rescanWins} so there is exactly ONE implementation of it.
 *
 * It is split out because there were two, and the second was invisible. The streaming lexical index build
 * kept a census entry rather than a record, so it carried its own copy of this rule — hard-coded to `self`.
 * Measured: extending the rule HERE to the `transcript` kind made `latestRecords` pick the newly
 * re-projected meeting rows while the prebuilt index kept serving their superseded predecessors, so a
 * question answered from Gemini's summary out of an index built minutes earlier. Two implementations of one rule is
 * one implementation and one silent liar. That index and its copy are deleted;
 * the rule stays split out because the finding is about duplication, not about the index.
 *
 * Both callers pass the two sides' `source` and `kind`; the tsIso equality is the caller's own guard,
 * because the census can decide that from strings alone without re-reading a row. Pure.
 *
 * @param candidate the later-read row's source and kind
 * @param incumbent the held row's source and kind
 * @returns true when the later-read row is the current capture and should win the tie
 */
function laterCaptureWins({
  candidate,
  incumbent,
}: {
  candidate: { source: string; kind: string };
  incumbent: { source: string; kind: string };
}): boolean {
  const sameReadWholeSource = candidate.source === incumbent.source && READ_WHOLE_SOURCES.has(candidate.source);
  return sameReadWholeSource || (candidate.kind === "transcript" && incumbent.kind === "transcript");
}

/**
 * How many records the latest view hides — the count of superseded versions. Reported rather than silently
 * dropped, so a reader can say how much of what it loaded was stale instead of the number vanishing. Pure.
 *
 * @param records the records before collapsing
 * @param collapsed the result of {@link latestRecords} over the same input
 * @returns the number of superseded records hidden by the view
 */
export function supersededCount({
  records,
  collapsed,
}: {
  records: readonly CorpusRecord[];
  collapsed: readonly CorpusRecord[];
}): number {
  return records.length - collapsed.length;
}
