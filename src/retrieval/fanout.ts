/**
 * The fan-out reader: a question and a pile of candidate records in, a plan for parallel readers out, and
 * a validator that refuses anything a reader did not actually read.
 *
 * ## What this replaces, and why
 *
 * The owner's ruling settled the fork this whole row was blocked on as NEITHER option: there is no vector
 * store or any semantic search at all; the store does full-text search or queries what a person wrote across
 * platforms. The reading half is fanning out haikus to read different things and find what is relevant, with
 * no lexical or vector thinking.
 * So there is no ranking in this module at all. Postgres selects the candidates; cheap readers decide what
 * is relevant; nothing here scores a record.
 *
 * ## No model runs in this process, and that is a rule rather than a choice
 *
 * AGENTS.md rule 2 forbids a Slopweaver process from launching a model the owner cannot see and interrupt.
 * So this module does exactly what rule 2 says the CLI is for — it **gathers evidence, briefs, and
 * validates**. The visible session dispatches the readers itself, one in-process `Agent` per shard at
 * `model: "haiku"` (`skills/supervisor/reference/model-tiering.md` already names that shape), and hands
 * what they returned back to {@link collectFindings}.
 *
 * ## The one property that makes this trustworthy: a finding carries a VERBATIM quote
 *
 * The failure a fan-out invites is a reader that answers from its prior instead of from the shard it was
 * given — plausible, well-formed, and citing a record id it never opened. Two checks make that
 * unrepresentable rather than unlikely, and both are here rather than in a reviewer's head:
 *
 * 1. **A finding's id must be in the shard that reader was assigned.** Not merely in the candidate set —
 *    in ITS OWN shard. An id borrowed from another shard is a reader reporting on something it was not
 *    shown, which is the same defect wearing a friendlier hat.
 * 2. **A finding's quote must appear VERBATIM in that record's own text.** A reader cannot produce a
 *    substring of a body it did not read, so the quote is the evidence that the read happened. It is
 *    compared on collapsed whitespace only — a reader that re-wraps a line has still read it — and on
 *    nothing else, because every further normalisation is a way for a paraphrase to pass.
 *
 * Both refusals are COUNTED and reported with the id, never dropped quietly: a fan-out where half the
 * readers hallucinated and the report said nothing would be worse than no fan-out.
 */
import { z } from "zod";
import { absentAs, unsetFieldAsNull } from "#lib/absent.js";
import type { CorpusRecord } from "../corpus/types.js";
import { citeToken } from "./citeToken.js";

/**
 * How many characters of record text one reader is given.
 *
 * A character budget rather than a record count, because record sizes span four orders of magnitude here —
 * a Slack line and a pull-request body are both one record — so a fixed record count produces shards whose
 * cost differs by a hundredfold. This number is the shard's SIZE; {@link MAX_SHARD_RECORDS} bounds its
 * cardinality so a shard of tiny records still stays readable.
 *
 * @internal
 */
export const DEFAULT_SHARD_CHARS = 24_000;

/**
 * The most records one reader is given, however small they are.
 *
 * @internal
 */
export const MAX_SHARD_RECORDS = 40;

/** How much of one record's text a shard carries before it is clipped, and the clip is marked. */
export const MAX_RECORD_CHARS = 4_000;

/** The marker a clipped record's text ends with, so a reader can see that it is reading a prefix. */
export const CLIP_MARKER = "\n…[clipped]";

/** One record as a reader sees it — everything it needs to judge relevance, and its citation token. */
export interface ShardRecord {
  readonly id: string;
  readonly source: string;
  readonly container: string;
  readonly author: string | null;
  readonly tsIso: string;
  readonly url: string;
  readonly title: string | null;
  readonly text: string;
  /** Whether {@link text} is a prefix of the record's own body rather than all of it. */
  readonly clipped: boolean;
}

