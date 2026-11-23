/**
 * The distil BRIEF — what `distil brief` hands the visible session, and what `distil answer` grounds
 * against. Under rule 2 (no spawned model, anywhere) `distil` cannot call `claude` itself, so a batch is
 * answered the same way a Slack tag is: a verb retrieves and writes a brief, the session
 * composes the digest, a second verb validates it and only then updates the cache.
 *
 * This is deliberately the SAME shape as `src/live/turn/brief.ts` — a second
 * protocol to learn would be a worse outcome than one protocol used twice. Like that brief, it stores
 * the WHOLE prompt rather than a hash of some of its inputs (see that file's module doc for why an id over
 * a subset of fields is a worse guarantee than it sounds), and it reuses {@link PinnedRecordRef} /
 * {@link sliceByPinnedRefs} rather than inventing a second way to name "the same record" — a ref that
 * matches zero or more than one record REFUSES, it is never resolved by guessing.
 *
 * ## Two independent drift checks, because the batch hash does not cover everything the prompt shows
 *
 * `DistilBatch.hash` is `sha256(promptVersion + source + container + each record's sourceId + its
 * PROMPTED body)` — the body (title + text, capped) is in, but a record's `[classification]` tag and its
 * `refs` are not. So a record could be re-derived (a tag added, a ref appended) leaving the batch hash
 * unchanged while the actual prompt text the session would be shown has moved. {@link rebuildBriefBatch}
 * therefore checks the hash (the corpus still produces the same CACHE KEY) and then recomputes the prompt
 * and compares it byte for byte against what the brief stored (the corpus still produces the same
 * READING). Either mismatch refuses rather than answering from evidence the session never saw.
 */

import type { CorpusRecord, CorpusSource } from "../corpus/types.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { Truncation } from "../lib/truncation.js";
import { type PinnedRecordRef, pinSlice, sliceByPinnedRefs } from "../retrieval/pinnedSlice.js";
import { type DistilError, DistilErrors } from "./distil.errors.js";
import { buildDigestPrompt, digestPromptTruncation } from "./distil.js";
import { type DistilBatch, hashBatch } from "./distilGroup.js";

/**
 * The brief's on-disk version. Bumped when the shape changes, so a stale file is refused BY NAME.
 *
 * **2** — added `truncation`. Bumped rather than left to fail as a malformed field, and the distinction is
 * one this repository has already paid for: adding a required field without a version bump makes an older
 * file fail with a confusing complaint about the field, when the honest message is "this file predates the
 * field, regenerate it". The owner-directive overlay learned that the expensive way the same day.
 *
 * The reason a bump is cheap HERE and was not there: a distil brief is transient. It is written by
 * `distil brief` and consumed by `distil answer` minutes later, so regenerating one is genuinely a single
 * command with nothing to lose — unlike a stored overlay that accumulates rulings over weeks.
 */
export const DISTIL_BRIEF_VERSION = 2;

/** The prompt a session was shown, split exactly as {@link buildDigestPrompt} returns it. */
interface DistilBriefPrompt {
  readonly system: string;
  readonly user: string;
}

/** Everything `distil answer` needs to rebuild the exact batch a brief named and ground a digest against it. */
export interface DistilBrief {
  /**
   * What the per-record cap discarded from THIS batch before the prompt below was built.
   *
   * Measured on real batches: **69.0%** of one batch's characters and **91.1%** of another's never
   * reached the prompt — a 27,158-character PR body contributing its first 1,200. The verbs already print
   * that on stderr, and stderr is not where the artifact is. A gold document composed from clipped records
   * reads exactly like one composed from whole ones, so a later reader cannot tell "the records do not say"
   * from "the part that said it was past character 1,200".
   *
   * Stored on the brief rather than recomputed at answer time for the same reason the prompt itself is: it
   * describes what the session was actually shown, and re-deriving it later would describe a different
   * batch if the corpus moved underneath.
   */
  readonly truncation: Truncation;
  readonly version: number;
  readonly source: CorpusSource;
  readonly container: string;
  readonly hash: string;
  /** The distil contract fingerprint (`DISTIL_PROMPT_FINGERPRINT`) this batch was cut under. */
  readonly promptFingerprint: string;
  /** The batch's records, pinned by logical identity, in the batch's own order. */
  readonly refs: readonly PinnedRecordRef[];
  readonly prompt: DistilBriefPrompt;
}

/**
 * Build a brief from one batch.
 *
 * @param batch the batch `distil brief` selected
 * @param promptFingerprint the distil contract fingerprint the batch was cut under
 * @returns the brief to write
 */
export function buildDistilBrief({
  batch,
  promptFingerprint,
}: {
  batch: DistilBatch;
  promptFingerprint: string;
}): DistilBrief {
  return {
    container: batch.container,
    hash: batch.hash,
    prompt: buildDigestPrompt({ batch }),
    promptFingerprint,
    refs: pinSlice({ slice: batch.records }),
    source: batch.source,
    truncation: digestPromptTruncation({ batches: [batch] }),
    version: DISTIL_BRIEF_VERSION,
  };
}

