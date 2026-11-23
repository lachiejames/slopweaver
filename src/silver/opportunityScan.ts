/**
 * Opportunity detection over the corpus + graph. Pure, deterministic. Three signal detectors, each
 * scored with a recency weight measured against the NEWEST record in the corpus (not wall-clock now), so
 * scores are stable across runs:
 *
 *  - cross-cutting: one CONCRETE reference touched by many distinct containers (a shared artifact).
 *  - blocker: a referenced, TITLED item that reads stale or unresolved (others are waiting on it).
 *  - duplication: the same substantial title appearing across distinct sources (parallel work).
 *
 * PR4.8 — PRECISION over recall. The pre-PR4.8 scorer rewarded clique SIZE, so its top-scored
 * "opportunities" were frequency artifacts (a mined email-domain fragment referenced across 35 containers,
 * up to 1,624 evidence items on one clique) while the crisp, actually-actionable ones never surfaced. Four
 * changes, all pure and all reported (never silently applied — see {@link OpportunityDrops}):
 *
 *  1. **Concrete-signal requirement** — cross-cutting admits only a `concrete` token (issue/PR number,
 *     ticket key, artifact URL). A shared `@mention` is a person, not a shared artifact; the directory
 *     already surfaces people. See {@link ./opportunityToken}.
 *  2. **Mega-clique penalty** — breadth is logarithmic, and both a hub penalty (containers past
 *     {@link HUB_CONTAINERS}) and an evidence penalty (evidence past {@link CRISP_EVIDENCE}) decay the score,
 *     so a sprawling clique ranks BELOW a crisp one instead of above it.
 *  3. **Evidence cap** — at most {@link MAX_EVIDENCE_PER_OPPORTUNITY} citations are emitted, with the TRUE
 *     total kept in `evidenceCount` so nothing is silently lost (and the audit's crisp/mega yardstick still
 *     measures real breadth, not the truncated list).
 *  4. **Title requirements** — a blocker needs a titled target (an opaque source id is not an insight) and a
 *     duplication needs a substantial title, so title-less noise never surfaces.
 *
 * The blocker detector lives in {@link ./opportunity}, with the types and helpers all three share.
 */

import type { CorpusRecord, CorpusSource } from "../corpus/types.js";
import { sortedUnique } from "../lib/collections.js";
import { compareStrings } from "../lib/compare.js";
import { parseIsoMs } from "../lib/date.js";
import type { GraphEdge } from "./graph.js";
import {
  CRISP_EVIDENCE,
  type DropTally,
  evidenceOf,
  MAX_EVIDENCE_PER_OPPORTUNITY,
  type Opportunity,
  type OpportunityDrops,
  recencyWeight,
  round4,
  spotBlockers,
} from "./opportunity.js";
import { classifyOpportunityToken } from "./opportunityToken.js";

/** The detector's whole output: the surviving opportunities plus what was dropped and why. */
export interface OpportunityScan {
  readonly opportunities: readonly Opportunity[];
  readonly drops: OpportunityDrops;
}

const CROSS_CUTTING_MIN_CONTAINERS = 3;

/** Containers past this count mark a hub token, whose score decays inversely with its breadth. */
const HUB_CONTAINERS = 12;
/** A shared duplication title must normalise to at least this many characters to count as a real match. */
const MIN_DUPLICATION_TITLE_CHARS = 8;

/** The newest record time in the corpus, as ms — the reference point for recency. */
function corpusNowMs({ records }: { records: readonly CorpusRecord[] }): number {
  let max = 0;
  for (const record of records) {
    const t = parseIsoMs({ tsIso: record.tsIso });
    if (t !== undefined && t > max) {
      max = t;
    }
  }
  return max;
}

/** Normalise a title for duplicate detection: lowercase, non-alphanumerics → space, collapse whitespace. */
function normaliseTitle({ title }: { title: string }): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** A zeroed drop tally. */
function noDrops(): DropTally {
  return {
    cappedEvidence: 0,
    duplicateSubject: 0,
    genericToken: 0,
    mentionOnly: 0,
    nonEntityToken: 0,
    shortTitle: 0,
    untitledTarget: 0,
  };
}

/**
 * Cap an opportunity's citations at {@link MAX_EVIDENCE_PER_OPPORTUNITY}, keeping the TRUE total. Sorted
 * first, so the kept slice is deterministic (never "whichever records happened to be scanned first"). Pure.
 *
 * @param evidence the distinct citations backing an opportunity
 * @returns the capped citation list and the true count
 */
