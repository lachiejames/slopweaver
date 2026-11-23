/**
 * The PURE aggregators behind `slopweaver audit` — a read-only quality snapshot over the on-disk corpus.
 * Nothing here does IO, network, or a model call: each function takes already-read data and returns exact,
 * deterministic counts. The effectful shell ({@link ../cli/commands/audit/run}) does the reads and hands
 * these the parsed inputs.
 */

import type { SourceStorage } from "../corpus/bronzeStorage.js";
import type { CorpusSource } from "../corpus/types.js";
import type { BatchDigest } from "../gold/distil.js";
import { isRecord } from "../lib/parsers.js";
import type { Result } from "../lib/result.js";
import { CRISP_EVIDENCE, type Opportunity } from "../silver/opportunity.js";
import type { AuditTallies } from "./auditFold.js";

/** Per-source volume: how many records, over what date span, split by kind. */
export interface SourceStat {
  readonly source: CorpusSource;
  readonly count: number;
  /** Min/max observed `tsIso` (empty strings when the source has no timestamped record). */
  readonly spanStart: string;
  readonly spanEnd: string;
  readonly kinds: Readonly<Record<string, number>>;
}

/** Grounding: how many distilled digest points actually cite a record present in the corpus. */
export interface GroundingStat {
  readonly digests: number;
  readonly points: number;
  readonly grounded: number;
  /** grounded / points, in [0,1]; 0 when there are no points. */
  readonly ratio: number;
}

/** Opportunity signal: crisp (few-evidence, actionable) vs mega-clique (sprawling, low-signal). */
export interface SignalRatioStat {
  readonly total: number;
  readonly crisp: number;
  readonly mega: number;
  /** crisp / total, in [0,1]; 0 when there are no opportunities. */
  readonly crispRatio: number;
  /** How many opportunities the `topN` window covers (the ranked head the user actually reads). */
  readonly topN: number;
  /** How many of that head are crisp — the "are the TOP-scored ones real insights?" measure (PR4.8). */
  readonly topCrisp: number;
}

/**
 * Identity resolution: canonical people, how many link across sources, and the account-kind split. `bots` +
 * `integrations` are counted from the persisted `kind` (PR4.8) when present, else from the structural `[bot]`
 * login suffix — so an artifact derived before PR4.8 still reports honestly, just more thinly.
 * `directoryPeople` is the people-directory count: what the world model calls a TEAM MEMBER.
 * `directoryExcluded` is how many non-human accounts were filtered out of it — ABSENT (not zero) on a
 * pre-PR4.8 artifact, whose directory was never filtered at all, so a stale count is never presented as a
 * filtered one.
 */
export interface IdentityStat {
  readonly resolved: number;
  readonly linked: number;
  readonly bots: number;
  readonly integrations: number;
  readonly directoryPeople: number;
  readonly directoryExcluded?: number;
}

/** A canonical person, tolerant subset of the persisted `silver/index/identities.json` shape. */
export interface AuditPerson {
  readonly confidence: string;
  readonly identities: readonly { readonly nativeId: string; readonly handle?: string }[];
  /** The PR4.8 account kind, when the artifact carries one (absent on a pre-PR4.8 artifact). */
  readonly kind?: string;
}

/** Opportunities with at most this many evidence items are CRISP; more is a mega-clique. */
export const CRISP_MAX_EVIDENCE = CRISP_EVIDENCE;

/** How many top-ranked opportunities the signal stat inspects — the head a human actually reads. */
const SIGNAL_TOP_N = 20;

/**
 * Grounding over the distilled digests: a point is grounded when at least one of its citations resolves to
 * a real record in {@link recordRefIndex}. Measures whether the digests cite the corpus (a hallucinated
 * citation is ungrounded), not merely whether a citation string exists. Pure.
 *
 * @param digests the persisted batch digests
 * @param refs the resolvable citation set from the corpus
 * @returns the grounding stat
 */