/**
 * What the cap took out of this batch, stated where the session composing gold cannot miss it.
 *
 * Above the prompt rather than below it: a digest is written from what the prompt shows, so a reader who
 * learns afterwards that most of it was cut has already written the wrong thing. Silent when nothing was
 * cut — a line saying "0 discarded" on every clean batch would train the eye to skip exactly the block
 * that matters on a bad one.
 *
 * @param truncation what the batch budget discarded from this batch
 * @returns the warning block, blank-line terminated, or nothing when the batch was whole
 */
function truncationLines({ truncation }: { truncation: Truncation }): readonly string[] {
  if (truncation.truncated === 0) {
    return [];
  }
  const share =
    truncation.keptChars + truncation.droppedChars === 0
      ? 0
      : Math.round((truncation.droppedChars / (truncation.keptChars + truncation.droppedChars)) * 100);
  return [
    `⚠ THIS BATCH IS CLIPPED — ${String(truncation.truncated)} of ${String(truncation.measured)} record(s) cut; ` +
      `this batch's budget is ${String(truncation.cap)} chars per record spent across it, and ` +
      `${truncation.droppedChars.toLocaleString("en-US")} character(s) ` +
      `(${String(share)}%) never reached the prompt below. Longest record ${truncation.longest.toLocaleString("en-US")} chars.`,
    "A digest composed from this batch describes the FIRST part of each long record, not the record. Say so",
    "in the summary rather than asserting what the batch does not contain.",
    "",
  ];
}

/**
 * The lines the session reads: the batch identity, the exact prompt, and the answer-shape contract.
 *
 * @param brief the brief to render
 * @param briefPath where it was written, so the printed follow-up command names the right file
 * @returns the lines, ready to print
 */
export function renderDistilBrief({ brief, briefPath }: { brief: DistilBrief; briefPath: string }): readonly string[] {
  return [
    `DISTIL BRIEF — ${brief.source}/${brief.container} · batch ${brief.hash} · ${String(brief.refs.length)} record(s)`,
    "",
    ...truncationLines({ truncation: brief.truncation }),
    "Compose the digest from EXACTLY this prompt — do not add records it does not show you, and do not",
    "drop any it does:",
    "",
    "--- SYSTEM ---",
    brief.prompt.system,
    "",
    "--- USER ---",
    brief.prompt.user,
    "--- END ---",
    "",
    "WHEN YOU HAVE THE DIGEST — write this JSON to a file and validate it:",
    '  {"summary": "one sentence", "points": [{"point": "…", "citations": ["url-or-id", …]}, …]}',
    "",
    `    slopweaver distil answer --brief ${briefPath} --answer <that-file.json>`,
    "",
    "  Every point needs at least one citation or it is dropped when the digest is validated — a point",
    "  with no citation carries no evidence, and validation runs before anything is cached.",
  ];
}

/** Whether an unknown value is one of the corpus sources recorded on a `CorpusRecord`. Pure. */
function isCorpusSource(value: unknown): value is CorpusSource {
  return (
    value === "github" ||
    value === "slack" ||
    value === "linear" ||
    value === "notion" ||
    value === "gold" ||
    value === "self"
  );
}

/** Every entry of `value` that is a well-formed pinned ref, or `undefined` if any entry is not. Pure. */
function parseBriefRefs({ value }: { value: unknown }): readonly PinnedRecordRef[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const refs: PinnedRecordRef[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      return undefined;
    }
    const { source, container, sourceId } = entry;
    if (!isCorpusSource(source) || typeof container !== "string" || typeof sourceId !== "string") {
      return undefined;
    }
    refs.push({ container, source, sourceId });
  }
  return refs;
}

/** The stored prompt, or `undefined` when either half is missing or not a string. Pure. */
function parseBriefPrompt({ value }: { value: unknown }): DistilBriefPrompt | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { system, user } = value;
  return typeof system === "string" && typeof user === "string" ? { system, user } : undefined;
}

/** Every string field a brief must carry, gathered so one loop reports every problem at once. Pure. */
function parseBriefScalars({ input }: { input: Readonly<Record<string, unknown>> }):
  | {
      readonly source: CorpusSource;
      readonly container: string;
      readonly hash: string;
      readonly promptFingerprint: string;
    }
  | undefined {
  const { source, container, hash, promptFingerprint } = input;
  if (
    !isCorpusSource(source) ||
    typeof container !== "string" ||
    typeof hash !== "string" ||
    hash.length === 0 ||
    typeof promptFingerprint !== "string" ||
    promptFingerprint.length === 0
  ) {
    return undefined;
  }
  return { container, hash, promptFingerprint, source };
}

/**
 * Parse a brief read off disk, refusing anything it cannot fully account for.
 *
 * @param input the parsed JSON from the brief file
 * @returns the brief, or the reasons it was refused
 */
