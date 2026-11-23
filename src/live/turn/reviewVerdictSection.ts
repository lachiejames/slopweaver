/**
 * THE VERDICT SECTION of the reviewer packet — "What to write": what a reviewer classifies, the two standing
 * claims, what `restsOn` and a recorded read mean, and the exact JSON shape it copies.
 *
 * Its own module because it is the one part of the packet that describes the ARTIFACT the reviewer produces
 * rather than the answer it inspects, and because the instruction and the example verdict it renders must
 * move together: an example that stops matching `ReviewVerdict` is a shape a reviewer copies and the door
 * refuses. `./review.ts` composes the packet and puts this last, after the answer, the evidence and
 * whatever the previous round carried.
 */
import { DELIVERABLE_STANDING_CLAIM } from "../../admit/requestedDeliverables.js";
import type { ReviewedVoiceViolation, ReviewVerdict } from "../../admit/reviewVerdict.js";
import { exampleImageObservations, imageObservationVerdictLines } from "./reviewImageSection.js";
import { hasUnavailableImage, type ReviewPacketImage } from "./reviewImages.js";
import { THREAD_STANDING_CLAIM } from "./reviewObligations.js";
import { roundNarrowingLines } from "./reviewRounds.js";

/**
 * The packet's closing section: what to classify, and the exact verdict shape to write where — plus, once an
 * ask has run past `REVIEW_ROUND_CAP`, the rider that narrows what a late round may escalate.
 *
 * @param answerDigest the digest the verdict must bind itself to
 * @param authorSession how the answer's author is named — what the verdict must carry as `authorSession`
 * @param images the resolved attachment inventory, which decides the example's observations
 * @param reviewerSession how the reviewer is named — what the verdict must carry as `reviewerSession`
 * @param round which round this is, 1-based
 * @param supersedes the earlier answer's `ts` the composed form declared, or `undefined` for an answer that
 *   declared none — the one input that decides whether the deletion duty renders at all
 * @param verdictPath where the reviewer must write
 * @param voiceRuleCount how many rules section 9 named, which the example's `voice.rulesChecked` must match
 * @returns the section's lines, in order
 */
export function packetVerdictSection({
  answerDigest,
  authorSession,
  images,
  reviewerSession,
  round,
  supersedes,
  verdictPath,
  voiceRuleCount,
}: {
  answerDigest: string;
  authorSession: string;
  images: readonly ReviewPacketImage[];
  reviewerSession: string;
  round: number;
  supersedes: string | undefined;
  verdictPath: string;
  voiceRuleCount: number;
}): readonly string[] {
  const exampleVerdict = exampleVerdictOf({
    answerDigest,
    authorSession,
    images,
    reviewerSession,
    supersedes,
    voiceRuleCount,
  });
  return [
    ...classificationLines(),
    ...restsOnLines(),
    ...imageObservationVerdictLines({ images }),
    ...supersessionLines({ supersedes }),
    ...roundNarrowingLines({ round }),
    `Write EXACTLY this shape to \`${verdictPath}\`, then stop — you post nothing to Slack:`,
    "",
    "```json",
    JSON.stringify(exampleVerdict, null, 2),
    "```",
    "",
    `\`authorSession\` must read exactly \`${authorSession}\` and \`reviewerSession\` exactly \`${reviewerSession}\`.`,
    "",
  ];
}

/**
 * What a reviewer classifies, and the two standing claims every verdict carries.
 *
 * Its own block for the same reason {@link restsOnLines} is one: it is a constant, and leaving it inline put
 * the section's structure — classify, then `restsOn`, then images, then any deletion duty, then the shape —
 * thirty lines below the first thing a reader needs to see.
 *
 * @returns the block's lines, in order
 */
function classificationLines(): readonly string[] {
  return [
    "## What to write",
    "",
    "Classify every MATERIAL claim the answer makes as `supported`, `unsupported` or `unverifiable`, with",
    "`impact` `high` or `low`, and name the evidence for anything supported — go and look, in this order: the",
    "ask's own Slack thread (section 2), the cited records (section 7), then the live verbs `slopweaver catalog`",
    "lists. Never mark a claim `unverifiable` without having read the thread. No confidence percentage.",
    "",
    "TWO STANDING material claims, both `impact` `high`, in every verdict. The first is section 1's:",
    `\`${DELIVERABLE_STANDING_CLAIM}\` — classify it before any other claim, and mark`,
    "the verdict `broken` when it is unsupported, however sound everything else is.",
    "",
    `The second: \`${THREAD_STANDING_CLAIM}\`. Re-read the thread's TAIL at review time`,
    "— the messages LATER than the ask,",
    "especially from humans the question tagged or who replied since — and mark it `unsupported` when a person",
    "has already answered the question, or when the composed answer contradicts or duplicates what they wrote",
    "(measured: an answer led with 'nobody wrote a reason down' three messages below the tagged",
    "human writing the reason down). You are the one who can NAME the contradiction so it is fixable. Judge it",
    "as of YOUR read and no later: the door computes its own delta between the point the answer read up to and",
    "the instant of the send, and a delta that contradicts nothing rides as a one-line freshness note rather",
    "than coming back to you (`../../cli/commands/turn/postAnswer.ts`). Marking this claim `unsupported`",
    "because the thread has moved on since your read, rather than because it CONTRADICTS the answer, is the",
    "thing that cost one live incident five rounds and 156 minutes. This is distinct from section 2's evidence",
    "check: that verifies the answer's claims against the thread, this asks",
    "whether the thread has made the answer moot or wrong. Then an `outcome`:",
    "`clean` (every material claim classified, none high-impact unresolved), `broken` (a high-impact claim is",
    "unsupported), or `incomplete` (a high-impact claim you could not verify).",
    "",
  ];
}

