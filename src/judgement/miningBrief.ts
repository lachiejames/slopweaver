/**
 * The judgement-mining BRIEF/ANSWER pair — the same shape as `src/gold/distilBrief.ts` and
 * `src/live/turn/brief.ts`, reused rather than reinvented (a third protocol to learn would be a worse
 * outcome than one protocol used a third time). Under rule 2 (no spawned model, anywhere) mining cannot call
 * `claude` itself: `route profile-brief` writes what the visible session is shown, the session composes the
 * profile, and `route profile-answer` validates it before anything is written to the private profile file.
 *
 * Two independent checks close the gap a schema-only validation would leave: **self-consistency** (every
 * example's `sourceHash` must actually be the sha256 of its own `text` — an example a session hand-edited
 * after mining, or fabricated outright, has no way to still satisfy this) and **held-out leakage** (no
 * accepted example's hash may match a case the routing evaluation programme (`eval/routing.cases.json`,
 * handover 5) held out to measure against — mining on the test set makes the evaluation meaningless).
 */
import { sha256Text } from "../lib/hash.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import {
  JUDGEMENT_PROFILE_SCHEMA_VERSION,
  type JudgementProfile,
  parseJudgementProfile,
} from "../live/turn/judgementProfile.js";
import { parseSourceManifest } from "./manifestSchema.js";
import { routingBalanceProblems, routingDecisionBalance } from "./miningBalance.js";
import { type JudgementMiningError, JudgementMiningErrors } from "./miningBrief.errors.js";
import { renderJudgementMiningPrompt } from "./miningPrompt.js";
import type { JudgementSampleCoverage, JudgementSelectedFile } from "./sourceSelection.js";

/** The mining brief's own version. Bumped when the shape changes, so a stale brief is refused by name. */
export const JUDGEMENT_MINING_BRIEF_VERSION = 2;

/** The mining prompt contract's fingerprint. Bumped whenever the prompt text below changes meaning. */
export const JUDGEMENT_MINING_PROMPT_FINGERPRINT = "judgement-mining-v2";

/** One bounded, already-scanned private source, ready to show in a mining prompt. */
export interface JudgementSourceSample {
  /** A generic label — never an installation-specific tool or product name (kept out of this public repo). */
  readonly label: string;
  /** `sha256:<hex>` over this sample's own bounded text, for provenance and drift detection. */
  readonly contentHash: string;
  readonly fileCount: number;
  /** What of the tree reached this sample, under which selection contract. */
  readonly coverage: JudgementSampleCoverage;
  /** A receipt per file shown, in draw order. */
  readonly selected: readonly JudgementSelectedFile[];
  /** The bounded text itself, shown verbatim in the prompt. */
  readonly text: string;
}

/** One manifest row the brief pins — everything about a source except its raw text. */
export interface JudgementSourceManifestEntry {
  readonly label: string;
  readonly contentHash: string;
  readonly fileCount: number;
  readonly coverage: JudgementSampleCoverage;
  readonly selected: readonly JudgementSelectedFile[];
}

/** The prompt a session is shown, split exactly as it is rendered. */
interface JudgementMiningBriefPrompt {
  readonly system: string;
  readonly user: string;
}

/** Everything `route profile-answer` needs to validate a drafted profile against what the brief showed. */
export interface JudgementMiningBrief {
  readonly version: number;
  readonly promptFingerprint: string;
  /** sha256 over the manifest's canonical JSON — pins WHICH sources and files were shown, not just their content. */
  readonly manifestHash: string;
  readonly sourceManifest: readonly JudgementSourceManifestEntry[];
  /** Hashes of held-out routing-eval case texts; the drafted profile may not quote any of them. */
  readonly heldOutSourceHashes: readonly string[];
  readonly prompt: JudgementMiningBriefPrompt;
}

/** Compare two strings by UTF-16 code unit — locale-independent. */
function byCodeUnit({ left, right }: { left: string; right: string }): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Canonical, order-independent manifest JSON the manifest hash is computed over. Every object is REBUILT
 * here with its keys in one fixed (alphabetical) order — a stored brief's own key order never reaches the
 * hash — and rows sort by label then content hash, so JSON's own escaping, not a hand-chosen delimiter a
 * label could contain, keeps two different manifests from hashing alike.
 */
