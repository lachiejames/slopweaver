/**
 * The three guidance blocks a visible session is handed about the PRIVATE half of its brief — the judgement
 * profile, its voice rules, and the owner's current directives.
 *
 * Their own module because two verbs render them and neither owns them: `turn brief` prints them when it
 * composes a brief, and `turn resume` prints them again when a dispatched worker re-opens one
 * (`cli/commands/turn/resume.ts`). They were in `./brief.ts` while that file also owned the brief's schema,
 * its decoder and its answer validation — a seam that was already there, and the file-size ratchet is what
 * made it worth cutting along.
 *
 * Beside them sit the blocks `turn brief` prints whatever the profile says: the standing answer scope and the
 * preflight an inline answer is composed under.
 *
 * Pure: prose about data, never the data. The profile and the directives stay in the machine-readable brief
 * file; what these render is the instruction to go and read it.
 */
import { inventedVisualPreflightLines } from "../../admit/inventedVisual.js";
import { realArtifactPreflightLines } from "../../admit/realArtifact.js";
import type { OwnerDirective } from "../../judgement/ownerDirective.js";
import { answerFormCapLines } from "../../outbound/assistant/capGuidance.js";
import type { FirstAnsweredEvent } from "../ask/lifecycleEvents.js";

import type { JudgementProfile } from "./judgementProfile.js";
import { firstDraftReviewLines } from "./reviewObligations.js";
import { userFacingImpactPreflightLines } from "./userFacingImpactGuidance.js";
import { visualEvidencePreflightLines } from "./visualEvidenceGuidance.js";

/**
 * Tell a visible session how to use the private profile already embedded in the brief.
 *
 * The profile itself stays in the machine-readable file rather than becoming a wall in stdout. Both the
 * routing and voice halves are named because loading the profile without putting either half in the
 * session's instructions is not a wired capability.
 *
 * @param briefPath the machine-readable brief containing `routingInput.profile`
 * @param profile the loaded private judgement profile, when one exists
 * @returns concise, explicit instructions for the visible session
 */
export function judgementProfileGuidanceLines({
  briefPath,
  profile,
}: {
  briefPath: string;
  profile: JudgementProfile | undefined;
}): readonly string[] {
  if (profile === undefined) {
    return ["PRIVATE JUDGEMENT/VOICE PROFILE: none loaded — use the standing public voice rules only."];
  }
  return [
    "PRIVATE JUDGEMENT/VOICE PROFILE: loaded.",
    `  Read ${briefPath} at routingInput.profile before deciding or drafting.`,
    "  Apply routing.* to the routing decision and voice.* to every answer. Never quote the private profile.",
    ...voiceRuleLines({ principles: profile.voice.principles }),
  ];
}

/**
 * How many voice rules are named inline before the rest are pointed at in the file.
 *
 * @internal — {@link voiceRuleLines} is the only reader.
 */
export const VOICE_RULES_NAMED_MAX = 12;

/**
 * The profile's voice rules, NAMED one per line — for the session composing an answer and for the reviewer
 * checking it. A rule not named in the brief is a rule not checked: measured, two independent
 * reviewers in a row returned `clean` on answers whose voice had never been checked against the owner's
 * profile — both passed a generic politeness scan while missing the two rules that actually bind here,
 * because their briefs said "check voice" and pointed at a file. Naming the rules is what makes each one a
 * claim the reviewer has to classify. Pure.
 *
 * @param principles the profile's `voice.principles`, in the profile's own order
 * @returns the lines, or none when the profile names no voice rule
 * @internal — rendered as part of {@link judgementProfileGuidanceLines}, never on its own.
 */
export function voiceRuleLines({ principles }: { principles: readonly string[] }): readonly string[] {
  if (principles.length === 0) {
    return [];
  }
  const named = principles.slice(0, VOICE_RULES_NAMED_MAX);
  const rest = principles.length - named.length;
  return [
    "  VOICE RULES, binding on EVERY string that renders — lead, index, body, and the grounding's evidence labels",
    "  and couldNotSee text, which render in the Details fold — each one is checked by the reviewer, so a rule",
    "  not named here is a rule not checked:",
    ...named.map((principle, index) => `    ${String(index + 1)}. ${principle}`),
    ...(rest > 0
      ? [`    … and ${String(rest)} more, at routingInput.profile.voice.principles in the brief file.`]
      : []),
  ];
}