/** One reader's assignment: which shard, and the records only it was shown. */
export interface Shard {
  readonly id: string;
  /**
   * The random token a reply names this shard by, instead of its readable id.
   *
   * ## What it prevents, and what it emphatically does NOT
   *
   * It prevents an ACCIDENT: a reply that names `s1` because a session pasted the wrong instruction, or a
   * reader that guesses a shard name from the obvious sequence, is refused rather than validated against a
   * slice it was never given. A Codex review pass produced that case — two readers swapping the public ids
   * `s1` and `s2`, each validating against the other's shard, both kept, exit zero.
   *
   * **It is NOT a secret and it does not authenticate a reader.** A later pass produced the reason: every
   * token is written into `plan.json`, which sits beside the shard files, so any reader that can read its
   * own shard can walk to the plan and read them all. Sealing the plan would not help either — a reader
   * with filesystem access can simply read the other shard directly, at which point the partition means
   * nothing at all.
   *
   * That is the honest boundary of this whole mechanism and it is stated rather than papered over: the
   * shard partition is a COST and ATTENTION device, not a security one. What actually protects an answer
   * is the pair of checks that do not depend on reader identity — a finding's id must be in the shard the
   * reply names, and its quote must be verbatim in that record. Those hold whichever reader produced the
   * reply, which is why they are the property worth asserting.
   *
   * Optional because a plan built in memory need not mint one, and {@link collectFindings} falls back to
   * the id there.
   */
  readonly token?: string;
  readonly records: readonly ShardRecord[];
  /**
   * The SHA-256 of the shard FILE as it was written, when the plan was persisted.
   *
   * The plan carries every record inline, so checking is possible without the files at all — this exists
   * for the other direction: a reader reads the FILE, and if that file has moved since the plan was
   * written, the reader and the checker are looking at two different things. Optional because a plan built
   * in memory and never written has no file to digest, and asserting one would be asserting a fact about
   * something that does not exist.
   */
  readonly digest?: string;
}

/** The whole plan a fan-out hands the visible session. */
export interface FanoutPlan {
  readonly question: string;
  readonly shards: readonly Shard[];
  /** How many candidate records the store selected, which is the sum of the shards' sizes. */
  readonly candidates: number;
}

/**
 * What one reader returns per relevant record.
 *
 * `quote` is REQUIRED, and that is the whole design. See this module's header: a reader cannot quote a
 * body it did not read, so the field is the proof of reading rather than a nicety for the report.
 *
 * @internal
 */
export const findingSchema = z.object({
  id: z.string().min(1),
  quote: z.string().min(12),
  why: z.string().min(1),
});

/**
 * What one reader returns: which shard it was given, and the records it judged relevant.
 *
 * `shard` is the TOKEN from that reader's own instruction, not the readable `s1`. It is the one field a
 * reader cannot supply for a shard it was not dispatched to — see {@link Shard.token}.
 */
export const readerReplySchema = z.object({
  shard: z.string().min(1),
  findings: z.array(findingSchema),
});

/** One relevant record a reader reported. */
export type Finding = z.infer<typeof findingSchema>;

/** One reader's whole reply. */
export type ReaderReply = z.infer<typeof readerReplySchema>;

/**
 * A whole SHARD that could not be trusted, and why — a fact about the slice, not about its findings.
 *
 * @internal
 */
export interface ShardFailure {
  readonly shard: string;
  readonly reason: "unknown-shard" | "shard-file-changed" | "shard-file-unreadable";
}

/**
 * A finding that did not survive validation, and exactly which check it failed.
 *
 * @internal
 */
export interface RejectedFinding {
  readonly shard: string;
  readonly id: string;
  readonly reason: "not-in-shard" | "quote-not-in-record";
}

/**
 * A finding that survived, paired with the record it is about.
 *
 * @internal
 */
export interface KeptFinding {
  readonly finding: Finding;
  readonly record: ShardRecord;
  readonly shard: string;
}

/** What a whole fan-out came back with, once every reply was checked against its own shard. */
export interface FanoutHarvest {
  readonly kept: readonly KeptFinding[];
  readonly rejected: readonly RejectedFinding[];
  /**
   * Shards whose reply could not be trusted at all, whatever it contained.
   *
   * Its own channel because a review pass found the alternative silent: an integrity failure used to be
   * recorded once per FINDING, so a tampered shard answered with an empty `findings` array produced no
   * refusal, was already marked answered, and let a sibling shard's valid finding carry the whole run to
   * exit zero. A failure of the slice is not a property of what the reader said about it.
   */
  readonly shardFailures: readonly ShardFailure[];
  /** Shards the session reported nothing for at all — a reader that never ran is not a reader that found nothing. */
  readonly missingShards: readonly string[];
}

