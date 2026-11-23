/**
 * The gate that refuses to send an answer nobody else has checked.
 *
 * ## What it is not
 *
 * It does not judge the answer. Every judgement here was made by a reviewing session and arrives as a
 * {@link ReviewVerdict}; this only refuses to send one whose verdict is missing, bound to different bytes,
 * issued by its own author, or bad. Those are checkable facts, which is the only kind of thing a pure gate
 * can honestly enforce.
 *
 * ## Why this is a new gate rather than a setting on an existing one
 *
 * `DEFAULT_GATES` is empty and the only gate on the answer path is the responder whitelist, whose
 * `ReplyContext` carries surface, channel, asker, question and the draft's first line. None of that can see
 * whether a claim was checked. And the grounding this repository already has is a narrower thing than it
 * looks: `groundCitations` silently DROPS a citation the slice never offered and `validateAnswer` still
 * returns ok, so an answer whose every citation was invented is a success with zero citations. "Was this
 * token offered?" is not "does this claim follow from what it cites?" — the second question had nothing
 * asking it.
 *
 * ## The bar, and why it is structural rather than a score
 *
 * Every material claim classified, and no unresolved high-impact claim. That is checkable by reading the
 * verdict. It is deliberately not a confidence percentage: _"when AI tries to calculate its own percentage
 * of confidence it is always misleading"_ — a number invites the author to tune it, and a reader to trust
 * it, neither of which is available with a list.
 *
 * A `warn` rather than a `hold`: the house rule is block-by-default WITH a break-glass, and a hold would
 * make "I have looked at it, send it" unrepresentable. The door records every override it waives, so
 * releasing an unreviewed answer is itself in the audit trail.
 */

import type { ReviewVerdict } from "./reviewVerdict.js";
import type { DoorFinding, DoorGate } from "./types.js";

/** The override token that waives this gate, recorded by the door whenever it is used. */
export const ANSWER_QUALITY_OVERRIDE = "answer.quality:v1";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Build one `warn` finding — every refusal here is self-correctable by construction. */
function warn({ code, summary, correction }: { code: string; summary: string; correction: string }): DoorFinding {
  return { code, correction, override: ANSWER_QUALITY_OVERRIDE, severity: "warn", summary };
}

/**
 * Every reason this verdict does not license sending this answer.
 *
 * Returned as a LIST rather than the first failure: a reviewer fixing one problem at a time, learning about
 * the next only after another round trip, is the loop this repository's typed forms exist to avoid.
 *
 * @param verdict the verdict a reviewing session composed, or `undefined` when none was supplied
 * @param answerDigest the digest of the answer actually about to be sent
 * @returns every finding that stands; empty when the answer may go
 */
export function answerQualityFindings({
  verdict,
  answerDigest,
}: {
  verdict: ReviewVerdict | undefined;
  answerDigest: string;
}): readonly DoorFinding[] {
  if (verdict === undefined) {
    return [
      warn({
        code: "ANSWER_UNREVIEWED",
        correction: "have a different visible session review the answer and supply its verdict",
        summary: "no review verdict accompanies this answer, so nothing but its author has read it",
      }),
    ];
  }
  return [
    ...digestFindings({ answerDigest, verdict }),
    ...independenceFindings({ verdict }),
    ...outcomeFindings({ verdict }),
    ...claimFindings({ verdict }),
    ...voiceFindings({ verdict }),
  ];
}

/**
 * Whether the reviewer said what it did about voice, and what it found.
 *
 * Three states, and the first is the one this exists for. Section 9 of the packet has asked for voice as a
 * classified claim, which makes "checked every rule" and "wrote a claim saying so"
 * identical in the record. {@link ReviewVerdict.voice} separates them, so a missing field is a finding
 * rather than a pass — the opposite default to `imageObservations`, because an answer with no images has
 * nothing to observe while every answer has rendered strings in it.
 *
 * A violation is reported as a COUNT with its rule names and field paths, never the offending text: this
 * summary is written to the door ledger, and `./voiceProfileGate.ts` states why that file must not become a
 * copy of every message the install has sent.
 */
