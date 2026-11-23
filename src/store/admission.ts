/**
 * Rule D for a caller that reads one line at a time — the deferral that makes it order-independent.
 *
 * ## The problem this exists for
 *
 * The denylist's rule D keeps a denied alert when a human replied in its thread
 * ({@link ../corpus/syncExclusion}). A whole-array caller just computes the evidence first. A STREAMING
 * caller cannot: `slack/compact.jsonl` is several gigabytes read in bounded slices, and the human reply that rescues
 * an alert may be a hundred thousand lines further on, or in the next slice, or in the next invocation.
 * Judging each line as it arrives drops the parent and orphans the conversation — which a unit test over
 * an adjacent parent and reply passes happily, because it never puts them in that order.
 *
 * ## Why holding the candidates is cheap enough to be the answer
 *
 * The obvious alternatives are a second pass over the file, or an on-disk index of candidate byte offsets.
 * Neither is needed, because the candidate set is not the denied rows — it is the denied rows that are in a
 * THREAD at all, and Slack only sets `thread_ts` on a message once it is in one. MEASURED over
 * a whole store of a couple of million rows: **hundreds of** rows across every denied pair carry a
 * `thread_ts`, about a hundred of them in `#monitor-feed` — against about a million denied rows. Repro:
 *
 * ```sql
 * select count(*) from content_slack
 * where is_bot and thread_ts is not null and app_id in (<the denied app ids>);
 * ```
 *
 * So the held set is four hundred records, not a million, and an in-memory list is the whole mechanism.
 *
 * ## The cap fails towards KEEPING data, on purpose
 *
 * 471 is a measurement of this install today, not a guarantee about every corpus, so the held set is capped
 * at {@link MAX_DEFERRED_RECORDS}. Past the cap a candidate is ADMITTED rather than dropped: keeping an
 * alert nobody wanted costs one row, and dropping a parent is the exact failure rule D exists to prevent.
 * The overflow is counted so a run that hit it says so rather than quietly changing policy.
 */

import { emptyIdentityExclusion, excludeIdentities, type IdentityExclusion } from "../corpus/identityExclusion.js";
import { humanThreadKeyOf, type SyncExclusion, syncExclusionVerdict, threadKeyFor } from "../corpus/syncExclusion.js";
import type { CorpusRecord } from "../corpus/types.js";

/** The `attrs` key carrying a record's roster of people, and the key counting it. */
const ROSTER_ATTR = "attendees";
const ROSTER_COUNT_ATTR = "attendeeCount";

/**
 * How many denied in-thread records one run will hold while it waits for evidence.
 *
 * Two orders of magnitude above the 471 measured on the whole store, so the overflow path is a guard rather
 * than a thing this install reaches. See the module header for the measurement and its repro.
 */
export const MAX_DEFERRED_RECORDS = 50_000;

/** What a streaming caller should do with one record. */
export type AdmissionOutcome = "take" | "hold" | "drop";

/** One run's accumulated rule-D state: the evidence seen, and the candidates waiting on it. */
export interface StoreAdmission {
  readonly exclusion: SyncExclusion;
  /**
   * The identity denylist this run scrubs rosters against. Carried beside {@link SyncExclusion} rather than
   * threaded separately because both answer the same question — what may become indexed state — and a
   * caller holding one and forgetting the other is the failure worth designing out.
   */
  readonly identities: IdentityExclusion;
  /** Thread keys a human has been seen in, grown one record at a time. */
  readonly humanThreads: Set<string>;
  /** Denied in-thread records held until the run ends. */
  readonly deferred: CorpusRecord[];
  /** Denied records this run dropped outright. */
  excluded: number;
  /** Denied records rule D put back. */
  rescued: number;
  /** Candidates admitted because the hold was full — policy relaxed, and counted for saying so. */
  deferralOverflow: number;
  /** Roster names this run removed, so an ingest can report the scrub rather than leave it invisible. */
  identitiesScrubbed: number;
}

/**
 * Open the state one ingest run accumulates.
 *
 * @param exclusion the resolved author denylist this run judges whole records against
 * @param identities the resolved identity denylist this run scrubs rosters against, defaulting to one that
 *   excludes nobody so an existing caller keeps its exact behaviour
 * @returns the run's admission state, extended in place as records arrive
 */
export function openAdmission({
  exclusion,
  identities = emptyIdentityExclusion(),
}: {
  exclusion: SyncExclusion;
  identities?: IdentityExclusion;
}): StoreAdmission {
  return {
    deferralOverflow: 0,
    deferred: [],
    exclusion,
    excluded: 0,
    humanThreads: new Set(),
    identities,
    identitiesScrubbed: 0,
    rescued: 0,
  };
}

/**
 * Judge one record, recording the evidence it carries and the counts it moves.
 *
 * Evidence is recorded BEFORE the verdict, so a human reply read before its parent rescues that parent the
 * moment it arrives rather than sending it to the hold for no reason.
 *
 * @param record the record just read
 * @param admission the run's state, extended in place
 * @returns `take` to project it now, `hold` when rule D may yet rescue it, `drop` when nothing will
 */
