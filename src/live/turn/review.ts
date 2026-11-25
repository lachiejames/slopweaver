/**
 * The independent review of one composed answer — its record and the packet the reviewer reads. Pure:
 * `reviewStore.ts` does the files, `cli/commands/turn/review.ts` does cmux, and `reviewPoll.ts` owns the READ
 * side of the verdict, which nothing here imports.
 *
 * ## The reviewer is briefed by CODE, and that is the whole property
 *
 * The answer-quality gate (`admit/answerQualityGate.ts`) refuses a send whose verdict is missing, stale or
 * self-issued, and the rule behind it is exact: another session's grade counts only when the author did not
 * write that session's instructions. While the LOOP opened every reviewer, the worker that composed the
 * answer never touched the reviewer's prompt. Once the worker owns its ask to the terminal outcome — it
 * posts, so it must be the one that gets the answer reviewed — the same rule has to be kept by a different
 * mechanism, and this module is it: the reviewer's packet is a deterministic function of the answer's own
 * bytes, the decision that dispatched it and the brief it answers. The worker presses the button; it does
 * not write a word the reviewer reads, and the packet says so to the reviewer.
 *
 * What the packet carries is exactly what `skills/loop/reference/reviewer.md` lists — what the question
 * literally asked to be handed, the question, the answer verbatim, its digest, the live-read plan, the
 * evidence the answer claims and its citations, and a pointer to the owner's applicable directives — and
 * nothing else. Not the worker's transcript: that would anchor the reviewer on the author's reasoning, which
 * is the thing a second agent exists to break.
 *
 * The deliverables section leads (`admit/requestedDeliverables.ts`) because ORDER is the fix it carries: a
 * reviewer that reaches "did this hand back what was asked for" after eight sections of claim-checking has
 * already spent the round. Measured: six rounds over two hours, all of them rigorous, on an
 * answer that never carried the link the ask existed for.
 *
 * ## The record is an address, never a claim
 *
 * `ReviewRecord` holds where the reviewer is (its cmux locator), what it was asked to bind to (the digest)
 * and where it was told to write. It never carries "reviewed" — `--poll` reads the verdict file, fresh, every
 * time, the same discipline `dispatch.ts`'s header explains for the worker's own record.
 *
 * It DOES carry which round this is and what the last round left open, because a round that cannot see either
 * restarts instead of continuing — `reviewRounds.ts` has the measured six-round failure that bought those two
 * fields, and owns every rule about what a late round may escalate.
 */
import { z } from "zod";

import { coreDeliverableReviewLines } from "../../admit/requestedDeliverables.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import type { AskIdentity } from "../ask/identity.js";
import type { AnswerChange } from "./answerChange.js";
import { reviewImageSectionLines } from "./reviewImageSection.js";
import type { ReviewPacketImage } from "./reviewImages.js";
import type { ReReadClaim, SettledClaim } from "./reviewRounds.js";
import { carriedRoundLines, roundTermsLines } from "./reviewThroughput.js";
import { packetVerdictSection } from "./reviewVerdictSection.js";
import type { FreshVisibleSessionRef, RespondDecision } from "./tier.js";
import { reviewImageClauseLines } from "./userFacingImpactGuidance.js";

/**
 * The review-record schema version. A record at another version is refused, never reinterpreted.
 *
 * 2 since `round`/`carriedUnresolved` joined the record: a version-1 record cannot say which round it is, and
 * a round this program cannot count is a round it cannot narrow. Refusing one reads to a caller as "no review
 * has been opened", which re-opens the review from round 1 — the same recovery a missing record already has.
 */
export const REVIEW_RECORD_SCHEMA_VERSION = 2;

