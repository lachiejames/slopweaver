/**
 * Reading a {@link ReviewVerdict} off disk — the edge between the reviewing session and the door.
 *
 * A file rather than a flag full of JSON because the reviewing session is a DIFFERENT session: it writes
 * what it found, and the session running `turn answer` passes the path. Nothing here authenticates either
 * session (see `.claude/rules/cross-session-messages.md`); what it does is make the verdict a typed artifact
 * that the door can check against the answer's bytes, rather than a claim made in prose.
 *
 * Parsed strictly. A verdict is the one input whose whole job is to be checkable, so a malformed one must
 * fail loudly at the edge instead of arriving at the door as a partially-populated object that happens to
 * satisfy a field access.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { isSlackTs } from "../lib/slackTs.js";
import { imageObservationUnfitReasons } from "./imageObservationCoverage.js";
import type { ReviewedClaim, ReviewedImage, ReviewedVoice, ReviewVerdict } from "./reviewVerdict.js";

/** The on-disk shape. Mirrors {@link ReviewVerdict} exactly — a drift here is a defect, not a variant. */
const reviewVerdictSchema = z.object({
  answerDigest: z.string(),
  authorSession: z.string().min(1),
  claims: z.array(
    z.object({
      evidence: z.string().optional(),
      impact: z.enum(["high", "low"]),
      // Both optional at the schema so an older verdict stays readable; `claimCoherence` refuses one alone.
      readAtIso: z.iso.datetime({ offset: true }).optional(),
      readCommand: z.string().min(1).optional(),
      restsOn: z.enum(["answer", "live"]).optional(),
      support: z.enum(["supported", "unsupported", "unverifiable"]),
      text: z.string().min(1),
    }),
  ),
  // Optional, and absent means the empty list — see `ReviewVerdict.imageObservations` for why requiring it
  // would refuse harmless text-only verdicts without covering one more picture.
  imageObservations: z
    .array(
      z.object({
        artifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/, "expected sha256:<64 hex>"),
        contextRetained: z.boolean(),
        legible: z.boolean(),
        observedContent: z.string().min(1),
        path: z.string().min(1),
        targetState: z.enum(["data", "zero-results", "unloaded", "empty-panel"]),
        unfitReason: z.enum(["unloaded", "empty-panel", "illegible", "context-lost"]).optional(),
      }),
    )
    .optional(),
  outcome: z.enum(["clean", "broken", "incomplete"]),
  reviewerSession: z.string().min(1),
  schemaVersion: z.literal(1),
  // Optional, and absent refuses the delete rather than allowing it — see `ReviewVerdict.supersession`. The
  // `targetTs` is validated as a real Slack timestamp here rather than downstream, because a verdict naming
  // a malformed one could never match the form's declaration anyway, and the parse boundary is where a
  // reviewer finds out.
  supersession: z
    .object({
      reason: z.string().min(1),
      targetTs: z.string().refine((ts) => isSlackTs({ ts }), { message: "expected a Slack message timestamp" }),
      warranted: z.boolean(),
    })
    .optional(),
  // Optional so a verdict written against an older packet still parses. Absent is NOT "no violations":
  // `answerQualityFindings` raises `ANSWER_VOICE_UNCHECKED` on it — see `ReviewVerdict.voice`.
  voice: z
    .object({
      pathsChecked: z.array(z.string().min(1)),
      rulesChecked: z.number().int().min(0),
      violations: z.array(z.object({ path: z.string().min(1), rule: z.string().min(1) })),
    })
    .optional(),
});

