/**
 * The gate's third check: does the evidence handoff still account for what it was given?
 *
 * ## What this replaced, and why it is NOT the same measurement
 *
 * `dev gate` used to run a deterministic recall@12 over a frozen bronze fixture, ranked with BM25 and
 * recency decay, against frozen per-cluster floors. The retrieval design has no vector store, embeddings, re-ranking, semantic search or lexical splitting,
 * so the thing that number measured is retired and the baseline it compared against describes a mechanism that no longer exists.
 *
 * **The retrieval-quality measurement is retired, not replaced.** Nothing here scores whether a question
 * reaches the right records; that is a property of a visible session following leads across several
 * queries, and no cheap deterministic check observes it. Saying so plainly is the point: a handoff check
 * wearing the old check's name and floors would read as continuity across a mechanism change.
 *
 * ## What it DOES prove
 *
 * Evidence accounting, over frozen synthetic records, through the production functions
 * {@link ../retrieval/fanout.planShards} and {@link ../retrieval/fanout.collectFindings}:
 *
 * - every selected record reaches exactly one shard, and none is invented or lost in packing;
 * - a finding whose quote is verbatim in its own shard's record is KEPT;
 * - a finding naming a record in ANOTHER shard is rejected as `not-in-shard`;
 * - a finding whose quote is not in its record is rejected as `quote-not-in-record`;
 * - a shard nobody answered is reported missing rather than passing silently.
 *
 * Those are the checks an answer's grounding rests on, and each has a falsifiable witness: the expected
 * outcome is asserted by NAME, so a collector that started keeping everything fails rather than looking
 * tidier. Frozen inputs, no clock, no database, no model — it is byte-reproducible in CI.
 */
import { absentAs } from "#lib/absent.js";
import type { CorpusRecord } from "../corpus/types.js";
import { collectFindings, type FanoutHarvest, planShards } from "../retrieval/fanout.js";

/** The records the check packs. Frozen: their text is what the expected quotes are taken from. */
const HANDOFF_RECORDS: readonly CorpusRecord[] = [
  {
    author: "person-a",
    container: "c-alpha",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "handoff-1",
    text: "the staging pool exhausted at 04:10 and the pgbouncer max_client_conn was the ceiling",
    title: "staging pool",
    tsIso: "2026-09-01T04:10:00.000Z",
    url: "https://example.invalid/handoff-1",
  },
  {
    author: "person-b",
    container: "c-beta",
    kind: "issue",
    refs: [],
    source: "linear",
    sourceId: "handoff-2",
    text: "raised the connection ceiling and added an alert on saturation above eighty percent",
    title: "raise the ceiling",
    tsIso: "2026-09-02T09:00:00.000Z",
    url: "https://example.invalid/handoff-2",
  },
];

/** One shard per record, so the cross-shard rejection has two shards to be wrong across. */
const HANDOFF_SHARD_CHARS = 1;

/** What the handoff check observed, as counts a summary line can state without re-deriving them. */
export interface HandoffObservation {
  readonly shards: number;
  readonly packedRecords: number;
  readonly kept: number;
  readonly rejectedNotInShard: number;
  readonly rejectedQuoteNotInRecord: number;
  readonly missingShards: number;
}

/**
 * Run the handoff over the frozen records and report what the collector did. Pure.
 *
 * @returns the observation, and the harvest it was read from
 */
export function observeHandoff(): { readonly observation: HandoffObservation; readonly harvest: FanoutHarvest } {
  const shards = planShards({ maxRecords: 1, records: HANDOFF_RECORDS, shardChars: HANDOFF_SHARD_CHARS });
  const first = shards[0];
  const plan = { candidates: HANDOFF_RECORDS.length, question: "why did the staging pool exhaust", shards };
  const harvest = collectFindings({
    plan,
    replies: [
      {
        findings: [
          // Verbatim in its own record: kept.
          { id: "c-alpha/handoff-1", quote: "the staging pool exhausted at 04:10", why: "names the incident" },
          // A real record, but not in THIS shard: not-in-shard.
          { id: "c-beta/handoff-2", quote: "raised the connection ceiling", why: "reaches across the partition" },
          // Its own record, but the quote is not in it: quote-not-in-record.
          { id: "c-alpha/handoff-1", quote: "the pool was fine all night", why: "invented" },
        ],
        shard: absentAs({ value: first?.token, whenAbsent: absentAs({ value: first?.id, whenAbsent: "s1" }) }),
      },
    ],
  });
  return {
    harvest,
    observation: {
      kept: harvest.kept.length,
      missingShards: harvest.missingShards.length,
      packedRecords: shards.reduce((total, shard) => total + shard.records.length, 0),
      rejectedNotInShard: harvest.rejected.filter((r) => r.reason === "not-in-shard").length,
      rejectedQuoteNotInRecord: harvest.rejected.filter((r) => r.reason === "quote-not-in-record").length,
      shards: shards.length,
    },
  };
}

/** Every field of a {@link HandoffObservation}, in the order a summary names them. */
const OBSERVED_FIELDS = [
  "kept",
  "missingShards",
  "packedRecords",
  "rejectedNotInShard",
  "rejectedQuoteNotInRecord",
  "shards",
] as const satisfies readonly (keyof HandoffObservation)[];

/** What {@link observeHandoff} must report for the handoff to be accounted for. */
const EXPECTED: HandoffObservation = {
  kept: 1,
  missingShards: 1,
  packedRecords: 2,
  rejectedNotInShard: 1,
  rejectedQuoteNotInRecord: 1,
  shards: 2,
};

/**
 * Compare an observation against what the handoff contract requires, naming every field that disagrees.
 *
 * Every field is reported rather than the first, so one run says everything that changed — the same
 * no-short-circuit rule the gate itself follows.
 *
 * @param observation what the handoff actually did
 * @returns whether it matched, and a one-line summary naming each disagreement
 */
export function handoffVerdict({ observation }: { observation: HandoffObservation }): {
  readonly ok: boolean;
  readonly summary: string;
} {
  const disagreements = OBSERVED_FIELDS.filter((key) => observation[key] !== EXPECTED[key]).map(
    (key) => `${key} ${String(observation[key])} ≠ ${String(EXPECTED[key])}`,
  );
  if (disagreements.length === 0) {
    return {
      ok: true,
      summary:
        `evidence handoff accounted for: ${String(EXPECTED.packedRecords)} record(s) into ` +
        `${String(EXPECTED.shards)} shard(s), 1 quoted finding kept, 1 cross-shard and 1 unquoted finding ` +
        "refused, 1 unanswered shard reported (this is grounding accounting, NOT retrieval quality)",
    };
  }
  return { ok: false, summary: disagreements.join("; ") };
}