/** One opened review, as durably recorded — locator and binding facts only. */
export interface ReviewRecord extends AskIdentity {
  readonly schemaVersion: 2;
  /** The digest the reviewer was told to bind its verdict to — `answerDigestOf` on the exact bytes. */
  readonly answerDigest: string;
  /** The answer file the packet was composed from, so a re-run can tell a re-review from a repeat. */
  readonly answerPath: string;
  /** The packet this program composed for the reviewer. */
  readonly packetPath: string;
  /** Where the reviewer was told to write its verdict — what `--poll` reads. */
  readonly verdictPath: string;
  /** How the packet names the answer's author — what its verdict must carry as `authorSession`. */
  readonly authorSession: string;
  /** How the packet names the reviewer — what its verdict must carry as `reviewerSession`. */
  readonly reviewerSession: string;
  /** The reviewer's cmux locator — an address to poll and, once the verdict exists, to close. */
  readonly reviewer: FreshVisibleSessionRef;
  readonly spawnedAt: string;
  /** Which round of review this is for the ask, 1-based — see `reviewRounds.ts` for what a late one changes. */
  readonly round: number;
  /** The high-impact claims the PREVIOUS round left unresolved, carried so this round continues rather than restarts. */
  readonly carriedUnresolved: readonly string[];
  /**
   * When round 1 of this ask opened — the packet's clock and the live card read it. Optional so a record
   * written before it existed still parses; absent reads as "not recorded", never as now.
   */
  readonly reviewStartedAt?: string | undefined;
  /**
   * When this reviewer's workspace was released, if it has been. Absent means it is still the ask's live
   * reviewer — which is what stops the ask's terminal path reporting a failed close of a session a
   * well-behaved worker had already closed by hand (`reviewRelease.ts`).
   */
  readonly releasedAt?: string | undefined;
}

/** The strict parse-edge schema for a decoded review record. */
const reviewRecordSchema = z
  .object({
    answerDigest: z.string().min(1),
    answerPath: z.string().min(1),
    authorSession: z.string().min(1),
    carriedUnresolved: z.array(z.string().min(1)).readonly(),
    channel: z.string().min(1),
    messageTs: z.string().min(1),
    packetPath: z.string().min(1),
    reviewer: z
      .object({
        cwd: z.string().min(1).optional(),
        host: z.enum(["claude-code", "codex"]),
        sessionName: z.string().min(1).optional(),
        surfaceId: z.string().min(1),
        surfaceRef: z.string().min(1),
        workspaceId: z.string().min(1),
        workspaceRef: z.string().min(1),
      })
      .strict(),
    releasedAt: z.string().min(1).optional(),
    reviewStartedAt: z.string().min(1).optional(),
    reviewerSession: z.string().min(1),
    round: z.number().int().min(1),
    schemaVersion: z.literal(REVIEW_RECORD_SCHEMA_VERSION),
    spawnedAt: z.string().min(1),
    threadTs: z.string().min(1),
    verdictPath: z.string().min(1),
  })
  .strict() satisfies z.ZodType<ReviewRecord>;

/**
 * Parse an already-decoded review record.
 *
 * @param value the decoded JSON value
 * @returns the validated record, or every schema violation
 */
export function parseReviewRecord({ value }: { value: unknown }): Result<ReviewRecord> {
  const parsed = reviewRecordSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(parsed.error.issues.map((issue) => issue.message));
}

/**
 * How a reviewer workspace and its author are named to each other — the two strings the verdict must carry,
 * which the door checks differ. A workspace REF alone is not enough: cmux renumbers refs as workspaces
 * close, so the id is what makes the name still point at the same session an hour later.
 *
 * @param role which party this names
 * @param session the party's cmux locator
 * @returns the name the packet and the record both use
 */
export function reviewPartyName({
  role,
  session,
}: {
  role: "author" | "reviewer";
  session: Pick<FreshVisibleSessionRef, "workspaceRef" | "workspaceId">;
}): string {
  return `${role} workspace ${session.workspaceRef} (${session.workspaceId})`;
}

