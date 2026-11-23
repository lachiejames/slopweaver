/**
 * What every opportunity detector emits and the recency, rounding and citation helpers they share, plus the
 * blocker detector. The scan that runs all three detectors, and why they score as they do, is
 * {@link ./opportunityScan}.
 *
 * The blocker detector is split into pure cores ({@link blockerCitationInfo} + {@link blockerOpportunityForRecord})
 * so the "stale only when a recent record still cites it" decision is unit-tested in isolation.
 */

import type { CorpusRecord } from "../corpus/types.js";
import { readsUnresolvedText } from "../corpus/unresolvedText.js";
import { compareStrings } from "../lib/compare.js";
import { parseIsoMs } from "../lib/date.js";

export interface Opportunity {
  readonly kind: "cross-cutting" | "blocker" | "duplication";
  readonly subject: string;
  /** The citations, capped at {@link MAX_EVIDENCE_PER_OPPORTUNITY} (see `evidenceCount` for the true total). */
  readonly evidence: readonly string[];
  /** How many distinct records back this opportunity BEFORE the evidence cap — the honest breadth. */
  readonly evidenceCount: number;
  readonly score: number;
  readonly summary: string;
}

/** Why a candidate that cleared the breadth threshold was dropped — counted, never silently discarded. */
export interface OpportunityDrops {
  /** Cross-cutting candidates whose token was a known non-entity (email-provider domain, integration handle). */
  readonly genericToken: number;
  /** Cross-cutting candidates whose token was a bare `@mention` — a person, not a shared artifact. */
  readonly mentionOnly: number;
  /** Cross-cutting candidates whose token was neither concrete nor a mention (a bare word, a root URL). */
  readonly nonEntityToken: number;
  /** Blocker candidates whose cited target carried no title (an opaque source id is not an insight). */
  readonly untitledTarget: number;
  /** Duplication candidates whose shared title was too short to be a real match. */
  readonly shortTitle: number;
  /** Blocker candidates that repeated an already-emitted subject (the same item ingested twice). */
  readonly duplicateSubject: number;
  /** Emitted opportunities whose evidence list was truncated by the cap (`evidenceCount` keeps the total). */
  readonly cappedEvidence: number;
}

const STALE_AFTER_DAYS = 14;
const DAY_MS = 86_400_000;

/** Evidence past this count marks a sprawling clique — the crisp/mega line the audit reports on. */
export const CRISP_EVIDENCE = 5;
/** Hard ceiling on emitted citations per opportunity (the true total lives in `evidenceCount`). */
export const MAX_EVIDENCE_PER_OPPORTUNITY = 12;

/**
 * Recency weight in [0,1]: 1 at `nowMs`, linearly decaying to 0 at `STALE_AFTER_DAYS` old.
 *
 * @returns the weight, 0 when `tsIso` does not parse
 */
export function recencyWeight({ tsIso, nowMs }: { tsIso: string; nowMs: number }): number {
  const t = parseIsoMs({ tsIso });
  if (t === undefined) {
    return 0;
  }
  const days = (nowMs - t) / DAY_MS;
  return Math.min(1, Math.max(0, 1 - days / STALE_AFTER_DAYS));
}

/**
 * Round a score to 4 decimal places.
 *
 * @returns the rounded value
 */
export function round4({ value }: { value: number }): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Citation-friendly reference to a record: its url, else `source:sourceId`.
 *
 * @returns the citation string
 */
export function evidenceOf({ record }: { record: CorpusRecord }): string {
  return record.url.length > 0 ? record.url : `${record.source}:${record.sourceId}`;
}

/**
 * True when a record reads as unresolved/open work.
 *
 * Prefers the flag the `derive` projection precomputed at parse time, and falls back to testing the words
 * when it is absent. The fallback is what keeps the two paths honest: a projection that dropped `text` and
 * had no flag would otherwise answer `false` for every record and quietly empty this detector.
 */
function readsUnresolved({ record }: { record: CorpusRecord }): boolean {
  const { unresolved } = record;
  if (unresolved == null) {
    return readsUnresolvedText({ text: record.text, ...(record.title !== undefined ? { title: record.title } : {}) });
  }
  return unresolved;
}

/** The mutable drop tally each detector adds to (frozen into {@link OpportunityDrops} by the caller). */
export interface DropTally {
  genericToken: number;
  mentionOnly: number;
  nonEntityToken: number;
  untitledTarget: number;
  shortTitle: number;
  duplicateSubject: number;
  cappedEvidence: number;
}

interface CiteInfo {
  readonly containers: Set<string>;
  /** The newest citing record's time (ms) — a recent citer means someone is CURRENTLY waiting. */
  latestCiterMs: number;
}

/**
 * Index, per referenced token, which containers cite it and the newest citer's time. Pure.
 *
 * @param records the corpus records
 * @returns the citation info by cited token
 */
export function blockerCitationInfo({ records }: { records: readonly CorpusRecord[] }): Map<string, CiteInfo> {
  const citeInfo = new Map<string, CiteInfo>();
  for (const record of records) {
    const citerMs = parseIsoMs({ tsIso: record.tsIso });
    for (const token of record.refs) {
      const info = citeInfo.get(token) ?? { containers: new Set<string>(), latestCiterMs: 0 };
      info.containers.add(record.container);
      if (citerMs !== undefined) {
        info.latestCiterMs = Math.max(info.latestCiterMs, citerMs);
      }
      citeInfo.set(token, info);
    }
  }
  return citeInfo;
}

