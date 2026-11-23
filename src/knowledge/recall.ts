/**
 * Recall — parsing what a session asked for, and rendering what came back. Pure: no I/O, no clock.
 *
 * A task about a platform queries the memories table for rows that include the platform's name or similar,
 * and reads everything that comes up, early on while the work is being done. A human's memories are always
 * on for a lot of things and sometimes they have to think back; a retrieval is like thinking back.
 *
 * ## What "or similar" actually gets you, stated rather than implied
 *
 * `websearch_to_tsquery('english', …)` stems — a query for `sampling` matches `sampled` and `samples` — and
 * that is ALL it does. It has no synonyms and no embedding: a query for `tracing` will not reach a row that
 * only ever says `spans`. So {@link renderRecall} prints the query it actually ran, and a session that gets
 * a thin page is expected to ask again in the words the row would have used. Claiming stemming had solved
 * "or similar" would be the kind of check that cannot fail, which this repository treats as worse than none.
 *
 * ## Why page one is never described as everything
 *
 * A recall runs before the work, so its cost is attention rather than tokens alone, and a page that claims
 * completeness stops a session looking further. {@link RecallPage.hasMore} is computed by fetching one row
 * past the limit, and the renderer prints the exact command for the next page whenever it is set.
 */
import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";

import type { MemoryRecordingRow } from "../store/schema/memories.js";
import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { type MemoryKind } from "./memory.js";

/** How many claims a page carries when the caller names no limit. */
export const RECALL_DEFAULT_LIMIT = 10;

/** The most claims one page may carry. A proposed attention bound, not a measured optimum. */
export const RECALL_MAX_LIMIT = 50;

/** What a session asked to recall. */
export interface RecallQuery {
  /** The words the task mentioned. Matched against every text column through the generated tsvector. */
  readonly query: string;
  /** How many claims to return. */
  readonly limit: number;
  /** How many claims to skip, for the next page. */
  readonly offset: number;
  /** Keep only this domain. */
  readonly domain?: string;
  /** Keep only lessons, or only preferences. */
  readonly kind?: MemoryKind;
  /** Keep only what this learner recorded. */
  readonly learner?: string;
}

/** One claim as recall returns it: its CURRENT recording, plus how often it has been recorded. */
export interface RecallHit {
  /** The latest recording for this claim — the current belief, never an older one that ranked higher. */
  readonly row: MemoryRecordingRow;
  /** Postgres's own relevance score for the query that found it. */
  readonly rank: number;
  /** How many physical recordings this claim has, across all time. */
  readonly recordings: number;
  /** How many DISTINCT runs recorded it — the consolidation signal, since one run may record twice. */
  readonly runs: number;
  /** How many times a session has recalled this claim and said what came of it. */
  readonly recalls: number;
  /** How many of those recalls checked it and found it still true. What ranks a page. */
  readonly held: number;
  /** How many found it wrong. A broken claim keeps its row; its verdict is what moved. */
  readonly broke: number;
}

/** One page of recall. */
export interface RecallPage {
  /** The query that produced it, echoed so a reader can see what was actually asked. */
  readonly query: RecallQuery;
  /** The claims, most relevant first. */
  readonly hits: readonly RecallHit[];
  /** Whether a further page exists — computed from a row fetched past the limit, never guessed. */
  readonly hasMore: boolean;
}