function voiceFindings({ verdict }: { verdict: ReviewVerdict }): readonly DoorFinding[] {
  const { voice } = verdict;
  if (voice === undefined) {
    return [
      warn({
        code: "ANSWER_VOICE_UNCHECKED",
        correction: "check each named voice rule against every string the answer renders, and record `voice`",
        summary: "the verdict says nothing about voice, so checking every rule and checking none look the same",
      }),
    ];
  }
  if (voice.rulesChecked > 0 && voice.pathsChecked.length === 0) {
    return [
      warn({
        code: "ANSWER_VOICE_NO_PATHS_READ",
        correction: "name the rendered strings you read — the lead, the index, the body, the evidence trail",
        summary: `the verdict names ${String(voice.rulesChecked)} voice rule(s) checked against no string at all`,
      }),
    ];
  }
  if (voice.violations.length === 0) {
    return [];
  }
  return [
    warn({
      code: "ANSWER_VOICE_BROKEN",
      correction: "rewrite the strings the reviewer named, or send past the override token with a stated reason",
      summary: `${String(voice.violations.length)} voice rule violation(s): ${voice.violations
        .map((violation) => `${violation.path} breaks ${violation.rule}`)
        .join("; ")}`,
    }),
  ];
}

/** The verdict must be about the bytes being sent, not an earlier draft of them. */
function digestFindings({
  verdict,
  answerDigest,
}: {
  verdict: ReviewVerdict;
  answerDigest: string;
}): readonly DoorFinding[] {
  if (!DIGEST_PATTERN.test(verdict.answerDigest)) {
    return [
      warn({
        code: "ANSWER_VERDICT_DIGEST_MALFORMED",
        correction: "record the reviewed answer's digest as sha256:<64 hex characters>",
        summary: `the verdict's answerDigest is not a sha256 digest (${verdict.answerDigest})`,
      }),
    ];
  }
  return verdict.answerDigest === answerDigest
    ? []
    : [
        warn({
          code: "ANSWER_VERDICT_STALE",
          correction: "re-review the answer as it now stands, then supply the new verdict",
          summary: "the verdict is about different bytes than the answer being sent — it was reviewed, then edited",
        }),
      ];
}

/** Grading your own homework has to be a stated field rather than a silent act. */
function independenceFindings({ verdict }: { verdict: ReviewVerdict }): readonly DoorFinding[] {
  return verdict.authorSession === verdict.reviewerSession
    ? [
        warn({
          code: "ANSWER_VERDICT_SELF_ISSUED",
          correction: "have a session that did not compose the answer review it",
          summary: `the answer was reviewed by its own author (${verdict.authorSession})`,
        }),
      ]
    : [];
}

/** A reviewer who did not reach `clean` has already said not to send it. */
function outcomeFindings({ verdict }: { verdict: ReviewVerdict }): readonly DoorFinding[] {
  return verdict.outcome === "clean"
    ? []
    : [
        warn({
          code: "ANSWER_VERDICT_NOT_CLEAN",
          correction: "resolve what the reviewer found, then have it re-reviewed",
          summary: `the reviewer marked this answer ${verdict.outcome}`,
        }),
      ];
}

/**
 * The structural bar: every material claim classified, no unresolved high-impact claim.
 *
 * An empty claim list is refused rather than passed. A reviewer who checked nothing and a reviewer who found
 * nothing to check produce the same empty array, and the first is exactly what this gate exists to catch —
 * so the ambiguity is resolved against sending.
 */
function claimFindings({ verdict }: { verdict: ReviewVerdict }): readonly DoorFinding[] {
  if (verdict.claims.length === 0) {
    return [
      warn({
        code: "ANSWER_VERDICT_NO_CLAIMS",
        correction: "list the claims the answer makes and what each one rests on",
        summary: "the verdict classifies no claims, so it cannot show the answer was checked at all",
      }),
    ];
  }
  const unresolved = verdict.claims.filter((claim) => claim.impact === "high" && claim.support !== "supported");
  const unevidenced = verdict.claims.filter((claim) => claim.support === "supported" && claim.evidence === undefined);
  return [
    ...(unresolved.length === 0
      ? []
      : [
          warn({
            code: "ANSWER_CLAIM_UNRESOLVED",
            correction: "support the claim from evidence, or remove it from the answer",
            summary: `${String(unresolved.length)} high-impact claim(s) are not supported: ${unresolved
              .map((claim) => claim.text)
              .join("; ")}`,
          }),
        ]),
    ...(unevidenced.length === 0
      ? []
      : [
          warn({
            code: "ANSWER_CLAIM_UNEVIDENCED",
            correction: "name where each supported claim was checked",
            summary: `${String(unevidenced.length)} claim(s) are marked supported with no evidence named`,
          }),
        ]),
  ];
}

/**
 * The answer-quality gate, ready to compose into the door's gate list.
 *
 * @param verdict the verdict a reviewing session composed, or `undefined` when none was supplied
 * @param answerDigest the digest of the answer actually about to be sent
 * @returns a `DoorGate` that reports every reason this answer should not go
 */
export function answerQualityGate({
  verdict,
  answerDigest,
}: {
  verdict: ReviewVerdict | undefined;
  answerDigest: string;
}): DoorGate {
  return () => answerQualityFindings({ answerDigest, verdict });
}