function canonicalManifestText({ manifest }: { manifest: readonly JudgementSourceManifestEntry[] }): string {
  const rows = manifest
    .map((entry) => ({
      contentHash: entry.contentHash,
      coverage: {
        budgetSkippedFiles: entry.coverage.budgetSkippedFiles,
        candidateChars: entry.coverage.candidateChars,
        candidateFiles: entry.coverage.candidateFiles,
        contract: entry.coverage.contract,
        selectedChars: entry.coverage.selectedChars,
        selectedFiles: entry.coverage.selectedFiles,
        strata: entry.coverage.strata.map((stratum) => ({
          candidateFiles: stratum.candidateFiles,
          selectedFiles: stratum.selectedFiles,
          stratum: stratum.stratum,
        })),
        truncatedFiles: entry.coverage.truncatedFiles,
      },
      fileCount: entry.fileCount,
      label: entry.label,
      selected: entry.selected.map((file) => ({
        candidateChars: file.candidateChars,
        contentHash: file.contentHash,
        relativePath: file.relativePath,
        selectedChars: file.selectedChars,
        truncated: file.truncated,
      })),
    }))
    .map((row) => ({ row, text: JSON.stringify(row) }))
    .toSorted(
      (left, right) =>
        byCodeUnit({ left: left.row.label, right: right.row.label }) ||
        byCodeUnit({ left: left.row.contentHash, right: right.row.contentHash }) ||
        byCodeUnit({ left: left.text, right: right.text }),
    )
    .map(({ row }) => row);
  return JSON.stringify(rows);
}

/**
 * The manifest hash, or a refusal when the manifest holds a value the scan never writes. Canonical JSON is
 * injective only over manifests `./manifestSchema.ts` admits — it writes `-0` as `0` and every non-finite
 * number as `null` — so a manifest is checked before it is hashed, never hashed and trusted. What is hashed
 * (and returned) is the schema's own validated copy, so the hash covers exactly the values that were checked.
 */
function manifestHashOf({
  manifest,
}: {
  manifest: unknown;
}): Result<
  { readonly manifest: readonly JudgementSourceManifestEntry[]; readonly manifestHash: string },
  JudgementMiningError
> {
  const parsed = parseSourceManifest({ value: manifest });
  if (parsed.isErr()) {
    return err(JudgementMiningErrors.manifestInvalid({ issues: parsed.error }));
  }
  const validated = parsed.value;
  return ok({
    manifest: validated,
    manifestHash: sha256Text({ text: canonicalManifestText({ manifest: validated }) }),
  });
}

/**
 * Build a mining brief from already-scanned, bounded source samples.
 *
 * @param sources every private source sample to mine from
 * @param heldOutSourceHashes hashes of routing-eval case texts the drafted profile must not quote
 * @returns the brief to write, or a refusal when there is nothing to mine from
 */
export function buildJudgementMiningBrief({
  sources,
  heldOutSourceHashes,
}: {
  sources: readonly JudgementSourceSample[];
  heldOutSourceHashes: readonly string[];
}): Result<JudgementMiningBrief, JudgementMiningError> {
  if (sources.length === 0) {
    return err(JudgementMiningErrors.noSources());
  }
  const hashed = manifestHashOf({
    manifest: sources.map((source) => ({
      contentHash: source.contentHash,
      coverage: source.coverage,
      fileCount: source.fileCount,
      label: source.label,
      selected: source.selected,
    })),
  });
  if (hashed.isErr()) {
    return err(hashed.error);
  }
  const { manifest, manifestHash } = hashed.value;
  return ok({
    heldOutSourceHashes,
    manifestHash,
    prompt: renderJudgementMiningPrompt({ heldOutSourceHashes, manifest, manifestHash, sources }),
    promptFingerprint: JUDGEMENT_MINING_PROMPT_FINGERPRINT,
    sourceManifest: manifest,
    version: JUDGEMENT_MINING_BRIEF_VERSION,
  });
}

/** One example's hash/text pair, or nothing when the raw value is not shaped like one. Pure, no branching. */
function examplePairOf({ example }: { example: unknown }): readonly { sourceHash: string; text: string }[] {
  return isRecord(example) && typeof example["sourceHash"] === "string" && typeof example["text"] === "string"
    ? [{ sourceHash: example["sourceHash"], text: example["text"] }]
    : [];
}