export function groundingStats({
  digests,
  refs,
}: {
  digests: readonly BatchDigest[];
  refs: ReadonlySet<string>;
}): GroundingStat {
  let points = 0;
  let grounded = 0;
  for (const digest of digests) {
    for (const point of digest.points) {
      points += 1;
      if (point.citations.some((citation) => refs.has(citation))) {
        grounded += 1;
      }
    }
  }
  return { digests: digests.length, grounded, points, ratio: points === 0 ? 0 : grounded / points };
}

/**
 * The evidence breadth an opportunity really has: the PR4.8 `evidenceCount` (the true total, before the
 * emitted-citation cap) when present, else the emitted list length. Reading the true count is what keeps the
 * crisp/mega ratio honest — capping the citation list must never be able to inflate the score. Pure.
 *
 * @returns its true evidence count
 */
function opportunityEvidenceCount({ opportunity }: { opportunity: Opportunity }): number {
  return opportunity.evidenceCount > 0 ? opportunity.evidenceCount : opportunity.evidence.length;
}

/**
 * Bucket opportunities into crisp (≤ {@link CRISP_MAX_EVIDENCE} evidence) vs mega-clique, and separately
 * measure the ranked HEAD (the first {@link SIGNAL_TOP_N}) — a scorer that ranks frequency artifacts first
 * can have a fine overall ratio while everything a human reads is noise. Pure.
 *
 * @param opportunities the derived opportunities, in ranked order
 * @returns the signal stat
 */
export function signalRatio({ opportunities }: { opportunities: readonly Opportunity[] }): SignalRatioStat {
  const isCrisp = (opportunity: Opportunity): boolean =>
    opportunityEvidenceCount({ opportunity }) <= CRISP_MAX_EVIDENCE;
  const crisp = opportunities.filter(isCrisp).length;
  const total = opportunities.length;
  const head = opportunities.slice(0, SIGNAL_TOP_N);
  return {
    crisp,
    crispRatio: total === 0 ? 0 : crisp / total,
    mega: total - crisp,
    topCrisp: head.filter(isCrisp).length,
    topN: head.length,
    total,
  };
}

/** True when a native id or handle carries the exact `[bot]` login suffix (a structural marker, never fuzzy). */
function readsAsBot({ person }: { person: AuditPerson }): boolean {
  return person.identities.some(
    (identity) => identity.nativeId.endsWith("[bot]") || identity.handle?.endsWith("[bot]") === true,
  );
}

/** How many people carry an exact persisted `kind` (PR4.8) — 0 means a pre-PR4.8 artifact. */
function countKind({ people, kind }: { people: readonly AuditPerson[]; kind: string }): number {
  return people.filter((person) => person.kind === kind).length;
}

/**
 * Identity stats: resolved people, how many carry an APPLIED cross-source link (confidence not
 * `single-source`), the bot/integration split, and the people-directory count. Bots come from the persisted
 * `kind` when the artifact carries one, else from the structural `[bot]` suffix fallback. Pure.
 *
 * @param people the canonical people from the derived identity resolution
 * @param directoryPeople how many entries the people directory holds
 * @param directoryExcluded how many accounts derive filtered out of it (omit for a pre-PR4.8 artifact)
 * @returns the identity stat
 */
export function identityStats({
  people,
  directoryPeople,
  directoryExcluded,
}: {
  people: readonly AuditPerson[];
  directoryPeople: number;
  directoryExcluded?: number;
}): IdentityStat {
  const kinded = people.filter((person) => person.kind !== undefined).length;
  return {
    bots: kinded > 0 ? countKind({ kind: "bot", people }) : people.filter((person) => readsAsBot({ person })).length,
    directoryPeople,
    integrations: countKind({ kind: "integration", people }),
    linked: people.filter((person) => person.confidence !== "single-source").length,
    resolved: people.length,
    ...(directoryExcluded !== undefined ? { directoryExcluded } : {}),
  };
}