/** The shape a caller's flags must take before any connection is opened. */
const recallQuerySchema = z.object({
  domain: z.string().trim().min(1).optional(),
  // Spelled here rather than built from `MEMORY_KINDS`: `z.enum` needs a tuple, and a tuple is the shape
  // that breaks the `named-object-params` gate (`../store/schema/memories.ts` carries the measurement).
  // `satisfies` keeps the two in agreement at compile time.
  kind: z.enum(["lesson", "preference", "trace"] as const satisfies readonly MemoryKind[]).optional(),
  learner: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(RECALL_MAX_LIMIT).default(RECALL_DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(0),
  query: z.string().trim().min(1),
});

/**
 * Validate what a caller asked for, refusing before SQL sees it.
 *
 * A blank query is a usage failure rather than a query that matched nothing — the two are different facts
 * and only one of them says anything about the register.
 *
 * @param value the parsed flags, unvalidated
 * @returns the query, or the first field that failed
 */
export function parseRecallQuery({ value }: { value: unknown }): Result<RecallQuery, KnowledgeError> {
  const decoded = recallQuerySchema.safeParse(value);
  if (!decoded.success) {
    // Zod reports at least one issue on every failed parse, so the first one is there to name.
    const first = decoded.error.issues[0]!;
    return err(KnowledgeErrors.invalidField({ field: first.path.join("."), why: first.message }));
  }
  // Rebuilt key by key rather than spread: under `exactOptionalPropertyTypes` an absent facet must be a
  // MISSING property, not one present and holding `undefined`, or the query layer's "no filter" and
  // "filter on nothing" become the same value.
  const { query, limit, offset, domain, kind, learner } = decoded.data;
  return ok({
    limit,
    offset,
    query,
    ...(domain === undefined ? {} : { domain }),
    ...(kind === undefined ? {} : { kind }),
    ...(learner === undefined ? {} : { learner }),
  });
}

/** The command that fetches the next page, printed verbatim so a reader can paste it. */
function nextPageCommand({ query }: { query: RecallQuery }): string {
  const parts = [`slopweaver knowledge recall ${JSON.stringify(query.query)}`];
  if (query.domain !== undefined) {
    parts.push(`--domain ${query.domain}`);
  }
  if (query.kind !== undefined) {
    parts.push(`--kind ${query.kind}`);
  }
  if (query.learner !== undefined) {
    parts.push(`--learner ${query.learner}`);
  }
  parts.push(`--limit ${String(query.limit)}`, `--offset ${String(query.offset + query.limit)}`);
  return parts.join(" ");
}

/**
 * A trace's own lines: where it looked, what came back, and what that does not prove.
 *
 * The last line is printed for an EMPTY trace every time rather than left to the caveat, because it is the
 * rule a reader acts on: a remembered dead end never skips a leg. It reorders what the
 * next investigation opens first; it never removes a probe from it.
 *
 * @param hit a hit whose row is a trace
 * @returns the lines, in order
 */
function traceLines({ hit, repeats }: { hit: RecallHit; repeats: string }): readonly string[] {
  const { row } = hit;
  const lines = [
    `${row.id}  [trace · ${row.outcome!} · ${row.verdict}] ${row.domain}${repeats}${accountingSuffix({ hit })}`,
    `  question: ${row.question!}`,
    `  probe: ${row.repro!}`,
    `  traced by: ${row.learner!} · ${row.recordedAt.toISOString()} · run ${row.run}`,
    `  evidence: ${row.evidence}`,
  ];
  if (row.caveat !== null) {
    lines.push(`  does not prove: ${row.caveat}`);
  }
  if (row.outcome === "empty") {
    lines.push("  still run this leg — a remembered dead end reorders the work, it never skips a probe");
  }
  return lines;
}

/**
 * The accounting suffix on a hit's first line, or nothing when nobody has ever recalled this claim.
 *
 * Printed because it is what the ORDER is made of: a reader who sees a claim first is entitled to know it
 * is there on the strength of having held, rather than on the text score alone.
 *
 * @param hit the hit to describe
 * @returns the suffix, or an empty string
 */
function accountingSuffix({ hit }: { hit: RecallHit }): string {
  if (hit.recalls === 0) {
    return "";
  }
  return ` · recalled ${String(hit.recalls)}× · held ${String(hit.held)} · broke ${String(hit.broke)}`;
}

/**
 * Who learned a lesson, as its recall line names them. The column is NULL only on a row imported from the old
 * `lessons.jsonl`, which predates learner recording (`../store/schema/memories.ts`), so that is what it says.
 */
function learnedBy({ learner }: { learner: string | null }): string {
  if (learner == null) {
    return "unknown (imported)";
  }
  return learner;
}

/** One hit's lines. Evidence is never clipped — a truncated measurement is a measurement nobody can use. */
function hitLines({ hit }: { hit: RecallHit }): readonly string[] {
  const { row } = hit;
  if (row.kind === "trace") {
    const traceRepeats =
      hit.recordings === 1 ? "" : ` · traced ${String(hit.recordings)}× across ${String(hit.runs)} run(s)`;
    return traceLines({ hit, repeats: traceRepeats });
  }
  // A lesson's tier and surface are NOT NULL in the database, enforced by `memories_lesson_facets` — so a
  // lesson reaching here without them is a broken invariant, and the assertions say so loudly rather than
  // rendering `tier 0 ·` and letting a reader believe it.
  const facets = row.kind === "lesson" ? ` tier ${String(row.tier!)} · ${row.surface!}` : "";
  const repeats =
    hit.recordings === 1 ? "" : ` · recorded ${String(hit.recordings)}× across ${String(hit.runs)} run(s)`;
  const lines = [
    `${row.id}  [${row.kind} · ${row.verdict}${facets}] ${row.domain}${repeats}${accountingSuffix({ hit })}`,
    `  ${row.claim}`,
    `  learned by: ${learnedBy({ learner: row.learner })} · ${row.recordedAt.toISOString()} · run ${row.run}`,
  ];
  if (row.behaviourChange !== null) {
    lines.push(`  do differently: ${row.behaviourChange}`);
  }
  lines.push(`  evidence: ${row.evidence}`);
  if (row.repro !== null) {
    lines.push(`  repro: ${row.repro}`);
  }
  if (row.caveat !== null) {
    lines.push(`  caveat: ${row.caveat}`);
  }
  if (row.supersedes !== null) {
    lines.push(`  retires: ${row.supersedes}`);
  }
  return lines;
}

/**
 * Render a page for a session to read.
 *
 * Prints the query it ran, then every hit in full, then either the next-page command or the reminder that
 * stemming is not synonymy. It never says "no relevant memories" — it says this query matched nothing,
 * which is the only thing the search actually established.
 *
 * @param page what came back
 * @returns the lines to print, in order
 */
export function renderRecall({ page }: { page: RecallPage }): readonly string[] {
  const head = `recall ${JSON.stringify(page.query.query)} — ${String(page.hits.length)} claim(s)`;
  if (page.hits.length === 0) {
    return [
      `${head}. Nothing in the memories table matches those words.`,
      "Full-text search stems (sampling/sampled) and has no synonyms — ask again in the words the row itself",
      "would have used before concluding nothing was learned here.",
    ];
  }
  const body = page.hits.flatMap((hit) => hitLines({ hit }));
  const tail = page.hasMore
    ? [`more claims match. Next page: ${nextPageCommand({ query: page.query })}`]
    : ["that is every claim matching those words — not every memory that could be relevant."];
  return [head, "", ...body, "", ...tail];
}