function capEvidence({ evidence }: { evidence: readonly string[] }): {
  evidence: readonly string[];
  evidenceCount: number;
} {
  const sorted = sortedUnique({ values: [...evidence] });
  return { evidence: sorted.slice(0, MAX_EVIDENCE_PER_OPPORTUNITY), evidenceCount: sorted.length };
}

/**
 * The cross-cutting score for a CONCRETE token's clique. Breadth is logarithmic (so a wide clique can't
 * out-rank a crisp one on size alone), then decayed by a hub penalty (containers past
 * {@link HUB_CONTAINERS}) and an evidence penalty (citations past {@link CRISP_EVIDENCE}), lifted by
 * recency, and boosted when the cross-ref graph confirmed the token linked real records. Pure.
 *
 * @param containers how many distinct containers reference the token
 * @param evidenceCount how many distinct records back it (the TRUE count, pre-cap)
 * @param recency the clique's newest-record recency weight, in [0,1]
 * @param linked whether the cross-ref graph formed an edge via this token
 * @returns the score, rounded to 4 decimals (0 when the clique is too narrow to be cross-cutting)
 */
function crossCuttingScore({
  containers,
  evidenceCount,
  recency,
  linked,
}: {
  containers: number;
  evidenceCount: number;
  recency: number;
  linked: boolean;
}): number {
  if (containers < CROSS_CUTTING_MIN_CONTAINERS) {
    return 0;
  }
  const breadth = Math.log2(containers + 1);
  const hubPenalty = containers > HUB_CONTAINERS ? HUB_CONTAINERS / containers : 1;
  const evidencePenalty = evidenceCount > CRISP_EVIDENCE ? CRISP_EVIDENCE / evidenceCount : 1;
  const linkBoost = linked ? 1.25 : 1;
  return round4({ value: breadth * hubPenalty * evidencePenalty * (0.5 + 0.5 * recency) * linkBoost });
}

interface CrossCutAccum {
  readonly containers: Set<string>;
  readonly evidence: Set<string>;
  recency: number;
}

/** Index every ref token to the containers/records that hold it and the clique's newest recency. */
function indexCrossCutTokens({
  records,
  nowMs,
}: {
  records: readonly CorpusRecord[];
  nowMs: number;
}): Map<string, CrossCutAccum> {
  const byToken = new Map<string, CrossCutAccum>();
  for (const record of records) {
    const recency = recencyWeight({ nowMs, tsIso: record.tsIso });
    for (const token of record.refs) {
      // The first record to reference a token opens its clique; every later one widens it.
      if (!byToken.has(token)) {
        byToken.set(token, { containers: new Set<string>(), evidence: new Set<string>(), recency: 0 });
      }
      const accum = byToken.get(token)!;
      accum.containers.add(record.container);
      accum.evidence.add(evidenceOf({ record }));
      accum.recency = Math.max(accum.recency, recency);
    }
  }
  return byToken;
}

/** Tally a rejected cross-cutting token against the drop class that explains it. */
function countTokenDrop({ token, drops }: { token: string; drops: DropTally }): void {
  const tokenClass = classifyOpportunityToken({ token });
  if (tokenClass === "generic") {
    drops.genericToken += 1;
  } else if (tokenClass === "mention") {
    drops.mentionOnly += 1;
  } else {
    drops.nonEntityToken += 1;
  }
}

/** One cross-cutting opportunity for a concrete token's clique (evidence capped, score decayed). */
function crossCuttingOpportunity({
  token,
  accum,
  viaTokens,
  drops,
}: {
  token: string;
  accum: CrossCutAccum;
  viaTokens: ReadonlySet<string>;
  drops: DropTally;
}): Opportunity {
  const breadth = accum.containers.size;
  const capped = capEvidence({ evidence: [...accum.evidence] });
  if (capped.evidenceCount > capped.evidence.length) {
    drops.cappedEvidence += 1;
  }
  return {
    ...capped,
    kind: "cross-cutting",
    score: crossCuttingScore({
      containers: breadth,
      evidenceCount: capped.evidenceCount,
      linked: viaTokens.has(token),
      recency: accum.recency,
    }),
    subject: token,
    summary: `${token} is referenced across ${String(breadth)} distinct containers`,
  };
}