/**
 * The packet the reviewer reads — every item `skills/loop/reference/reviewer.md` lists, composed from the
 * answer's own bytes, and nothing the answer's author wrote about it.
 *
 * Markdown rather than JSON because a reviewer is an agent reading a page, and the one thing it must get
 * exactly right — the digest — is quoted in a fenced block it can copy. The answer itself is embedded as the
 * exact JSON the digest was computed over, so "verbatim" is literal.
 *
 * @param answer the composed answer, already parsed through the same schema the door uses
 * @param answerDigest the digest the door will bind the verdict to
 * @param askIdentity the ask's own channel and thread — the conversation the question came from, which is
 *   ALWAYS in scope as evidence (measured: a reviewer pointed only at provider records marked a
 *   claim unverifiable whose proof was a message in the ask's own thread)
 * @param askPermalink the live thread's permalink, when known — the reviewer reads it with `slack read-thread`
 * @param authorSession how the answer's author is named — what the verdict must carry as `authorSession`
 * @param briefPath the brief file whose `routingInput.ownerDirectives` holds the owner's current rulings
 * @param carriedReads what the PREVIOUS round settled that rests on LIVE state and recorded its read for, so a
 *   re-review re-runs one read rather than rediscovering the claim
 * @param carriedSettled what the PREVIOUS round settled that rests on the answer's own bytes, so a re-review
 *   inspects it rather than re-deriving it
 * @param changes which paths of the answer moved since the last verdict, computed by code from the two answers —
 *   `undefined` when there is nothing sound to compare against, which makes a re-review a full one
 * @param clock when round 1 of this ask opened and when this round's reviewer was booted — the packet's clock
 * @param carriedUnresolved what the PREVIOUS round left high-impact and unresolved, so a re-review continues
 *   that list rather than deriving a fresh and different one (`reviewRounds.ts`)
 * @param decision the decision that dispatched the answer — its `needs` are the sanctioned live-read plan
 * @param ownerDirectiveCount how many owner directives the brief carries, so an empty set reads as checked
 * @param question the question as asked
 * @param reviewerSession how the reviewer is named — what the verdict must carry as `reviewerSession`
 * @param round which round of review this is for the ask, 1-based — past `REVIEW_ROUND_CAP` it narrows what a
 *   newly-found problem in unrequested scope is allowed to escalate to
 * @param verdictPath where the reviewer must write its verdict
 * @param voicePrinciples the owner's binding voice rules from the brief's profile, NAMED so each is a claim
 *   the reviewer classifies — a rule pointed at instead of named is a rule not checked
 * @returns the packet text
 */
export function reviewerPacket({
  answer,
  answerDigest,
  askIdentity,
  askPermalink,
  authorSession,
  briefPath,
  carriedReads,
  carriedSettled,
  carriedUnresolved,
  changes,
  clock,
  decision,
  images,
  ownerDirectiveCount,
  question,
  reviewerSession,
  round,
  verdictPath,
  voicePrinciples,
}: {
  answer: AnswerFormAnswer;
  answerDigest: string;
  askIdentity: AskIdentity;
  askPermalink: string | undefined;
  authorSession: string;
  briefPath: string;
  carriedReads: readonly ReReadClaim[];
  carriedSettled: readonly SettledClaim[];
  carriedUnresolved: readonly string[];
  changes: readonly AnswerChange[] | undefined;
  clock: { readonly reviewStartedAt: string | undefined; readonly spawnedAt: string };
  decision: RespondDecision;
  images: readonly ReviewPacketImage[];
  ownerDirectiveCount: number;
  question: string;
  reviewerSession: string;
  round: number;
  verdictPath: string;
  voicePrinciples: readonly string[];
}): string {
  return [
    ...packetOpeningSections({ images, question }),
    ...roundTermsLines({ carriedUnresolved, clock, round }),
    ...packetAnswerSections({ answer, answerDigest, askIdentity, askPermalink, question }),
    ...packetEvidenceSections({ answer, briefPath, decision, ownerDirectiveCount, voicePrinciples }),
    // AFTER the answer and the evidence, never before: prior conclusions read first anchor the reviewer.
    ...carriedRoundLines({ carriedReads, carriedSettled, changes, round }),
    ...packetVerdictSection({
      answerDigest,
      authorSession,
      images,
      reviewerSession,
      round,
      supersedes: answer.supersedes,
      verdictPath,
      voiceRuleCount: voicePrinciples.length,
    }),
  ].join("\n");
}

/**
 * The packet's opening: who the reviewer is, section 1's deliverable duty, the two image clauses, and between
 * them the question-keyed user-facing impact clause.
 *
 * 1b and 1c are separate sections and used to be one. 1b is a CEILING on what an ABSENT picture may cost,
 * because the composer's brief defaults to attaching one and a reviewer reading only that would start
 * failing correct answers. 1c is a CHECK on every picture that is PRESENT, and carries no ceiling at all —
 * the half that is absent when two unreadable screenshots ship through six clean
 * rounds. See `./visualEvidenceGuidance.js` and `./reviewImageSection.js`; the question-keyed user-facing impact
 * clause between them is `./userFacingImpactGuidance.js`'s, read before 1c so the reviewer knows whose screen to
 * look for.
 *
 * @param images the resolved attachment inventory, which decides whether 1c renders at all
 * @param question the question as asked, which decides what section 1 demands
 * @returns the opening's lines, in order
 */