/** One source's retention picture: what it occupies on disk and how much of that is collapsible. */
interface RetentionSourceStat {
  readonly source: CorpusSource;
  readonly files: number;
  readonly bytes: number;
  readonly records: number;
  /** Records `slopweaver compact` would collapse as cross-window duplicates. */
  readonly collapsibleDuplicates: number;
}

/** The whole-corpus retention picture — the before/after measure compaction moves. */
export interface RetentionStat {
  readonly files: number;
  readonly bytes: number;
  readonly records: number;
  readonly collapsibleDuplicates: number;
  readonly sources: readonly RetentionSourceStat[];
}

/**
 * The retention snapshot: per-source file count + bytes (measured by the shell off disk) joined to the row
 * counts and collapsible-duplicate counts the audit fold already gathered — so the whole block costs no extra
 * parse. Duplicates are counted on {@link ../corpus/bronzeDedupIndex.recordDedupDigest}, the key `compact` itself
 * collapses on, so this number is a prediction of compaction rather than an independent estimate of it.
 * Sources are reported in the order the storage listing gives them. Pure.
 *
 * @param tallies what the audit fold gathered over physical bronze
 * @param storage the per-source on-disk footprint (files + bytes), measured by the effectful shell
 * @returns the retention stat
 */
export function retentionStats({
  tallies,
  storage,
}: {
  tallies: AuditTallies;
  storage: readonly SourceStorage[];
}): RetentionStat {
  const rowsBySource = new Map(tallies.sources.map((stat) => [stat.source, stat.count]));
  const sources = storage.map((entry) => ({
    bytes: entry.bytes,
    collapsibleDuplicates: countOrZero({ count: tallies.duplicatesBySource.get(entry.source) }),
    files: entry.files,
    records: countOrZero({ count: rowsBySource.get(entry.source) }),
    source: entry.source,
  }));
  const total = ({ pick }: { pick: (stat: RetentionSourceStat) => number }): number =>
    sources.reduce((sum, stat) => sum + pick(stat), 0);
  return {
    bytes: total({ pick: (stat) => stat.bytes }),
    collapsibleDuplicates: total({ pick: (stat) => stat.collapsibleDuplicates }),
    files: total({ pick: (stat) => stat.files }),
    records: total({ pick: (stat) => stat.records }),
    sources,
  };
}

/** A per-source count, zero for a source the fold never saw a row of (on disk, but every file empty). */
function countOrZero({ count = 0 }: { count?: number | undefined }): number {
  return count;
}

/** One source's superseded picture: physical rows, distinct logical entities, and the stale rows between them. */
interface SupersededSourceStat {
  readonly source: CorpusSource;
  readonly rows: number;
  readonly logical: number;
  readonly superseded: number;
}

/**
 * The whole-corpus superseded picture — how much of physical bronze is a stale version of something, grouped
 * on the shared {@link ../corpus/latestRecords.recordIdentity} key, the same identity a store read and
 * `derive` collapse on, so it predicts what those readers hide rather than guessing at it.
 *
 * This is what makes reporting on PHYSICAL bronze honest: without it every physical row reads as a live
 * record, and an entity re-fetched six times looks like six records' worth of coverage. Distinct from
 * {@link RetentionStat}'s `collapsibleDuplicates`, deliberately: those are rows identical under the dedup
 * key, which `compact` removes; a superseded row has DIFFERENT content, so compaction keeps it and a reader
 * hides it. A corpus can have zero collapsible duplicates and thousands of superseded rows.
 */
export interface SupersededStat {
  /** Physical rows on disk (identical to `totalRecords`, restated so the ratio below reads on its own). */
  readonly rows: number;
  /** Distinct logical entities, i.e. what the latest-record view would show. */
  readonly logical: number;
  /** Rows that are superseded versions — `rows - logical`. */
  readonly superseded: number;
  /** The most physical versions any single entity carries (`1` when nothing is superseded). */
  readonly deepest: number;
  readonly sources: readonly SupersededSourceStat[];
}