/**
 * The DELETION duty, rendered only for an answer that declared one.
 *
 * MEASURED: without this block the
 * mechanism could not fire in production at all. The packet says "Write EXACTLY this shape" and the shape
 * carried no `supersession`, so a reviewer following the packet returned `clean`, the correction posted, and
 * `./supersession/eligibility.ts` refused the delete on `UNREVIEWED` — leaving both answers standing, which
 * is the exact state the owner's word exists to end. Every deletion test supplied the warrant itself, so all
 * of them passed while the real packet never asked for one. The instruction lives HERE, beside the example
 * it has to agree with, for the same reason the module's own header gives.
 *
 * Absent declaration renders nothing rather than a "no supersession here" line: a reviewer told about a
 * judgement that does not apply to them is being invited to invent one, and `supersession` absent from the
 * verdict is already the correct outcome for an additive follow-up.
 *
 * @param supersedes the earlier answer's `ts` the form declared, or `undefined` when it declared none
 * @returns the block's lines, in order — empty when nothing was declared
 */
function supersessionLines({ supersedes }: { supersedes: string | undefined }): readonly string[] {
  if (supersedes === undefined) {
    return [];
  }
  return [
    `THIS ANSWER DECLARES A SUPERSESSION. Its form names \`${supersedes}\` — an earlier answer of this bot's,`,
    "in this same thread — and posting the correction does NOT remove that message. Your verdict is the",
    "second of the two declarations the delete needs, and the composer cannot supply it: a session that",
    "authorises removing the thing it just replaced is the case the second declaration exists to prevent.",
    "Without yours the old answer stays up and the thread holds two answers contradicting each other.",
    "",
    "So OPEN that message, read it against the answer above, and settle one question: does this answer",
    "REPLACE a central claim of that one, or merely ADD to it? Carry the judgement as `supersession`, with",
    `\`targetTs\` exactly \`${supersedes}\`, \`warranted\` true or false, and \`reason\` in your own words.`,
    "",
    "`warranted: false` is a real answer and the right one for an additive follow-up — it is journalled as",
    "legibly as a delete, so the record says a reviewer looked and said no rather than that nobody looked.",
    "Leaving the field out entirely says exactly that nobody looked, and the delete is refused on it.",
    "",
  ];
}

/**
 * The shape the packet shows the reviewer to write — two claims, every field populated: one resting on the
 * answer, one resting on live state with the read that settled it, so both carry shapes are copied from
 * an example rather than reconstructed from prose.
 *
 * The example `outcome` is `incomplete` rather than `clean` whenever an attachment could not be read, so
 * the shape a reviewer copies is never one that would pass a packet naming a picture nobody can open.
 *
 * @param answerDigest the digest this verdict must bind itself to
 * @param authorSession the session that composed the answer
 * @param images the resolved attachment inventory, which decides the example's observations
 * @param reviewerSession this reviewer's own name
 * @param supersedes the `ts` the form declared, which decides whether the example carries a `supersession`
 * @param voiceRuleCount how many rules section 9 named
 * @returns the example verdict rendered into the packet
 */