/** Every raw example value a `{examples, counterexamples}`-shaped section carries, nested ones flattened. */
function rawExamplesIn({ section }: { section: unknown }): readonly unknown[] {
  if (!isRecord(section)) {
    return [];
  }
  const direct = Array.isArray(section["examples"]) ? section["examples"] : [];
  const nested = Array.isArray(section["counterexamples"])
    ? section["counterexamples"].map((counterexample: unknown) =>
        isRecord(counterexample) ? counterexample["example"] : undefined,
      )
    : [];
  return [...direct, ...nested];
}

/**
 * Every `{sourceHash, text}` pair an example (or counterexample's example) in the given voice/routing
 * sections carries. Takes the sections themselves, already captured by the caller — never re-reads them off
 * a shared `answer` object, so nothing between this call and the caller's later use of those same sections
 * can see a different value than what was validated here (no time-of-check/time-of-use gap).
 */
function collectExamplePairs({
  voice,
  routing,
}: {
  voice: unknown;
  routing: unknown;
}): readonly { sourceHash: string; text: string }[] {
  return [voice, routing]
    .flatMap((section) => rawExamplesIn({ section }))
    .flatMap((example) => examplePairOf({ example }));
}

/**
 * Validate a visible session's drafted profile against the brief it was shown, refusing manifest drift,
 * prompt drift, self-inconsistent hashes, and held-out leakage before anything is written.
 *
 * @param brief the mining brief the session was shown
 * @param answer the session's drafted `{voice, routing}` sections, as decoded JSON
 * @param nowIso the current instant, injected so this stays pure and exact-value testable
 * @returns the complete, validated profile (with provenance filled in), or every refusal reason
 */
export function acceptJudgementMiningAnswer({
  brief,
  answer,
  nowIso,
}: {
  brief: JudgementMiningBrief;
  answer: unknown;
  nowIso: () => string;
}): Result<JudgementProfile, JudgementMiningError> {
  if (brief.promptFingerprint !== JUDGEMENT_MINING_PROMPT_FINGERPRINT) {
    return err(JudgementMiningErrors.staleFingerprint());
  }
  const recomputed = manifestHashOf({ manifest: brief.sourceManifest });
  if (recomputed.isErr()) {
    return err(recomputed.error);
  }
  if (recomputed.value.manifestHash !== brief.manifestHash) {
    return err(JudgementMiningErrors.manifestTampered());
  }
  if (!isRecord(answer) || !isRecord(answer["voice"]) || !isRecord(answer["routing"])) {
    return err(JudgementMiningErrors.answerShapeInvalid());
  }
  // Deep-cloned once, right after validation, and never re-read off `answer` again. A reference capture
  // alone is not enough: `nowIso` (or anything else) mutating a NESTED property of the same object graph
  // in place — e.g. `answer.routing.counterexamples[0].example` — would still be visible through a bare
  // reference, since it is the same object in memory. Only a real copy closes that time-of-check/time-of-use
  // gap, so every check below and the final profile assembly see a value nothing after this point can alter.
  const voice = structuredClone(answer["voice"]);
  const routing = structuredClone(answer["routing"]);

  const pairs = collectExamplePairs({ routing, voice });
  const inconsistent = pairs.filter((pair) => sha256Text({ text: pair.text }) !== pair.sourceHash);
  if (inconsistent.length > 0) {
    return err(JudgementMiningErrors.inconsistentExamples({ count: inconsistent.length }));
  }

  const heldOut = new Set(brief.heldOutSourceHashes);
  const leaked = pairs.filter((pair) => heldOut.has(pair.sourceHash));
  if (leaked.length > 0) {
    return err(JudgementMiningErrors.heldOutLeak({ count: leaked.length }));
  }

  return parseJudgementProfile({
    value: {
      provenance: { minedAt: nowIso(), sourceManifestHash: brief.manifestHash },
      routing,
      schemaVersion: JUDGEMENT_PROFILE_SCHEMA_VERSION,
      voice,
    },
  })
    .mapErr((issues) => JudgementMiningErrors.profileInvalid({ issues }))
    .andThen((profile) => {
      const balance = routingDecisionBalance({ routing: profile.routing });
      const problems = routingBalanceProblems({ balance });
      return problems.length === 0 ? ok(profile) : err(JudgementMiningErrors.routingUnbalanced({ balance, problems }));
    });
}