/**
 * Why a parsed observation's stated reason disagrees with what it observed, if it does.
 *
 * The schema can say `unfitReason` is one of four words; it cannot say the word has to be about THIS
 * picture. Two incoherences matter and neither is expressible in a schema: a reviewer that recorded a
 * defect and named no reason leaves the refusal with nothing to print, and a reviewer that named a reason
 * no observed field supports has written a refusal about a picture it did not describe. A reason naming at
 * least one of the observed defects is enough — several can stand at once, and picking which to print is
 * the renderer's job, not the parser's.
 *
 * `imageObservationUnfitReasons` derives the defects from the OBSERVED fields, never from `unfitReason`,
 * so this check cannot be satisfied by stating a reason.
 *
 * @param observation one parsed observation
 * @returns the problems with it, empty when it is coherent
 */
function observationCoherence({ observation }: { observation: ReviewedImage }): readonly string[] {
  const reasons = imageObservationUnfitReasons({ observation });
  if (reasons.length > 0 && observation.unfitReason === undefined) {
    return [
      `imageObservations[${observation.path}]: recorded unfit (${reasons.join(", ")}) but names no ` +
        "`unfitReason` — a refusal that says nothing is the unhelpful block the owner rules out",
    ];
  }
  if (reasons.length === 0 && observation.unfitReason !== undefined) {
    return [
      `imageObservations[${observation.path}]: names \`unfitReason\` ${observation.unfitReason} while every ` +
        "observed field says the picture is fit — one of the two is wrong and the parser cannot tell which",
    ];
  }
  if (observation.unfitReason !== undefined && !reasons.includes(observation.unfitReason)) {
    return [
      `imageObservations[${observation.path}]: names \`unfitReason\` ${observation.unfitReason}, which none ` +
        `of what it observed supports (${reasons.join(", ")})`,
    ];
  }
  return [];
}

/**
 * Why a parsed claim's read fields disagree with each other, if they do.
 *
 * `readCommand` and `readAtIso` are one fact in two fields — what read the live state, and when — and a
 * later round carries the claim as a re-read only on both. One without the other is a reviewer that
 * half-declared its read, and accepting it would let the half-declaration silently earn nothing while
 * reading, on disk, as though the read had been recorded. Refused at the edge so the reviewer sees it.
 *
 * @param claim one parsed claim
 * @returns the problems with it, empty when it is coherent
 */
function claimCoherence({ claim }: { claim: ReviewedClaim }): readonly string[] {
  const hasCommand = claim.readCommand !== undefined;
  const hasInstant = claim.readAtIso !== undefined;
  if (hasCommand === hasInstant) {
    return [];
  }
  const present = hasCommand ? "readCommand" : "readAtIso";
  const missing = hasCommand ? "readAtIso" : "readCommand";
  return [
    `claims[${claim.text}]: carries \`${present}\` and no \`${missing}\` — a read is the command AND the instant, ` +
      "and the next round can re-run only a claim that names both",
  ];
}

/**
 * Why a parsed voice record disagrees with itself, if it does.
 *
 * One incoherence, and it is the shape a reviewer produces when it is pattern-matching the field rather than
 * filling it: a violation of a rule it says it was never given. The schema can say `rulesChecked` is a
 * non-negative integer; it cannot say a list of broken rules implies at least one rule existed.
 *
 * @param voice the parsed record, or `undefined` when the verdict carries none
 * @returns the problems with it, empty when it is coherent or absent
 */
function voiceCoherence({ voice }: { voice: ReviewedVoice | undefined }): readonly string[] {
  if (voice === undefined || voice.violations.length === 0 || voice.rulesChecked > 0) {
    return [];
  }
  return [
    `voice: reports ${String(voice.violations.length)} violation(s) while saying it was given no rules to ` +
      "check — one of the two is wrong and the parser cannot tell which",
  ];
}

/** What the on-disk schema parses a verdict into, before it is rebuilt as a {@link ReviewVerdict}. */
type ParsedVerdict = z.infer<typeof reviewVerdictSchema>;

/**
 * The image observations a parsed verdict carries. A verdict written against an older packet omits the
 * field, and its absence means it observed no picture — `ReviewVerdict.imageObservations` says why an
 * image-bearing answer still gets its missing-coverage finding at the send boundary.
 */