function spotCrossCutting({
  records,
  nowMs,
  viaTokens,
  drops,
}: {
  records: readonly CorpusRecord[];
  nowMs: number;
  viaTokens: ReadonlySet<string>;
  drops: DropTally;
}): readonly Opportunity[] {
  const opportunities: Opportunity[] = [];
  for (const [token, accum] of indexCrossCutTokens({ nowMs, records })) {
    if (accum.containers.size < CROSS_CUTTING_MIN_CONTAINERS) {
      continue; // too narrow to be a cross-cutting concern at all — not a rejected candidate
    }
    if (classifyOpportunityToken({ token }) !== "concrete") {
      countTokenDrop({ drops, token });
      continue;
    }
    opportunities.push(crossCuttingOpportunity({ accum, drops, token, viaTokens }));
  }
  return opportunities;
}

interface DupAccum {
  readonly raw: string;
  readonly sources: Set<CorpusSource>;
  readonly evidence: Set<string>;
  recency: number;
}

/** Index every non-empty normalised title to the sources/records that carry it. */
function indexDuplicationTitles({
  records,
  nowMs,
}: {
  records: readonly CorpusRecord[];
  nowMs: number;
}): Map<string, DupAccum> {
  const byTitle = new Map<string, DupAccum>();
  for (const record of records) {
    const title = record.title;
    if (title === undefined || title.length === 0) {
      continue;
    }
    const key = normaliseTitle({ title });
    if (key.length === 0) {
      continue;
    }
    // The first record carrying a title keeps its raw spelling; every later one only adds sources and evidence.
    if (!byTitle.has(key)) {
      byTitle.set(key, { evidence: new Set<string>(), raw: title, recency: 0, sources: new Set<CorpusSource>() });
    }
    const accum = byTitle.get(key)!;
    accum.sources.add(record.source);
    accum.evidence.add(evidenceOf({ record }));
    accum.recency = Math.max(accum.recency, recencyWeight({ nowMs, tsIso: record.tsIso }));
  }
  return byTitle;
}

function spotDuplication({
  records,
  nowMs,
  drops,
}: {
  records: readonly CorpusRecord[];
  nowMs: number;
  drops: DropTally;
}): readonly Opportunity[] {
  const opportunities: Opportunity[] = [];
  for (const [key, accum] of indexDuplicationTitles({ nowMs, records })) {
    if (accum.sources.size < 2) {
      continue; // one source only — not parallel work
    }
    if (key.length < MIN_DUPLICATION_TITLE_CHARS) {
      drops.shortTitle += 1;
      continue;
    }
    const capped = capEvidence({ evidence: [...accum.evidence] });
    if (capped.evidenceCount > capped.evidence.length) {
      drops.cappedEvidence += 1;
    }
    opportunities.push({
      ...capped,
      kind: "duplication",
      score: round4({ value: accum.sources.size * (0.5 + 0.5 * accum.recency) }),
      subject: accum.raw,
      summary: `"${accum.raw}" appears across ${String(accum.sources.size)} distinct sources`,
    });
  }
  return opportunities;
}

/**
 * Opportunity ordering: score desc, then subject asc, then kind asc. Pure.
 *
 * @param opportunities the opportunities in whatever order they were built
 * @returns them sorted. The subject and kind tiebreaks remove the usual sources of run-to-run wobble, so a
 *   re-derive over the same input is byte-identical — `toSorted` is stable, so anything still tied keeps its
 *   input order, which means determinism here inherits the caller's ordering rather than imposing one
 */
export function sortOpportunities({
  opportunities,
}: {
  opportunities: readonly Opportunity[];
}): readonly Opportunity[] {
  return opportunities.toSorted(
    (a, b) =>
      b.score - a.score || compareStrings({ a: a.subject, b: b.subject }) || compareStrings({ a: a.kind, b: b.kind }),
  );
}

/**
 * Detect cross-cutting concerns, blockers, and duplication across the corpus — precision-first (PR4.8), and
 * reporting every rejected candidate so nothing is silently dropped.
 *
 * @param records the corpus records
 * @param edges the cross-ref graph edges (a `via` token confirms a real link → boosts cross-cutting)
 * @returns the opportunities (score desc, then subject asc, then kind asc) plus the drop tally
 */
export function scanOpportunities({
  records,
  edges,
}: {
  records: readonly CorpusRecord[];
  edges: readonly GraphEdge[];
}): OpportunityScan {
  const nowMs = corpusNowMs({ records });
  const viaTokens = new Set(edges.map((edge) => edge.via));
  const drops = noDrops();
  const all = [
    ...spotCrossCutting({ drops, nowMs, records, viaTokens }),
    ...spotBlockers({ drops, nowMs, records }),
    ...spotDuplication({ drops, nowMs, records }),
  ];
  return { drops, opportunities: sortOpportunities({ opportunities: all }) };
}