export function admitRecord({
  record,
  admission,
}: {
  record: CorpusRecord;
  admission: StoreAdmission;
}): AdmissionOutcome {
  const evidence = humanThreadKeyOf({ record });
  if (evidence !== null) {
    admission.humanThreads.add(evidence);
  }
  const verdict = syncExclusionVerdict({
    exclusion: admission.exclusion,
    humanThreads: { keys: admission.humanThreads },
    record,
  });
  if (verdict === "admit") {
    return "take";
  }
  if (verdict === "deny") {
    admission.excluded += 1;
    return "drop";
  }
  if (admission.deferred.length >= MAX_DEFERRED_RECORDS) {
    admission.deferralOverflow += 1;
    return "take";
  }
  admission.deferred.push(record);
  return "hold";
}

/**
 * Settle every held candidate against the evidence the whole run gathered.
 *
 * Called once, after the last line: a caller that settled per slice would be back to judging a parent
 * before its reply had been read, which is the failure this module exists for. The hold is emptied so the
 * same record cannot be released twice by a caller that settles again.
 *
 * @param admission the run's state, extended in place
 * @returns the records rule D rescued, which the caller must still project and write
 */
export function releaseDeferred({ admission }: { admission: StoreAdmission }): readonly CorpusRecord[] {
  const released: CorpusRecord[] = [];
  admission.deferred.forEach((record) => {
    const key = threadKeyFor({ record });
    if (key !== null && admission.humanThreads.has(key)) {
      released.push(record);
      return;
    }
    admission.excluded += 1;
  });
  admission.rescued += released.length;
  admission.deferred.length = 0;
  return released;
}

/**
 * Remove every excluded name from a record's roster before it becomes indexed state.
 *
 * ## Why this is a SCRUB and not an admission verdict
 *
 * Its sibling {@link admitRecord} answers take/hold/drop about a WHOLE record, because a Datadog alert has
 * no part worth keeping. A phantom attendee is the opposite shape: the meeting is real, its transcript is
 * real, and exactly one string in its roster is not a person. Dropping the record to remove the name would
 * throw away the transcript the owner actually wants — so this narrows the record instead of judging it.
 *
 * ## Why the count is DECREMENTED rather than set to the surviving length
 *
 * `attendeeCount` is deliberately not `attendees.length`: the projection stores the roster's true size and
 * then bounds the stored list at `MAX_STORED_ATTENDEES` (`../corpus/gmail/geminiNotes`), so a large meeting
 * legitimately counts more people than it lists. Assigning the survivors' length would silently rewrite
 * every such meeting's real size to the bound. Subtracting what was removed is correct under the bound and
 * under no bound at all, which is why it is the arithmetic here.
 *
 * The one input that arithmetic cannot serve is a record whose count is ALREADY smaller than the roster it
 * counts — self-inconsistent before this ran, and impossible from either projection that writes the pair,
 * but reachable from a hand-edited bronze row. Subtracting there would write a count below the list or
 * below zero, so {@link rosterCountAfter} falls back to the surviving length, which is the only number
 * that is true of what the record now holds. It is not clamped silently: a clamp would keep the
 * contradiction and hide it.
 *
 * A record with no roster is returned unchanged and allocates nothing — the overwhelming majority of a
 * corpus this runs over, one line at a time.
 *
 * @param record the record just admitted
 * @param exclusion the resolved identity denylist
 * @returns the record to project, and how many names were removed so a run can report rather than guess
 */
export function scrubExcludedIdentities({
  record,
  exclusion,
}: {
  record: CorpusRecord;
  exclusion: IdentityExclusion;
}): { readonly record: CorpusRecord; readonly removed: number } {
  const attrs = record.attrs;
  if (attrs === undefined) {
    return { record, removed: 0 };
  }
  const roster = attrs[ROSTER_ATTR];
  if (!Array.isArray(roster)) {
    return { record, removed: 0 };
  }
  const names = roster.filter((entry): entry is string => typeof entry === "string");
  if (names.length !== roster.length) {
    return { record, removed: 0 };
  }
  const kept = excludeIdentities({ exclusion, names });
  if (kept.removed === 0) {
    return { record, removed: 0 };
  }
  const count = attrs[ROSTER_COUNT_ATTR];
  const scrubbed = {
    ...record,
    attrs: {
      ...attrs,
      [ROSTER_ATTR]: [...kept.names],
      ...(typeof count === "number"
        ? { [ROSTER_COUNT_ATTR]: rosterCountAfter({ count, kept: kept.names.length, removed: kept.removed }) }
        : {}),
    },
  };
  return { record: scrubbed, removed: kept.removed };
}

/**
 * The roster size to store once `removed` names have gone.
 *
 * Normally `count - removed`, which preserves a count that legitimately exceeds the stored list. When the
 * stored count was already below the list it counted, that subtraction produces a number below the list or
 * below zero, so the surviving length is used instead — see {@link scrubExcludedIdentities}'s header.
 *
 * @param count the roster size as stored, before the scrub
 * @param kept how many names survived
 * @param removed how many were taken out
 * @returns the count to store
 */
function rosterCountAfter({ count, kept, removed }: { count: number; kept: number; removed: number }): number {
  const decremented = count - removed;
  if (decremented < kept) {
    return kept;
  }
  return decremented;
}
