/**
 * distil — the digest CONTRACT: the prompt, the output schema, the content-hash fingerprint they fold into,
 * and the validator a composed digest must pass before it is cached. Pure; no model transport.
 *
 * Under rule 2 (no spawned model, anywhere — `AGENTS.md`) this module no longer calls a model itself. It
 * used to call one through an injected `LlmClient` (a forced-tool `claude` call); that half moved to a
 * visible agent session, driven by `slopweaver distil brief` / `slopweaver distil answer`
 * (`src/cli/commands/distil/brief.ts` + `answer.ts`, `src/gold/distilBrief.ts`). What survives here is
 * everything the OLD and NEW paths must agree on byte-for-byte: the prompt a batch renders to, the schema a
 * digest must satisfy, and the fingerprint that couples them to the cache key — because a cached digest is
 * meaningless unless every reader of it agrees on what contract produced it.
 */

import { createHash } from "node:crypto";

import type { CorpusRecord, CorpusSource } from "../corpus/types.js";
import { compareStrings } from "../lib/compare.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { Truncation } from "../lib/truncation.js";
import { type DistilError, DistilErrors } from "./distil.errors.js";
import { BATCHING_SCHEME, type DistilBatch } from "./distilGroup.js";
import { DISTIL_RECORD_CHARS, promptBodies } from "./recordBody.js";

export { DISTIL_RECORD_CHARS } from "./recordBody.js";

export interface DigestPoint {
  readonly point: string;
  readonly citations: readonly string[];
}

export interface BatchDigest {
  readonly source: CorpusSource;
  readonly container: string;
  readonly summary: string;
  readonly points: readonly DigestPoint[];
}

export interface SourceDigest {
  readonly source: CorpusSource;
  readonly recordCount: number;
  readonly containers: readonly BatchDigest[];
}

/**
 * The digest's required shape, as a plain JSON-schema-shaped object. No longer passed to a forced-tool call
 * (there is none) — kept as documentation of the answer contract AND because it is folded into
 * {@link DISTIL_PROMPT_FINGERPRINT}, so its own type is inferred rather than imported from the (now
 * unreferenced) LLM transport types.
 */
const DIGEST_SCHEMA = {
  properties: {
    points: {
      items: {
        properties: { citations: { items: { type: "string" }, type: "array" }, point: { type: "string" } },
        type: "object",
      },
      type: "array",
    },
    summary: { type: "string" },
  },
  required: ["summary", "points"],
  type: "object",
} as const;

const SYSTEM = [
  "You distil one container of team activity into a high-signal digest.",
  "Write a one-sentence summary, then a handful of concrete points.",
  "Ground EVERY point: cite the url or id of the record(s) it comes from. A point with no citation is dropped.",
  "Prefer decisions, outcomes, blockers, and ownership over restating chatter.",
  "Records tagged [strategy]/[decision]/[status]/[ownership] are deliberately-authored artefacts — weight them above ordinary chatter.",
].join(" ");

/**
 * The distil CONTRACT fingerprint — `sha256(SYSTEM + DIGEST_SCHEMA + BATCHING_SCHEME)`, folded into every
 * batch's cache key.
 *
 * DERIVED, deliberately, rather than a hand-bumped version constant: the cache key must change whenever the
 * prompt or the output schema changes, and a constant someone has to remember to bump is exactly the kind of
 * discipline that silently fails. Because this is computed from the very text it guards, editing `SYSTEM` or
 * `DIGEST_SCHEMA` above changes it automatically — a cached digest produced under the old contract can never
 * be served under a new one. See `src/cli/commands/distil/core.ts`'s `promptChangeRefusal` for what the
 * `status`/`brief` verbs do when they notice the change.
 *
 * `BATCHING_SCHEME` joins it here for the same reason: how records are cut into batches decides which records
 * a digest was produced FROM, so a change to the boundary algorithm invalidates every cached digest exactly
 * as a prompt change does.
 */
export const DISTIL_PROMPT_FINGERPRINT: string = createHash("sha256")
  .update(SYSTEM)
  .update(JSON.stringify(DIGEST_SCHEMA))
  .update(BATCHING_SCHEME)
  .digest("hex")
  .slice(0, 12);

/** The `[classification]` tag for a record, when it carries one (PR4.3 curated weighting). Pure. */
function classificationTag({ record }: { record: CorpusRecord }): string {
  const value = record.attrs?.["classification"];
  return typeof value === "string" ? ` [${value}]` : "";
}