/**
 * Tell a visible session how to apply explicit current owner rulings embedded in the brief.
 *
 * The directives stay collapsed in the machine-readable file. The prose names their precedence, because a
 * low-latency correction that loses to an older mined principle would preserve the exact gap it exists to fix.
 *
 * @param briefPath the machine-readable brief containing `routingInput.ownerDirectives`
 * @param ownerDirectives the current rulings frozen into this turn
 * @returns concise, explicit instructions for the visible session
 */
export function ownerDirectiveGuidanceLines({
  briefPath,
  ownerDirectives,
}: {
  briefPath: string;
  ownerDirectives: readonly OwnerDirective[] | undefined;
}): readonly string[] {
  if (ownerDirectives === undefined || ownerDirectives.length === 0) {
    return ["CURRENT OWNER DIRECTIVES: none loaded."];
  }
  return [
    `CURRENT OWNER DIRECTIVES: ${String(ownerDirectives.length)} loaded.`,
    `  Read ${briefPath} at routingInput.ownerDirectives before deciding or drafting.`,
    "  Apply every directive whose described situation matches this turn. It overrides conflicting mined-profile guidance.",
    "  Apply it to both action and authored voice where relevant. Never quote the private directive.",
  ];
}

/**
 * The standing rule on WHAT COMES FIRST for a worker answering in a PUBLIC channel: the answer, then the
 * tooling — never the other way round.
 *
 * MEASURED on `C0SYN000006`/`1789952379.135579`, a `#dev-alerts` ask that reached a
 * `fresh-visible-session` worker. The worker read the ask, decided the real fix was a tool, and
 * spent the next two hours opening, pushing, self-reviewing and enqueuing a pull request. The first word in
 * the thread landed two hours and thirty-eight minutes after the ask, and twelve minutes
 * AFTER the owner asked in the same public channel what was happening, embarrassed to be left waiting in front
 * of colleagues. Nothing the worker did was wrong except its order.
 *
 * ## Why the surface decides, and why it is `channel` rather than "important"
 *
 * A DM has an audience of one, who can see the card and ask. A channel has colleagues in it who cannot tell
 * a working session from a dead one, and for whom the cost of waiting is paid in public. That is a fact
 * about the surface, checkable off the brief, rather than a judgement about the question — so it is the
 * criterion. `src/cli/commands/github/answerFirstGate.ts` is the same rule with teeth, on the one
 * pull-request creation door; this block is what stops a worker reaching that refusal at all.
 *
 * Printed rather than left to canon for {@link voiceRuleLines}'s own measured reason: a rule not named in
 * the brief is a rule not checked.
 *
 * @param surface which surface this ask arrived on — the whole criterion
 * @returns the block for a channel ask, and nothing at all for a DM
 */
export function answerFirstBriefLines({ surface }: { surface: "channel" | "dm" }): readonly string[] {
  if (surface === "dm") {
    return [];
  }
  return [
    "ANSWER FIRST, THEN TOOLING — this ask is in a PUBLIC channel, so the order is a rule, not a preference:",
    "  Post a first REVIEWED answer in the thread before you open a pull request, and before any other",
    "  long-running build. It goes through the ordinary door (`slopweaver turn answer`), so it is reviewed",
    "  and voice-checked like every answer — first does not mean unchecked.",
    "  A first answer is allowed to be short and to say what it does not yet know. What it must do is say",
    "  what you have found so far and what you are about to change; colleagues in that channel cannot see",
    "  your session, your branch or your card's detail line.",
    "  Tooling is a FOLLOW-UP. Build it after the thread has an answer, and say in the thread that you are.",
    '  Declare it: add `"followThrough": { "owes": "pull-requests" | "other", "what": "<one line>" }` to that',
    "  first answer's JSON. The post then clears the push gate and KEEPS your dispatch and your workspace, and",
    "  your FINAL answer — the outcome, with no followThrough — is what ends the turn.",
    "  `slopweaver github stack push` refuses while this ask has no answer — that refusal is this rule, and",
    "  meeting it by answering is always cheaper than overriding it.",
  ];
}

/**
 * What a worker is told INSTEAD of {@link answerFirstBriefLines} once its dispatch has already posted a first
 * answer with follow-through owed — the plan stands in the thread, and the next post must be the outcome.
 *
 * Printed for a resumed worker and for a re-dispatched one alike: a stranded follow-through is picked up by a
 * session that never saw the plan being written, and without this it would read "post a first answer" and
 * post a second plan — which `turn answer` refuses (`./firstAnswer.ts`), costing it a whole review round.
 *
 * @param dispatchId the dispatch this session was resumed for, for the failure command
 * @param firstAnswer the first answer this dispatch already posted
 * @returns the block, in order
 */