/**
 * Parse the persisted `silver/index/identities.json` into the tolerant {@link AuditPerson} subset. Anything
 * missing/garbled degrades to an empty list (like the rest of the silver readers). Pure.
 *
 * @param value the raw parsed JSON (the `{ people, candidates, conflicts }` object derive wrote)
 * @returns the canonical people (empty when absent/garbled)
 */
export function parseIdentityPeople({ value }: { value: unknown }): readonly AuditPerson[] {
  const people = isRecord(value) ? value["people"] : undefined;
  if (!Array.isArray(people)) {
    return [];
  }
  return people.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry["confidence"] !== "string") {
      return [];
    }
    const rawIdentities = Array.isArray(entry["identities"]) ? entry["identities"] : [];
    const identities = rawIdentities.flatMap((raw) => {
      if (!isRecord(raw) || typeof raw["nativeId"] !== "string") {
        return [];
      }
      return [{ nativeId: raw["nativeId"], ...(typeof raw["handle"] === "string" ? { handle: raw["handle"] } : {}) }];
    });
    const kind = entry["kind"];
    return [{ confidence: entry["confidence"], identities, ...(typeof kind === "string" ? { kind } : {}) }];
  });
}

/**
 * What an audit may report on, given the corpus read it was handed: that read, or the reason it must
 * refuse. Pure — the decision, separated from the read so it can be tested without a filesystem.
 *
 * ## The defect this shape exists to make impossible
 *
 * Both arms of this decision used to map a FAILED read to an empty array — once for `unreadable`, once for
 * the records — so a read that refused was indistinguishable from a corpus that held nothing, and the verb
 * printed zeros with a clean exit.
 *
 * MEASURED on one machine, one corpus, only the heap ceiling differing:
 *
 * | `--max-old-space-size` | what `slopweaver audit` reported                        |
 * | ---------------------- | -------------------------------------------------------- |
 * | 4288 (V8's default)    | `corpus: 0 record(s) across 0 source(s)`, exit 0        |
 * | 18944                  | `corpus: 2,146,226 record(s) across 6 source(s)`, exit 0 |
 *
 * The zero was the heap guard's refusal, swallowed. Inside a cmux workspace the ceiling is clamped, which
 * is where this verb actually runs — so the honesty verb reported an empty world model as fact, and every
 * figure downstream of it (digests, grounding, superseded counts) was computed from that empty set. That is
 * the silent-degradation class `docs/constraints/hard.md` § 2 bans, in the one verb whose whole subject is
 * honesty, and whose own doc comment already said a quiet partial audit is the least acceptable thing here.
 *
 * An EMPTY corpus is still fine and still reports zeros: "nothing ingested yet" is a true answer. What can
 * never again be true is a FAILURE rendering as that same answer.
 *
 * @param read the corpus read, exactly as the census (or any reader naming its unreadable paths) returned it
 * @returns the read to audit, or the operator-facing reason this audit is refused
 */
export function auditableFrom<T extends { readonly unreadable: readonly string[] }>({
  read,
}: {
  read: Result<T, { message: string }>;
}): { readonly auditable: T } | { readonly refusal: string } {
  if (read.isErr()) {
    return {
      refusal:
        `refusing to audit: the corpus could not be read, and zeros here would read as "your world model ` +
        `is empty" rather than as a failure — ${read.error.message}`,
    };
  }
  if (read.value.unreadable.length > 0) {
    return {
      refusal:
        `refusing to audit: ${String(read.value.unreadable.length)} corpus path(s) could not be read, and ` +
        `every figure below would be a claim about the whole corpus computed from part of it — ` +
        `${read.value.unreadable.join(", ")}`,
    };
  }
  return { auditable: read.value };
}