export function parseDistilBrief({ input }: { input: unknown }): Result<DistilBrief, DistilError> {
  if (!isRecord(input)) {
    return err(DistilErrors.briefNotObject());
  }
  if (input["version"] !== DISTIL_BRIEF_VERSION) {
    return err(DistilErrors.briefVersionMismatch({ expected: DISTIL_BRIEF_VERSION, found: input["version"] }));
  }
  const scalars = parseBriefScalars({ input });
  const refs = parseBriefRefs({ value: input["refs"] });
  const prompt = parseBriefPrompt({ value: input["prompt"] });
  const truncation = parseBriefTruncation({ value: input["truncation"] });
  const problems: string[] = [
    ...(scalars === undefined ? ["the brief is missing source/container/hash/promptFingerprint"] : []),
    ...(refs === undefined ? ["the brief's `refs` are not a list of {source, container, sourceId}"] : []),
    ...(prompt === undefined ? ["the brief's `prompt` is missing its `system` or `user` half"] : []),
    ...(truncation === undefined ? ["the brief's `truncation` tally is missing or malformed"] : []),
  ];
  if (scalars === undefined || refs === undefined || prompt === undefined || truncation === undefined) {
    return err(DistilErrors.briefInvalid({ problems }));
  }
  return ok({ ...scalars, prompt, refs, truncation, version: DISTIL_BRIEF_VERSION });
}

/**
 * The stored truncation tally, or `undefined` when it is absent or malformed.
 *
 * Refused rather than defaulted to "nothing was cut". A brief that cannot say what it discarded is exactly
 * the state this field exists to end, and inventing a zero would restore it under a field that claims
 * otherwise — worse than the silence it replaced.
 */
function parseBriefTruncation({ value }: { value: unknown }): Truncation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const cap = wholeNumber({ value: value["cap"] });
  const measured = wholeNumber({ value: value["measured"] });
  const truncated = wholeNumber({ value: value["truncated"] });
  const keptChars = wholeNumber({ value: value["keptChars"] });
  const droppedChars = wholeNumber({ value: value["droppedChars"] });
  const longest = wholeNumber({ value: value["longest"] });
  if (
    cap === undefined ||
    measured === undefined ||
    truncated === undefined ||
    keptChars === undefined ||
    droppedChars === undefined ||
    longest === undefined
  ) {
    return undefined;
  }
  return { cap, droppedChars, keptChars, longest, measured, truncated };
}

/** A non-negative integer read off disk, or `undefined` for anything else. */
function wholeNumber({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Whether the prompt recomputed at answer time is byte-identical to what the session was shown. Pure. */
function distilPromptDrift({
  stored,
  rederived,
}: {
  stored: DistilBriefPrompt;
  rederived: DistilBriefPrompt;
}): readonly string[] {
  const drift: string[] = [];
  if (stored.system !== rederived.system) {
    drift.push(
      "the distil system prompt changed since the brief was written — regenerate with `slopweaver distil brief`",
    );
  }
  if (stored.user !== rederived.user) {
    drift.push(
      "the evidence changed since the brief was written — a record's title, tags or refs were edited after " +
        "you read them; regenerate with `slopweaver distil brief`",
    );
  }
  return drift;
}

/**
 * Rebuild the exact batch a brief named, refusing the moment the corpus no longer produces it.
 *
 * Three independent checks, in order: the distil CONTRACT is unchanged (cheapest, checked first), the
 * pinned refs still resolve to exactly one record each (never substituted — see `pinnedSlice.ts`), and the
 * recomputed hash + prompt are byte-identical to what the brief stored. Any failure refuses with the reason
 * and the fix (`slopweaver distil brief` regenerates it); nothing here mutates the cache.
 *
 * @param brief the brief `distil answer` read back
 * @param records the corpus, already collapsed to the latest version of each entity
 * @param currentFingerprint the distil contract fingerprint THIS build runs under
 * @returns the rebuilt batch, or every reason it could not be rebuilt
 */
export function rebuildBriefBatch({
  brief,
  records,
  currentFingerprint,
}: {
  brief: DistilBrief;
  records: readonly CorpusRecord[];
  currentFingerprint: string;
}): Result<DistilBatch, DistilError> {
  if (brief.promptFingerprint !== currentFingerprint) {
    return err(DistilErrors.contractChanged({ briefFingerprint: brief.promptFingerprint, currentFingerprint }));
  }
  const sliced = sliceByPinnedRefs({ records, refs: brief.refs });
  if (sliced.isErr()) {
    return err(DistilErrors.pinnedRefsInvalid({ reasons: sliced.error }));
  }
  const hash = hashBatch({
    container: brief.container,
    promptVersion: currentFingerprint,
    records: sliced.value,
    source: brief.source,
  });
  if (hash !== brief.hash) {
    return err(DistilErrors.batchHashMismatch());
  }
  const batch: DistilBatch = { container: brief.container, hash, records: sliced.value, source: brief.source };
  const drift = distilPromptDrift({ rederived: buildDigestPrompt({ batch }), stored: brief.prompt });
  return drift.length > 0 ? err(DistilErrors.promptDrift({ reasons: drift })) : ok(batch);
}