function packetOpeningSections({
  images,
  question,
}: {
  images: readonly ReviewPacketImage[];
  question: string;
}): readonly string[] {
  return [
    "# Review packet — composed by `slopweaver turn review`, not by the answer's author",
    "",
    "You are the independent reviewer of ONE composed Slack answer. This packet was assembled by code from the",
    "answer's own bytes; the session that wrote the answer did not write a word of it, and you have not seen",
    "that session's reasoning on purpose. Judge the answer against the evidence, not against its confidence.",
    "",
    ...coreDeliverableReviewLines({ question }),
    ...reviewImageClauseLines({ question }),
    ...reviewImageSectionLines({ images }),
  ];
}

/** Sections 2–4 of the packet: the question, the answer verbatim, and the digest. */
function packetAnswerSections({
  answer,
  answerDigest,
  askIdentity,
  askPermalink,
  question,
}: {
  answer: AnswerFormAnswer;
  answerDigest: string;
  askIdentity: AskIdentity;
  askPermalink: string | undefined;
  question: string;
}): readonly string[] {
  const thread =
    askPermalink === undefined
      ? `The live thread: channel ${askIdentity.channel}, thread ${askIdentity.threadTs} (ask ${askIdentity.messageTs}) — ` +
        "resolve its permalink and read it with `slopweaver slack read-thread <permalink> --json`."
      : `The live thread: ${askPermalink} — read it with \`slopweaver slack read-thread ${askPermalink} --json\`.`;
  return [
    "## 2. The question, as asked",
    "",
    question,
    "",
    thread,
    "That conversation is ALWAYS in scope as evidence: the message that proves or breaks a claim is often in the",
    "thread the question came from, not in any cited record.",
    "",
    "## 3. The composed answer, verbatim",
    "",
    "```json",
    JSON.stringify(answer, null, 2),
    "```",
    "",
    "## 4. The digest your verdict binds to",
    "",
    "```",
    answerDigest,
    "```",
    "",
    "Copy it exactly. The door re-computes it from the answer after parsing, so this is the only correct value —",
    "never a `sha256sum` of a file.",
    "",
  ];
}

/** Sections 5–9 of the packet: the plan, the grounding, the citations, the directives, and the voice rules. */
function packetEvidenceSections({
  answer,
  briefPath,
  decision,
  ownerDirectiveCount,
  voicePrinciples,
}: {
  answer: AnswerFormAnswer;
  briefPath: string;
  decision: RespondDecision;
  ownerDirectiveCount: number;
  voicePrinciples: readonly string[];
}): readonly string[] {
  const plan =
    decision.needs.length === 0
      ? "- none — the decision named no live reads; the answer must rest on context and judgement alone"
      : decision.needs.map((need) => `- \`${need.capabilityId}\` (${need.requirement}): ${need.reason}`).join("\n");
  const citations =
    answer.citations.length === 0
      ? "- none"
      : answer.citations.map((citation) => `- ${citation.label} ${citation.url}`).join("\n");
  const directives =
    ownerDirectiveCount === 0
      ? "None loaded — there is no owner correction to apply to these records."
      : `${String(ownerDirectiveCount)} loaded. Read \`${briefPath}\` at \`routingInput.ownerDirectives\` and apply any ` +
        "whose described situation matches; never quote one.";
  return [
    "## 5. The live-read plan the decision sanctioned",
    "",
    plan,
    "",
    `The decision's truth mode is \`${decision.truthMode}\`: \`current\` asserts present state and must rest on a`,
    "current-truth leg; `history` is about what was said or recorded; `none` claims no evidence at all.",
    "",
    "## 6. What the answer says it read, found empty, and could not see",
    "",
    "```json",
    JSON.stringify(answer.grounding, null, 2),
    "```",
    "",
    "## 7. Its citations",
    "",
    citations,
    "",
    "## 8. Applicable owner directives",
    "",
    directives,
    "",
    ...packetVoiceSection({ voicePrinciples }),
  ];
}