export function firstAnswerPostedBriefLines({
  dispatchId,
  firstAnswer,
}: {
  dispatchId: string;
  firstAnswer: FirstAnsweredEvent;
}): readonly string[] {
  return [
    `FIRST ANSWER ALREADY POSTED at ${firstAnswer.tsIso} (Slack ts ${firstAnswer.answerTs}). The thread already ` +
      "has your plan: do not post another plan, and do not re-review it.",
    `You still owe: ${firstAnswer.what} (${firstAnswer.owes}).`,
    "Your next `turn answer` is the FINAL one: it carries the outcome (the PR links), with no followThrough. " +
      `If you cannot finish: \`slopweaver turn resume --dispatch '${dispatchId}' --failed '<why>'\`.`,
  ];
}

/**
 * The standing public rule on WHAT MAY BE ASKED, printed on every turn whether or not a private profile or a
 * directive is loaded.
 *
 * The rule, on whether the bot should answer "who has been slowest to close out their assigned tickets" in a
 * public channel: it should. Declining because the question ranks people or could put them down is not the
 * correct behavior; the onus is on the human for asking a ranking question in public, and the bot's onus is
 * to give the most accurate, citation-backed answer to the question it was given.
 *
 * ## Why this is a hard-coded block and not an owner directive
 *
 * A directive is the obvious-looking vehicle and it is the wrong one. Directives are mined into
 * `$SLOPWEAVER_HOME/judgement`, they are machine-local, and {@link ownerDirectiveGuidanceLines} legitimately
 * prints "none loaded" — so a fresh install, a replay home, or a machine whose overlay was never built would
 * run turns with the rule absent. A standing rule that can be absent is not standing. This block takes no
 * input for exactly that reason: there is no state that could switch it off.
 *
 * ## Why it is PRINTED rather than left in the skill canon
 *
 * {@link voiceRuleLines} carries the measurement: two reviewers in a row returned `clean` on
 * answers whose voice had never been checked, because their briefs said "check voice" and pointed at a file.
 * A rule not named in the brief is a rule not checked. The same reasoning binds here, one level up — a
 * session that never opens `skills/loop-bot/reference/tact-is-the-askers-onus.md` re-derives a refusal from
 * first principles and withholds a correct answer, which is the exact outcome the ruling forbids.
 *
 * @returns the block, always non-empty
 */
export function standingAnswerScopeLines(): readonly string[] {
  return [
    "WHAT MAY BE ASKED — the standing owner rule, and it never loads conditionally:",
    "  Your onus is the most accurate, citation-backed answer to ANY question you are asked, including one",
    "  that ranks, compares or names colleagues (who has been slowest to close out their assigned tickets is",
    "  the owner's own worked example, and answering it correctly is the bot WORKING AS INTENDED).",
    "  Tact is the ASKER's onus, never yours. Never withhold, soften, hedge, generalise away or decline an",
    "  answer because it would rank people, name an individual, or read as unkind — deciding that",
    '  is "not really the correct behavior" and "not necessarily your responsibility to dictate".',
    "  This licenses nothing about accuracy: you still cite what you read, still state what you could not",
    "  prove, and still never invent. It removes a refusal, never a standard.",
  ];
}

/**
 * The preflight an `inline` tier needs, because an inline answer is composed in the briefing session itself rather
 * than in a dispatched worker's `turn resume`: the answer form's caps, the visual-evidence default, and the three
 * narrower claims under it. Each block's own module carries the turn that made it a preflight.
 *
 * @param question the question as asked, which decides whether the user-facing impact and real-artifact blocks apply
 * @returns the five blocks, in the order a composer meets them
 */
export function inlineCompositionPreflightLines({ question }: { question: string }): readonly string[] {
  return [
    // `../../outbound/assistant/capGuidance.js` has the two turns that died learning the budget at validate time.
    ...answerFormCapLines(),
    ...visualEvidencePreflightLines(),
    // A user-facing impact ask leads with the customer's own replay frame. See `./userFacingImpactGuidance.js`.
    ...userFacingImpactPreflightLines({ question }),
    ...inventedVisualPreflightLines(),
    // A picture this session DREW is not the deployed thing's own panel, and `../../admit/realArtifactGate.ts`
    // refuses an inline send too.
    ...realArtifactPreflightLines({ question }),
    // An inline composer never runs `turn resume --answer`, so the checklist a worker reads at validate time is
    // printed here instead. See `./reviewObligations.js`.
    ...firstDraftReviewLines({ question }),
  ];
}