/**
 * One record's text as a reader sees it, clipped to the per-record budget and marked when it was. Pure.
 *
 * @param record the candidate record
 * @returns the text a shard carries, and whether it is a prefix
 */
function clip({ record }: { record: CorpusRecord }): { text: string; clipped: boolean } {
  if (record.text.length <= MAX_RECORD_CHARS) {
    return { clipped: false, text: record.text };
  }
  return { clipped: true, text: `${record.text.slice(0, MAX_RECORD_CHARS)}${CLIP_MARKER}` };
}

/**
 * One record as a reader sees it. Pure.
 *
 * The id is the CITATION TOKEN rather than a shard-local index, so what a reader hands back is already the
 * thing an answer cites and there is no second mapping between "what the reader said" and "what the answer
 * quotes" — a mapping is where a citation silently starts pointing at the wrong record.
 *
 * @param record the candidate record
 * @returns the shard entry
 */
export function shardRecordFrom({ record }: { record: CorpusRecord }): ShardRecord {
  const clipped = clip({ record });
  return {
    // Ingest records no author when it could not resolve one to a handle.
    author: unsetFieldAsNull({ key: "author", record }),
    clipped: clipped.clipped,
    container: record.container,
    id: citeToken({ record }),
    source: record.source,
    text: clipped.text,
    // A comment or review has no title of its own; only a pull request or issue carries one.
    title: unsetFieldAsNull({ key: "title", record }),
    tsIso: record.tsIso,
    url: record.url,
  };
}

/**
 * Split candidate records into shards a reader each. Pure.
 *
 * Records are taken in the order the store gave them, which is newest first, and a shard closes when
 * either budget is reached. Interleaving them instead was considered and rejected: a reader given one
 * contiguous stretch of time can say "nothing in this window", and a reader given a scatter cannot.
 *
 * @param records the candidates the store selected, in the order it returned them
 * @param shardChars the character budget one reader is given
 * @param maxRecords the most records one reader is given
 * @returns the shards, each named by its position so a reply can be matched to its own assignment
 */
export function planShards({
  records,
  shardChars = DEFAULT_SHARD_CHARS,
  maxRecords = MAX_SHARD_RECORDS,
}: {
  records: readonly CorpusRecord[];
  shardChars?: number;
  maxRecords?: number;
}): readonly Shard[] {
  return packShards({ entries: records.map((record) => shardRecordFrom({ record })), maxRecords, shardChars });
}

/**
 * Pack shard entries into shards, the budget rule with no record adaptation in front of it. Pure.
 *
 * Separated from {@link planShards} so a caller whose records are STORE rows rather than corpus records
 * reuses this exact packing instead of writing a second one. The bake-off harness is that caller: its ids
 * are the store's own `(source, native id)` pairs, so running its candidates through
 * {@link shardRecordFrom} would re-key every record to a corpus citation token and introduce the second
 * id mapping that this whole path exists to avoid.
 *
 * @param entries the shard records, in the order they should be taken
 * @param shardChars the character budget one reader is given
 * @param maxRecords the most records one reader is given
 * @returns the shards, each named by its position so a reply can be matched to its own assignment
 */
function packShards({
  entries,
  shardChars = DEFAULT_SHARD_CHARS,
  maxRecords = MAX_SHARD_RECORDS,
}: {
  entries: readonly ShardRecord[];
  shardChars?: number;
  maxRecords?: number;
}): readonly Shard[] {
  const shards: Shard[] = [];
  let current: ShardRecord[] = [];
  let chars = 0;
  const close = (): void => {
    if (current.length > 0) {
      shards.push({ id: `s${String(shards.length + 1)}`, records: current });
      current = [];
      chars = 0;
    }
  };
  for (const entry of entries) {
    // Closed BEFORE the record is added rather than after, so a shard never exceeds its budget; a single
    // record larger than the whole budget still lands alone rather than being dropped.
    if (current.length > 0 && (chars + entry.text.length > shardChars || current.length >= maxRecords)) {
      close();
    }
    current.push(entry);
    chars += entry.text.length;
  }
  close();
  return shards;
}