/**
 * Section 9: the MINED voice principles, named, and the instruction that makes voice a classified claim.
 *
 * What it names and what it does NOT name is the fix, not a detail. The section once read as though it put
 * "the voice rules" in front of a reviewer, while the door enforced the operator's exact vocabulary list out
 * of `profile.json` — a different, larger set nothing in this packet ever mentioned. A verdict then recorded
 * `rulesChecked: 4, violations: []` over prose the door refused on the fifth word rule, and there was no move
 * out: the verdict binds to these exact bytes, fixing the prose voids it, and posting needs a live one.
 * MEASURED on `C0SYN000001/1790048248.995219`: seven rounds over one adjective.
 * `./answerPreflight.ts` now runs that exact list before this packet is ever composed, so the two halves are
 * split by what each is good at: code matches strings, a reviewer judges register.
 */
function packetVoiceSection({ voicePrinciples }: { voicePrinciples: readonly string[] }): readonly string[] {
  const voice =
    voicePrinciples.length === 0
      ? "- none loaded — only the standing public voice rules apply."
      : voicePrinciples.map((principle, index) => `${String(index + 1)}. ${principle}`).join("\n");
  return [
    "## 9. The MINED voice principles the answer must obey — named, so each is a claim you classify",
    "",
    voice,
    "",
    "These are the principles mined from how the owner writes — judgement, register, shape. They are NOT the",
    "operator's exact vocabulary rules: those are a deterministic list matched by code, run over these exact",
    "bytes before this round was opened and again at the door, so a word rule is never yours to catch and a",
    "clean verdict here can no longer be voided by one. Judge the principles; the vocabulary is settled.",
    "",
    "Treat voice as one more MATERIAL claim in your verdict: `the answer obeys every voice rule above`, `impact`",
    "`high`. Mark it `supported` only after checking EACH rule against EVERY string that renders — the lead,",
    "the index, the body, AND the grounding's evidence labels (`read`, `consultedEmpty`) and `couldNotSee` text,",
    "which render in the Details fold and are authored prose like everything else (measured: five of eight",
    "violations in one posted answer were in the evidence trail, none in the lead) — and against the bot's",
    "earlier messages in the same thread, since two consecutive bot messages in different registers read as",
    "two authors. A generic politeness pass is not this check.",
    "",
    "**A correct answer is NEVER `broken` for what it is ABOUT.** A standing rule: an answer that",
    "ranks, compares or names colleagues — who has been slowest to close out their assigned tickets, for",
    "example — is the bot working as intended, and tact is the ASKER's onus rather than the",
    "answer's. No voice rule above is ever read to mean otherwise, and `subject is unkind`, `this ranks",
    "people` or `this could put someone down` is not a violation, not an unresolved claim, and not grounds",
    "for any verdict but the one the evidence earns. Judge whether the ranking is TRUE and cited; never",
    "whether it should have been asked for.",
    "",
    "**Who may SEE a fact is a different question, and it CAN be `broken`**: hinting at",
    'a confidence (someone resigning, a "keep it to yourself", why they are away), showing a reader access-controlled',
    "data they could not already reach without the owner's yes on THIS reply, or a partial answer the owner's decision would",
    "materially change, is a `high`-impact defect; unchecked access is not permission. The owner's own privately made",
    "decision (they will invite pilot members personally) is fine to share, and what an answer is ABOUT never counts.",
    "",
    "Then RECORD what you did, in the verdict's `voice` field: `rulesChecked` is how many MINED PRINCIPLES are",
    `listed above (${String(voicePrinciples.length)}) and nothing else — it never counts the exact vocabulary`,
    "rules, which no reviewer checks. `pathsChecked` names the rendered strings you actually read,",
    "and `violations` carries one `{rule, path}` per rule the answer breaks — the rule copied from this list",
    "and the field that breaks it, never the offending words, which the door ledger would then hold. The",
    "field is what makes the claim checkable: a reviewer that read every rule and one that wrote the claim",
    "without opening a string produce identical verdicts without it, and the door refuses a verdict that says",
    "nothing here rather than reading silence as a pass.",
    "",
  ];
}

/**
 * The one line sent into the freshly booted reviewer workspace.
 *
 * @param packetPath the packet the reviewer reads
 * @param verdictPath where the reviewer writes
 * @returns the pickup line
 */
export function reviewerPickupPrompt({ packetPath, verdictPath }: { packetPath: string; verdictPath: string }): string {
  return (
    "You are the independent reviewer of one composed Slack answer, in a fresh visible session. Read " +
    `${packetPath} in full — it was composed by code, not by the answer's author — verify its claims against ` +
    `the evidence, and write your verdict JSON to ${verdictPath} exactly as the packet describes. Post nothing.`
  );
}