function observationsOf({ data }: { data: ParsedVerdict }): NonNullable<ParsedVerdict["imageObservations"]> {
  const { imageObservations } = data;
  if (imageObservations === undefined) {
    return [];
  }
  return imageObservations;
}

/**
 * Read and validate a reviewer's verdict.
 *
 * Deliberately does NOT check the digest against any answer, nor that the two sessions differ. Those are the
 * door's findings, and duplicating them here would let a caller that skipped the door still feel checked —
 * the gate reports them as named findings a reader can act on, which a thrown parse error cannot.
 *
 * @param path the verdict JSON file the reviewing session wrote
 * @returns the parsed verdict, or the reason it could not be read
 */
export function readReviewVerdict({ path }: { path: string }): Result<ReviewVerdict> {
  const text = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "read verdict", path });
  if (text.isErr()) {
    return err([`--verdict ${path}: ${text.error.message}`]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.value);
  } catch (cause) {
    return err([`--verdict ${path}: not valid JSON (${cause instanceof Error ? cause.message : "unparseable"})`]);
  }
  const parsed = reviewVerdictSchema.safeParse(raw);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `--verdict ${path}: ${issue.path.join(".")} ${issue.message}`));
  }
  // Zod types an optional field as `T | undefined`, which `exactOptionalPropertyTypes` will not accept for a
  // `?:` property. Rebuilt rather than cast, so a claim with no evidence has no KEY rather than a present
  // key holding undefined — the gate reads absence, and the two are not the same value.
  //
  // `restsOn` is rebuilt here too. It was dropped by the original mapping: the schema parsed it and the
  // rebuild never copied it, so EVERY verdict read through this edge arrived with the field absent, which
  // `ReviewVerdict` defines as `live` — silently disabling the round-to-round claim carrying that field
  // exists for. Found by a Codex review of this change; `reviewVerdictFile.test.ts` is the regression.
  const imageObservations: ReviewedImage[] = observationsOf({ data: parsed.data }).map((observation) => ({
    artifactDigest: observation.artifactDigest,
    contextRetained: observation.contextRetained,
    legible: observation.legible,
    observedContent: observation.observedContent,
    path: observation.path,
    targetState: observation.targetState,
    ...(observation.unfitReason !== undefined ? { unfitReason: observation.unfitReason } : {}),
  }));
  // `voice` is lifted OUT of the spread rather than overridden after it, because absent must leave no key at
  // all: `exactOptionalPropertyTypes` distinguishes a missing property from one holding `undefined`, and the
  // gate reads that absence as "the reviewer said nothing", which is a finding rather than a pass.
  const { voice, supersession, ...rest } = parsed.data;
  const verdict: ReviewVerdict = {
    ...rest,
    claims: parsed.data.claims.map((claim) => ({
      impact: claim.impact,
      support: claim.support,
      text: claim.text,
      ...(claim.evidence !== undefined ? { evidence: claim.evidence } : {}),
      ...(claim.readAtIso !== undefined ? { readAtIso: claim.readAtIso } : {}),
      ...(claim.readCommand !== undefined ? { readCommand: claim.readCommand } : {}),
      ...(claim.restsOn !== undefined ? { restsOn: claim.restsOn } : {}),
    })),
    imageObservations,
    ...(voice === undefined ? {} : { voice }),
    // Lifted out of the spread for the same `exactOptionalPropertyTypes` reason `voice` is: absent must
    // leave no key at all, because the eligibility check reads that absence as "no reviewer looked".
    ...(supersession === undefined ? {} : { supersession }),
  };
  const incoherent = [
    ...verdict.claims.flatMap((claim) => claimCoherence({ claim })),
    ...imageObservations.flatMap((observation) => observationCoherence({ observation })),
    ...voiceCoherence({ voice }),
  ].map((issue) => `--verdict ${path}: ${issue}`);
  return incoherent.length > 0 ? err(incoherent) : ok(verdict);
}