/** Render one record as a prompt block, carrying the share of the batch budget it was allotted. */
function recordBlock({ record, body }: { record: CorpusRecord; body: string }): string {
  const head = `[${record.kind}${record.author !== undefined ? ` by ${record.author}` : ""} · ${record.tsIso}]${classificationTag({ record })}`;
  const refs = record.refs.length > 0 ? `\nrefs: ${record.refs.join(", ")}` : "";
  return `${head} ${record.url}\n${body}${refs}`;
}

/**
 * Build the distil prompt for a batch — the SAME prompt whether it is about to be handed to a forced-tool
 * call (the old path) or printed for a visible session to compose from (the current one).
 *
 * @param batch the batch to digest
 * @returns the `system` + `user` prompt
 */
export function buildDigestPrompt({ batch }: { batch: DistilBatch }): { system: string; user: string } {
  const header = `Source: ${batch.source}\nContainer: ${batch.container}\nRecords: ${String(batch.records.length)}\n`;
  const bodies = promptBodies({ records: batch.records });
  const blocks = batch.records.map((record, index) => recordBlock({ body: bodies[index]!.body, record }));
  const user = `${header}\n${blocks.join("\n\n")}`;
  return { system: SYSTEM, user };
}

/**
 * What the batch budget will discard from a plan before the session reads it.
 *
 * Measured over the batches rather than over the corpus, because the batches are what actually gets shown — a
 * record that `groupForDistil` left out of the plan was not truncated, it was never offered. And measured
 * from {@link promptBodies}'s own allowances rather than derived as `length - cap`: the budget is spent per
 * BATCH, so what any one record kept depends on the records beside it. A derived figure would now be wrong
 * in both directions, over-reporting the loss on a record that got more than the flat share and under-
 * reporting it on one that got less. (The ask lane learned the same lesson — see `askPrompt`'s own
 * `promptTruncation`, which stopped deriving for exactly this reason.)
 *
 * Reported as a separate pass instead of returned by {@link buildDigestPrompt} so a plan of thousands of
 * batches can be measured without building (and holding) every prompt.
 *
 * @param batches the batch plan a run would distil
 * @returns what the budget will truncate, across every record in the plan
 */
export function digestPromptTruncation({ batches }: { batches: readonly DistilBatch[] }): Truncation {
  let truncated = 0;
  let keptChars = 0;
  let droppedChars = 0;
  let longest = 0;
  let measured = 0;
  for (const batch of batches) {
    for (const body of promptBodies({ records: batch.records })) {
      const offered = body.keptChars + body.droppedChars;
      keptChars += body.keptChars;
      droppedChars += body.droppedChars;
      longest = offered > longest ? offered : longest;
      truncated += body.droppedChars > 0 ? 1 : 0;
      measured += 1;
    }
  }
  return { cap: DISTIL_RECORD_CHARS, droppedChars, keptChars, longest, measured, truncated };
}

/**
 * Validate a composed digest against a batch: keep only points that have text AND at least one citation.
 * Identical to what the forced-tool output was checked against before rule 2 — the session's answer earns
 * no less scrutiny than a model's did.
 *
 * @param batch the batch being digested (supplies source/container)
 * @param input the raw composed digest, as parsed JSON
 * @returns the validated digest, or an error naming what is missing
 */
export function validateBatchDigest({
  batch,
  input,
}: {
  batch: DistilBatch;
  input: unknown;
}): Result<BatchDigest, DistilError> {
  if (!isRecord(input) || typeof input["summary"] !== "string" || !Array.isArray(input["points"])) {
    return err(DistilErrors.digestShapeInvalid());
  }
  const points: DigestPoint[] = [];
  for (const raw of input["points"]) {
    if (!isRecord(raw) || typeof raw["point"] !== "string" || raw["point"].trim().length === 0) {
      continue;
    }
    const citations = Array.isArray(raw["citations"])
      ? raw["citations"].filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      : [];
    if (citations.length > 0) {
      points.push({ citations, point: raw["point"] });
    }
  }
  const summary = input["summary"].trim();
  if (summary.length === 0 && points.length === 0) {
    return err(DistilErrors.digestEmpty());
  }
  return ok({ container: batch.container, points, source: batch.source, summary });
}

/**
 * Reduce per-container digests into a per-source digest (richest containers first).
 *
 * @param digests the container digests for that source
 * @param recordCount total records for the source
 * @returns the source digest
 */
export function reduceToSourceDigest({
  source,
  digests,
  recordCount,
}: {
  source: CorpusSource;
  digests: readonly BatchDigest[];
  recordCount: number;
}): SourceDigest {
  const containers = [...digests].toSorted(
    (a, b) => b.points.length - a.points.length || compareStrings({ a: a.container, b: b.container }),
  );
  return { containers, recordCount, source };
}