/**
 * Why a cited record reads like a blocker: `stale` (it is old AND a RECENT record still cites it, so someone
 * is currently waiting) or `unresolved` (its text reads like open work). `undefined` when it is neither —
 * staleness alone (a valid old record that merely predates the window) is NOT a blocker. Pure; separated from
 * {@link blockerOpportunityForRecord} so the title requirement can be applied (and counted) independently.
 *
 * @param record the potential target
 * @param citing the citation info for this record's `sourceId` (undefined ⇒ never cited)
 * @param nowMs the corpus-newest reference time
 * @returns the blocker signal, or undefined
 */
function blockerSignal({
  record,
  citing,
  nowMs,
}: {
  record: CorpusRecord;
  citing: CiteInfo | undefined;
  nowMs: number;
}): "stale" | "unresolved" | undefined {
  if (citing === undefined) {
    return undefined;
  }
  const targetStale = recencyWeight({ nowMs, tsIso: record.tsIso }) <= 0;
  const citerRecent = citing.latestCiterMs > 0 && (nowMs - citing.latestCiterMs) / DAY_MS < STALE_AFTER_DAYS;
  if (targetStale && citerRecent) {
    return "stale";
  }
  return readsUnresolved({ record }) ? "unresolved" : undefined;
}

/**
 * The blocker opportunity for one target record, or `undefined` when it isn't a blocker. A record is a
 * blocker when it carries a {@link blockerSignal} AND a TITLE: an opaque source id "referenced but stale" is
 * noise, not an insight (PR4.8). Pure.
 *
 * @param record the potential target
 * @param citing the citation info for this record's `sourceId` (undefined ⇒ never cited)
 * @param nowMs the corpus-newest reference time
 * @returns the blocker opportunity, or undefined
 */
export function blockerOpportunityForRecord({
  record,
  citing,
  nowMs,
}: {
  record: CorpusRecord;
  citing: CiteInfo | undefined;
  nowMs: number;
}): Opportunity | undefined {
  const title = record.title;
  const signal = blockerSignal({ citing, nowMs, record });
  if (signal === undefined || citing === undefined || title === undefined || title.length === 0) {
    return undefined;
  }
  const stale = signal === "stale";
  const breadth = citing.containers.size;
  const subject = record.sourceId;
  return {
    evidence: [evidenceOf({ record })],
    evidenceCount: 1,
    kind: "blocker",
    score: round4({ value: breadth * (stale ? 1.5 : 1) }),
    subject,
    summary: stale
      ? `${subject} ("${title}") is referenced but stale — ${String(breadth)} container(s) may be waiting`
      : `${subject} ("${title}") is referenced and reads unresolved across ${String(breadth)} container(s)`,
  };
}

/**
 * Whether a duplicate blocker should replace the one already held for its subject: higher score wins, and an
 * equal score is broken on the summary text. The tie-break matters — the corpus is read with an UNSORTED
 * directory walk, so "first one seen wins" would make the emitted blocker filesystem-dependent. Pure.
 *
 * @param candidate the newly-built blocker
 * @param incumbent the blocker already held for this subject
 * @returns true when the candidate should replace the incumbent
 */
function beatsBlocker({ candidate, incumbent }: { candidate: Opportunity; incumbent: Opportunity }): boolean {
  return (
    candidate.score > incumbent.score ||
    (candidate.score === incumbent.score && compareStrings({ a: candidate.summary, b: incumbent.summary }) < 0)
  );
}

/**
 * Blocker candidates over the corpus, tallying the targets that carried a real blocker SIGNAL but no title —
 * so `untitledTarget` counts what was actually suppressed, not every cited-but-untitled record.
 *
 * @returns the blockers, one per subject
 */
export function spotBlockers({
  records,
  nowMs,
  drops,
}: {
  records: readonly CorpusRecord[];
  nowMs: number;
  drops: DropTally;
}): readonly Opportunity[] {
  const citeInfo = blockerCitationInfo({ records });
  // Deduped by subject: one item can arrive as several records (the same issue re-ingested in two windows,
  // or an issue plus its update), and emitting the identical blocker N times is pure output noise. The
  // highest-scoring instance wins (widest set of waiting containers).
  const bySubject = new Map<string, Opportunity>();
  for (const record of records) {
    const citing = citeInfo.get(record.sourceId);
    const opportunity = blockerOpportunityForRecord({ citing, nowMs, record });
    if (opportunity === undefined) {
      if (
        (record.title === undefined || record.title.length === 0) &&
        blockerSignal({ citing, nowMs, record }) !== undefined
      ) {
        drops.untitledTarget += 1;
      }
      continue;
    }
    const existing = bySubject.get(opportunity.subject);
    if (existing !== undefined) {
      drops.duplicateSubject += 1;
    }
    if (existing === undefined || beatsBlocker({ candidate: opportunity, incumbent: existing })) {
      bySubject.set(opportunity.subject, opportunity);
    }
  }
  return [...bySubject.values()];
}