/**
 * Collapse every run of whitespace to one space, so a re-wrapped quote still matches. Pure.
 *
 * The ONLY normalisation applied to a quote check, deliberately. Lowercasing, punctuation stripping and
 * unicode folding each make a paraphrase more likely to pass, and the check exists precisely to catch a
 * paraphrase.
 *
 * @param text whatever is being compared
 * @returns the text with its whitespace runs collapsed and its ends trimmed
 */
function collapse({ text }: { text: string }): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/**
 * Whether a reader's quote appears verbatim in the record it named. Pure.
 *
 * Each field is tested SEPARATELY — the title, then the text — because a reader quoting a pull request's
 * title is quoting something it was shown, and both are on the shard.
 *
 * **Concatenating them first is the loophole, and a Codex review pass found it here.** With a title of
 * `alpha bravo charlie` and a text of `delta echo foxtrot`, the joined string contains `charlie delta` —
 * a phrase that appears in NEITHER field and that no reader could have read. It passed, was kept, printed
 * no refusal, and exited zero. A synthesised span crossing a field boundary is exactly the non-verbatim
 * claim this check exists to refuse, so the fields are never joined.
 *
 * @param finding what the reader returned
 * @param record the record it named, as the shard carried it
 * @returns whether the quote is really in one of its fields
 */
export function quoteIsInRecord({ finding, record }: { finding: Finding; record: ShardRecord }): boolean {
  const wanted = collapse({ text: finding.quote });
  if (wanted.length === 0) {
    return false;
  }
  const title = record.title;
  if (title !== null && collapse({ text: title }).includes(wanted)) {
    return true;
  }
  return collapse({ text: record.text }).includes(wanted);
}

/**
 * Check every reply against the shard its reader was actually given, keeping only what it can prove it read.
 *
 * @param plan the plan the readers were dispatched from
 * @param replies what the readers returned, one per shard
 * @returns the surviving findings, every rejection with its reason, and any shard nobody answered for
 */
export function collectFindings({
  plan,
  replies,
  digests,
}: {
  plan: FanoutPlan;
  replies: readonly ReaderReply[];
  /**
   * The shard files' digests as they are NOW, keyed by shard id, when the caller read them back.
   *
   * A `null` value means the caller TRIED and could not hash that file. It is deliberately different
   * from the shard being absent from the map, which means the caller did not look at all — see
   * {@link shardIntegrity} for why collapsing the two is a fail-open.
   */
  digests?: ReadonlyMap<string, string | null>;
}): FanoutHarvest {
  // Keyed by TOKEN where the plan minted one, which refuses a MISLABELLED reply rather than an adversarial
  // one — see `Shard.token` for why possession authenticates nothing. A plan with no tokens falls back to
  // the id, which is the in-memory case.
  const byShard = new Map(plan.shards.map((shard) => [absentAs({ value: shard.token, whenAbsent: shard.id }), shard]));
  const kept: KeptFinding[] = [];
  const rejected: RejectedFinding[] = [];
  const shardFailures: ShardFailure[] = [];
  const answered = new Set<string>();
  for (const reply of replies) {
    const shard = byShard.get(reply.shard);
    if (shard === undefined) {
      shardFailures.push({ reason: "unknown-shard", shard: reply.shard });
      continue;
    }
    // A shard whose FILE has moved since the plan was written is refused whole: the reader read that file
    // and the checks below read the plan, so a divergence means the two are about different records, and
    // every finding from it is unverifiable rather than merely suspect. So is one that cannot be read now.
    //
    // Recorded BEFORE the shard is marked answered, and as a shard failure rather than per finding. Both
    // halves are the fix for a review pass's counterexample: an empty reply from a tampered shard used to
    // produce no rejection at all AND to count as answered, so nothing anywhere said the slice was bad.
    const integrity = shardIntegrity({ digests, shard });
    if (integrity !== null) {
      shardFailures.push({ reason: integrity, shard: shard.id });
      continue;
    }
    answered.add(shard.id);
    checkShard({ kept, rejected, reply, shard });
  }
  return {
    kept,
    missingShards: plan.shards.map((shard) => shard.id).filter((id) => !answered.has(id)),
    rejected,
    shardFailures,
  };
}