function exampleVerdictOf({
  answerDigest,
  authorSession,
  images,
  reviewerSession,
  supersedes,
  voiceRuleCount,
}: {
  answerDigest: string;
  authorSession: string;
  images: readonly ReviewPacketImage[];
  reviewerSession: string;
  supersedes: string | undefined;
  voiceRuleCount: number;
}): ReviewVerdict {
  return {
    ...exampleSupersessionOf({ supersedes }),
    answerDigest,
    authorSession,
    claims: [
      {
        evidence: "where you looked",
        impact: "high",
        restsOn: "answer",
        support: "supported",
        text: "one material claim settled by the answer's own bytes",
      },
      {
        evidence: "what the read showed",
        impact: "high",
        readAtIso: "the instant you ran it, ISO 8601",
        readCommand: "the exact verb, query or URL you ran, as you ran it",
        restsOn: "live",
        support: "supported",
        text: "one material claim that rests on live state",
      },
    ],
    imageObservations: exampleImageObservations({ images }),
    outcome: hasUnavailableImage({ images }) ? "incomplete" : "clean",
    reviewerSession,
    schemaVersion: 1,
    // The example carries `voice` populated rather than omitted, because a reviewer copies this shape and
    // the door reads an ABSENT `voice` as "said nothing about it" — a finding, not a pass. An example that
    // left the field out would teach the one shape that fails.
    voice: {
      pathsChecked: ["lead", "body", "grounding.read[0].label"],
      rulesChecked: voiceRuleCount,
      violations: exampleVoiceViolations({ voiceRuleCount }),
    },
  };
}

/**
 * The example's `supersession`, present only when the form declared one.
 *
 * Spread rather than assigned so an answer that declared nothing produces a verdict with the key genuinely
 * ABSENT — under `exactOptionalPropertyTypes` an explicit `undefined` is not the same value, and the example
 * is serialised into the packet, where `"supersession": null` is a shape a reviewer would copy and the
 * parser would refuse.
 *
 * `targetTs` is the declared timestamp because it is a FACT of this packet and the eligibility check
 * compares the two for equality; `warranted` cannot be a self-describing placeholder the way `reason` is,
 * since the field is a boolean. `true` is the value shown, and the prose directly above the example is what
 * stops it reading as the expected answer: it says in its own paragraph that `false` is a real answer and
 * the right one for an additive follow-up.
 *
 * @param supersedes the `ts` the form declared, or `undefined` when it declared none
 * @returns the fragment to spread into the example verdict
 */
function exampleSupersessionOf({ supersedes }: { supersedes: string | undefined }): Partial<ReviewVerdict> {
  if (supersedes === undefined) {
    return {};
  }
  return {
    supersession: {
      reason: "why this answer REPLACES a central claim of that one — or, with `warranted` false, why it only adds",
      targetTs: supersedes,
      warranted: true,
    },
  };
}

/**
 * The example's violation list: one self-describing entry when section 9 named any rule, empty when it named
 * none.
 *
 * Empty is not tidiness — `readReviewVerdict` refuses a record reporting a violation of a rule it says it was
 * never given, so an example carrying one under an empty profile would be a shape the parser rejects.
 *
 * @param voiceRuleCount how many rules section 9 named
 * @returns the example entries, in order
 */
function exampleVoiceViolations({ voiceRuleCount }: { voiceRuleCount: number }): readonly ReviewedVoiceViolation[] {
  if (voiceRuleCount === 0) {
    return [];
  }
  return [{ path: "which rendered string broke it, or delete this entry", rule: "the rule, copied from section 9" }];
}

/**
 * What `restsOn` means, and why getting it wrong is how a false claim reaches the thread.
 *
 * Its own block rather than a line in the verdict section: it asks the reviewer for a judgement about its own
 * evidence, which is a different act from classifying the answer's claims, and the consequence has to be
 * stated or a reviewer will read it as bookkeeping and default it to whatever is convenient.
 *
 * @returns the block's lines, in order
 */
function restsOnLines(): readonly string[] {
  return [
    "On every claim also set `restsOn`, which only you can know, because it says what the claim's truth",
    "DEPENDS on. `answer` means it is settled by the answer's own bytes and by sources that cannot move",
    "behind them — an internal contradiction, a count against a table, a link's shape, a rule about the",
    "composed text. `live` means it rests on something that can change while the answer does not: provider",
    "state, this thread, what a URL serves, what a file at a path contains. If you are unsure, it is `live`.",
    "",
    "This is not bookkeeping. A later round may CARRY an `answer` claim as settled instead of re-deriving it,",
    "and will never carry a `live` one that way, because an unchanged answer is not an unchanged world — an",
    "answer saying production is healthy can be byte-identical an hour after it stopped being true. Marking a",
    "live claim `answer` is how a false claim reaches the thread.",
    "",
    "On every `live` claim you mark `supported`, also write `readCommand` — the exact query or command that",
    "read it, as you ran it: the `slopweaver` verb with its arguments, the search, the URL — and `readAtIso`,",
    "the instant it ran. Both or neither; the verdict is refused with one alone. A later round is handed the",
    "claim WITH that read to re-run, instead of rediscovering that the claim exists, what settles it and how",
    "to look — measured over one week, the median verdict settled seven such claims and the next round",
    "derived every one of them again from nothing. Prose in `evidence` that names the read is not enough:",
    "nothing can re-run prose.",
    "",
  ];
}