/**
 * What is wrong with this shard's FILE, if anything, or `null` when nothing is.
 *
 * ## Three states, and collapsing two of them is a fail-open
 *
 * A Codex review pass broke the property here. The earlier version answered a boolean and read a missing
 * current digest as "unchanged", so a shard the caller could not hash — `chmod 000` in its counterexample,
 * a deleted or replaced file in practice — passed every check and exited zero, with the plan's own inline
 * copy of the records standing in for a file nobody could read. That is exactly backwards: **not knowing
 * whether the file moved is a reason to refuse, not a reason to accept.**
 *
 * So the three states stay apart. The plan recording no digest at all means there is nothing to check —
 * an in-memory fan-out never wrote a file, and refusing one would refuse every test. The caller not
 * looking means the same. A recorded digest with a `null` reading means the caller LOOKED and failed, and
 * that refuses.
 *
 * @param shard the planned shard
 * @param digests the digests the caller read back, `null` for one it could not hash
 * @returns the shard-failure reason, or `null` when the file is as the plan left it
 */
function shardIntegrity({
  shard,
  digests,
}: {
  shard: Shard;
  digests: ReadonlyMap<string, string | null> | undefined;
}): ShardFailure["reason"] | null {
  const planned = shard.digest;
  if (planned === undefined || digests === undefined || !digests.has(shard.id)) {
    return null;
  }
  const now = digests.get(shard.id);
  if (now === null || now === undefined) {
    return "shard-file-unreadable";
  }
  return now === planned ? null : "shard-file-changed";
}

/**
 * Check one reply's findings against the shard that reader was given.
 *
 * @param reply the reader's reply
 * @param shard the shard it was assigned
 * @param kept the run's surviving findings, extended in place
 * @param rejected the run's rejections, extended in place
 */
function checkShard({
  reply,
  shard,
  kept,
  rejected,
}: {
  reply: ReaderReply;
  shard: Shard;
  kept: KeptFinding[];
  rejected: RejectedFinding[];
}): void {
  const records = new Map(shard.records.map((record) => [record.id, record]));
  for (const finding of reply.findings) {
    const record = records.get(finding.id);
    if (record === undefined) {
      rejected.push({ id: finding.id, reason: "not-in-shard", shard: shard.id });
      continue;
    }
    if (!quoteIsInRecord({ finding, record })) {
      rejected.push({ id: finding.id, reason: "quote-not-in-record", shard: shard.id });
      continue;
    }
    kept.push({ finding, record, shard: shard.id });
  }
}

/**
 * The instruction every reader is given, verbatim, with the question folded in. Pure.
 *
 * Written here rather than in the skill so that the contract the validator enforces and the contract the
 * reader is told are the same string — a skill and a checker that drift are how a fan-out starts silently
 * discarding every reply.
 *
 * @param question the question the fan-out is answering
 * @param shard the shard this reader is assigned
 * @param path where that shard's records are on disk
 * @returns the prompt to hand one reader
 */
export function readerInstruction({ question, shard, path }: { question: string; shard: Shard; path: string }): string {
  return [
    `Read every record in ${path} (${String(shard.records.length)} records, shard ${shard.id}) and report ONLY the ones`,
    `that carry evidence bearing on this question:`,
    ``,
    `  ${question}`,
    ``,
    `Return JSON and nothing else, exactly this shape:`,
    ``,
    `  {"shard": "${absentAs({ value: shard.token, whenAbsent: shard.id })}", "findings": [{"id": "<the record's id, copied>", "quote": "<verbatim span from that record>", "why": "<one sentence>"}]}`,
    ``,
    `Rules, each of which is CHECKED and will drop your finding if broken:`,
    `- Copy "shard" exactly as it appears above. It identifies which slice you were given.`,
    `- "id" must be one of the ids in this shard's file. An id from anywhere else is discarded.`,
    `- "quote" must appear VERBATIM in that record's own title or text. Copy it; do not paraphrase,`,
    `  summarise or reconstruct it. Whitespace may differ, nothing else may.`,
    `- Report nothing you cannot quote. An empty "findings" array is a correct and useful answer when the`,
    `  shard genuinely carries nothing about the question — never invent a match to avoid returning none.`,
    `- Do not answer the question. Your job is to say which records bear on it.`,
  ].join("\n");
}
