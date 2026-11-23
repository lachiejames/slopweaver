/**
 * Every line `slopweaver turn resume` PRINTS — the brief a fresh visible session reads before it does
 * anything, and the one refusal it gets when the dispatch that opened it left no live progress card.
 *
 * Split out of `./resume.ts` along the only seam that file really has: this half is pure text over its
 * arguments and nothing here touches the filesystem, the clock or Slack, so it is the half that can be
 * asserted byte for byte. `./resume.ts` keeps the reading, the validating and the recording.
 *
 * Depth 1 — it stands on the guidance modules it composes and on nothing this verb owns.
 */
import { askerTagPreflightLines } from "../../../admit/askerTagGate.js";
import { inventedVisualPreflightLines } from "../../../admit/inventedVisual.js";
import { painPointGuidanceLines, parsePainPoints, readPainPointsText } from "../../../admit/painPoint.js";
import { realArtifactPreflightLines } from "../../../admit/realArtifact.js";
import { coreDeliverablePreflightLines } from "../../../admit/requestedDeliverables.js";
import type { ReplySurface } from "../../../admit/withhold.js";
import type { OwnerDirective } from "../../../judgement/ownerDirective.js";
import { bundledLauncherPath, installedTreeRoot } from "../../../lib/pluginRoot.js";
import type { StartedChecklist } from "../../../live/ask/checklist.js";
import type { FirstAnsweredEvent } from "../../../live/ask/lifecycleEvents.js";
import {
  answerFirstBriefLines,
  firstAnswerPostedBriefLines,
  judgementProfileGuidanceLines,
  ownerDirectiveGuidanceLines,
  standingAnswerScopeLines,
} from "../../../live/turn/briefGuidance.js";
import { type FreshDispatchRecord } from "../../../live/turn/dispatch.js";
import type { JudgementProfile } from "../../../live/turn/judgementProfile.js";
import { localSkillGuidanceLines } from "../../../live/turn/localSkillGuidance.js";
import { replyDisclosureLines } from "../../../live/turn/replyDisclosure.js";
import { availableSkills } from "../../../live/turn/skillCatalogue.js";
import { skillRoutingLines } from "../../../live/turn/skillRouting.js";
import { stoodDownLines } from "../../../live/turn/stoodDownGuidance.js";
import { tagDecisionTreeFor } from "../../../live/turn/tagDecisionTreeStore.js";
import { unpromptedHelpLines } from "../../../live/turn/unpromptedGuidance.js";
import { userFacingImpactPreflightLines } from "../../../live/turn/userFacingImpactGuidance.js";
import { visualEvidencePreflightLines } from "../../../live/turn/visualEvidenceGuidance.js";
import { answerFormCapLines } from "../../../outbound/assistant/capGuidance.js";
import { BODY_MAX_BLOCKS } from "../../../outbound/assistant/contentLimits.js";
import { dispatchedWorkerLabel } from "../../../supervisor/session.js";
import { WORKER_REVIEW_WAIT_SECONDS } from "./core.js";
import { ORPHAN_SILENCE_MS, tickerStartCommand } from "./tickerOwner.js";

/**
 * The `GROUNDING:` guidance line — printed next to `DECISION:` so a worker never has to infer which
 * `capability.id` values a `"verb"` grounding may claim. `validateAnswerForDispatch`
 * (`../../../live/turn/briefAnswerable.js`) refuses any other id, and reading the thread FEELS like grounding but is
 * refused every time it is claimed as one: `slack-read-thread` has never been a routable capability on any
 * brief.
 */
function groundingGuidanceLine({ needs }: { needs: FreshDispatchRecord["decision"]["needs"] }): string {
  const allowedIds = needs.length > 0 ? needs.map((need) => need.capabilityId).join(", ") : "none";
  return (
    `GROUNDING: a "verb" grounding's capability.id must be one of this decision's own needs — ${allowedIds}. ` +
    "Reading the thread is investigation, never grounding — it has no capability id and can never satisfy " +
    'this check; ground on the capability whose evidence actually backs the claim, or on "conversation"/' +
    '"unreachable" when that fits better.'
  );
}
/**
 * The steps that keep the thread's card honest while the work happens — the fan-out at step 0c and the two
 * halves of the live progress card, the ticker and the status writes.
 *
 * Split from {@link workerStepLines}'s composing half because a worker failing each has a different
 * consequence: skipping these leaves the people in the thread looking at nothing, which is the
 * incident `./ensureCard.ts` records, while skipping the composing half simply means the turn is not done.
 *
 * @param briefPath the brief file the status verb writes progress against
 * @param card the live progress card this worker drives — it already exists, so nothing here posts one
 * @param channel the ask's channel, so the printed card reference is a pair a reader can open
 * @param home the resolved state home, echoed into every command
 * @param launcher the absolute `bin/slopweaver` path step 0a tells the worker to background, resolved by
 *   the caller so this stays pure
 * @returns the card-keeping lines, in order
 */
function liveProgressStepLines({
  briefPath,
  card,
  channel,
  home,
  launcher,
}: {
  briefPath: string;
  card: StartedChecklist;
  channel: string;
  home: string;
  launcher: string;
}): readonly string[] {
  return [
    // Named rather than left implicit: the worker is about to be told to drive a card, and until it knows
    // there already IS one it cannot tell a refusal from a missing card. The dispatch proved this ts before
    // this session existed — see `./ensureCard.ts`.
    `  Your LIVE PROGRESS CARD is already posted: ${channel}/${card.workingTs} (turn ${card.turnId}). You EDIT it with the steps below and never post a second one.`,
    // MEASURED across two public bot turns: 208 tool calls, ZERO store verbs and ZERO sub-agents between
    // them. The fan-out is rule-level in `skills/loop-bot`: when anyone asks a question the haiku fan-out
    // runs. Nothing a worker READS asked for it, so it never ran, and a secrets turn missed the
    // password-manager share links a probe for "helpbot" + "secret" returns. This is the step that asks.
    `  0c. Fan the wave out BEFORE you read anything else, and spawn every brief it prints (model haiku, in process, never nested): slopweaver store detect "<the question>" --term "<keyword>" --term "<keyword>" --home ${home}`,
    "      N is counted off the probe, never chosen. Skipping it is a choice the answer's could-not-see has to name.",
    // The card is the ONLY thing the people in the thread can see, so the worker touches it itself: the
    // dispatcher's screen-scraping sweep is not the sole live-progress path, and it stops
    // the moment the dispatcher stops believing in this worker. Measured on one real ask
    // (`~/.slopweaver/live/slack/asks.jsonl`) — a false-negative pickup witness wrote `dispatch-failed`, the
    // sweep dropped the ask, and the card read "this turn was abandoned" for 40 minutes while it worked.
    // So this is step 0 and it repeats: the session doing the work says what it is doing.
    // The ticker is step 0a and the stages are 0b, in that order, because the ticker is the half that does
    // not depend on the worker remembering anything. These printed lines name `turn
    // status` AND `turn watch` — the ticker must not live only in the LOOP's own skill docs, or
    // a worker reading its own brief has no way to learn it exists. Measured on one ask:
    // `pgrep -fl "turn watch"` empty across two checks five minutes apart
    // while the owner watched a card that had not moved in ten.
    // The launcher is the RESOLVED absolute path, never the CLAUDE_PLUGIN_ROOT variable — that is
    // substituted by the harness reading a `SKILL.md` and is empty in the worker's own shell, so the
    // literal form left this line running `/bin/slopweaver`, and the trailing `&` hid the failure behind
    // exit 0. Finding 688; `../../../lib/pluginRoot.ts` carries the measurement.
    // The line no longer claims the ticker is a CHILD of this session, because MEASURED it
    // never was: a bare `&` from an agent tool-call shell has ppid 1 by the time the call returns. The
    // ticker reaps itself instead — `./tickerOwner.ts` has the reproduction and the whole finding.
    `  0a. Start the card's clock ONCE, right now, backgrounded with a bare & — never nohup, never setsid, never disown, which buy nothing: ${tickerStartCommand({ briefPath, home, launcher })}`,
    `      It is NOT a child of this session — measured, a backgrounded job is reparented to pid 1 before the call returns — so it reaps itself once you are orphaned AND have gone ${String(Math.round(ORPHAN_SILENCE_MS / 60_000))} minutes with no tool call — never while the turn is blocked on the owner. Nothing for you to stop.`,
    `  0b. Keep the thread's card honest, from now until you post — every few minutes and at every change of activity: slopweaver turn status --brief ${briefPath} --status "<what you are doing right now>" --tier fresh-visible-session --home ${home}`,
  ];
}

/**
 * The numbered steps the worker owns from here to the ask's terminal outcome — split out of
 * {@link freshResumeLines} so each half stays readable, and pure for the same reason it is.
 *
 * Step 1 restates the block cap inline rather than leaving it to the OUTBOUND SIZE CAPS block above: that
 * is the moment the answer is actually written, and a dogfood run measured a composer meeting a
 * cap for the first time as a validate-time refusal — see `../../../outbound/assistant/capGuidance.js`.
 *
 * @param briefPath the brief file the status verb writes progress against
 * @param card the live progress card this worker drives — it already exists, so nothing here posts one
 * @param channel the ask's channel, so the printed card reference is a pair a reader can open
 * @param dispatchId the dispatch this session was resumed for
 * @param home the resolved state home, echoed into every command
 * @param launcher the absolute `bin/slopweaver` path step 0a tells the worker to background, resolved by
 *   the caller so this stays pure
 * @returns the step lines, in order
 */
function workerStepLines({
  briefPath,
  card,
  channel,
  dispatchId,
  home,
  launcher,
}: {
  briefPath: string;
  card: StartedChecklist;
  channel: string;
  dispatchId: string;
  home: string;
  launcher: string;
}): readonly string[] {
  return [
    "You own this ask to its terminal outcome — nobody else posts for you. Investigate as the decision",
    "describes, then, in order:",
    ...liveProgressStepLines({ briefPath, card, channel, home, launcher }),
    `  1. Write the answer JSON at an absolute path — inside the OUTBOUND SIZE CAPS above, body at most ${String(BODY_MAX_BLOCKS)} blocks — and validate it: slopweaver turn resume --dispatch ${dispatchId} --answer <absolute-path> --home ${home}`,
    `  2. Run the BEFORE REVIEW ROUND 1 checks the validate prints, then get it reviewed by an independent reviewer: slopweaver turn review --dispatch ${dispatchId} --answer <absolute-path> --read-through <the newest human ts you read in the thread> --home ${home}`,
    `  3. Wait for the verdict, bounded: slopweaver turn review --dispatch ${dispatchId} --poll --wait --timeout-seconds ${String(WORKER_REVIEW_WAIT_SECONDS)} --home ${home} — ONE call, run in the background; exit 4 means it gave up still working`,
    `  4. Post it yourself through the door: slopweaver turn answer --dispatch ${dispatchId} --verdict <the verdict path --poll printed> --home ${home}`,
    "A verdict of broken, or an unresolved high-impact claim, refuses the send — fix the answer, re-validate, and review again (a new digest needs a new verdict).",
    '  A verdict you COULD post is not something to improve on: re-validating bytes that would discard one is refused until you say why with --edit-reason "<why>", because each rewrite costs another review round and forfeits the verdict that was holding this turn\'s clock. A `low`-impact reviewer note is not a reason.',
    "  A reviewer mid-verdict, a clean verdict bound to the bytes in hand, or a round that has returned while the review is not yet released, all HOLD the lease — so a converging review is never lost to the clock, and you never need to rush a fix past a reviewer.",
    `If you cannot answer at all, say so: slopweaver turn resume --dispatch ${dispatchId} --failed "<why, in one line>" --home ${home} — the loop finalises the thread from that.`,
  ];
}

/**
 * Everything a worker must know BEFORE it composes — which skills own this subject, that a drawn picture is
 * not the real artifact, the outbound caps, the visual-evidence default, and for a user-facing impact ask the
 * customer's own screen first.
 *
 * Split out of {@link freshResumeLines} rather than inlined, and grouped by that one property: each of these
 * costs a whole compose cycle when it is met for the first time as a validate-time or door-time refusal.
 * Measured: two of the first three real questions died exactly that way on the caps alone.
 *
 * @param home the resolved state home, which decides which checkouts the skill catalogue is discovered from
 * @param question the ask's own question text, tags already stripped
 * @returns the lines to print, in order
 */
function composerPreflightLines({ home, question }: { home: string; question: string }): readonly string[] {
  return [
    // A monitor incident's worker brief said nothing at all about skills, and 31 of 43 measured
    // worker turns held none. ALWAYS rendered. See `../../../live/turn/skillRouting.js`.
    ...skillRoutingLines({
      question,
      skills: availableSkills({ home, repoRoot: installedTreeRoot({ importMetaUrl: import.meta.url }) }),
    }),
    // A picture this session DREW is not the deployed thing's own panel; the door refuses an answer that
    // carries neither the real artifact nor a stated reason. See `../../../admit/realArtifact.js`.
    ...realArtifactPreflightLines({ question }),
    // See `../../../outbound/assistant/capGuidance.js` for the two turns that died learning the caps late.
    ...answerFormCapLines(),
    // Measured: 10 answers in one day, 0 carrying an image, 8 of them linking a surface whose
    // whole content is a picture. See `../../../live/turn/visualEvidenceGuidance.js`.
    ...visualEvidencePreflightLines(),
    // Measured: an impact answer led with staff replays and log panels, not the member's own error screen.
    // See `../../../live/turn/userFacingImpactGuidance.js`.
    ...userFacingImpactPreflightLines({ question }),
    ...inventedVisualPreflightLines(),
  ];
}

/**
 * What `turn resume` says to a worker whose brief carries no live progress card.
 *
 * A dispatched worker with no card ts has nothing to drive, and every card verb it is about to be told to run
 * would refuse — which is exactly how a public ask sat card-less for 17 minutes. `turn
 * dispatch` now proves a card BEFORE it hands the brief over (`./ensureCard.ts`), so an absent one HERE means
 * this brief predates that gate or was hand-authored. Both are fixed by the same command, so the refusal
 * names it rather than leaving the worker to infer one.
 *
 * @param briefPath the brief the re-dispatch must be pointed back at
 * @param dispatchId the dispatch this session was resumed for
 * @returns the single refusal line
 */
export function cardlessResumeRefusal({ briefPath, dispatchId }: { briefPath: string; dispatchId: string }): string {
  return (
    `the brief for ${dispatchId} carries no live progress card, so there is nothing for this worker to ` +
    "keep honest and `turn status`/`turn watch` would both refuse. Re-run `slopweaver turn dispatch " +
    `--brief ${briefPath}` +
    " --decision <decision.json>`, which posts one before it hands a brief over."
  );
}

/**
 * Every standing guidance block a dispatched worker is handed, in the order it reads them.
 *
 * Extracted from {@link freshResumeLines} only to keep that function under the line cap — it is one list,
 * and the reasoning for each block lives with the block rather than here.
 */
function standingWorkerGuidance({
  askedBy,
  briefPath,
  dispatchId,
  firstAnswer,
  home,
  ownerDirectives,
  profile,
  question,
  surface,
}: {
  askedBy: string;
  briefPath: string;
  dispatchId: string;
  firstAnswer: FirstAnsweredEvent | undefined;
  home: string;
  ownerDirectives: readonly OwnerDirective[] | undefined;
  profile: JudgementProfile | undefined;
  question: string;
  surface: ReplySurface;
}): readonly string[] {
  return [
    // A dispatched worker is a fresh process that never read `turn brief`'s own stdout, so the one rule that
    // cannot load conditionally has to be printed here too. See `../../../live/turn/briefGuidance.js`.
    ...standingAnswerScopeLines(),
    // The tag decision tree, for the same reason: a worker meets step (d) mid-investigation as often as the
    // routing session meets it up front. Read live, so a tier the owner settled since the brief is the one it sees.
    ...tagDecisionTreeFor({ home, userId: askedBy }),
    // What the reply may SHARE: a worker composes the reply, so it is the session that needs it most.
    ...replyDisclosureLines(),
    // The ORDER a public ask is owed, beside the rule about what may be asked and for the same reason: a
    // worker is a fresh process, and the incident this closes was a worker that answered correctly
    // two hours and thirty-eight minutes late. See `../../../live/turn/briefGuidance.js`. Once that first
    // answer stands, the block that REPLACES it says the next post is the final one.
    ...(firstAnswer === undefined
      ? answerFirstBriefLines({ surface })
      : firstAnswerPostedBriefLines({ dispatchId, firstAnswer })),
    ...judgementProfileGuidanceLines({ briefPath, profile }),
    ...ownerDirectiveGuidanceLines({ briefPath, ownerDirectives }),
    ...painPointGuidanceLines({ entries: parsePainPoints({ text: readPainPointsText({ home }) }) }),
    ...localSkillGuidanceLines({ question }),
    ...composerPreflightLines({ home, question }),
  ];
}

/** What the worker reads ahead of the decision: the question, the thread's witness context, then both pre-flights. */
function openingLines({
  askedBy,
  ownerUserId,
  question,
  stoodDown,
  surface,
  unprompted,
}: {
  askedBy: string;
  ownerUserId: string | undefined;
  question: string;
  stoodDown: boolean;
  surface: ReplySurface;
  unprompted: boolean;
}): readonly string[] {
  return [
    `QUESTION: ${question}`,
    ...unpromptedHelpLines({ unprompted }),
    ...stoodDownLines({ stoodDown }),
    ...coreDeliverablePreflightLines({ question }),
    ...askerTagPreflightLines({ askedBy, ownerUserId, surface }),
  ];
}

/**
 * The exact lines the `--dispatch <id>` LOAD mode prints — pure, so the shape a fresh session actually reads
 * is directly testable without a filesystem. `ASK PERMALINK` is scenario 3's durable thread pointer: the
 * fresh session's own instruction to read it live, never a pre-fetched thread baked into the record. The
 * judgement-profile and pain-point guidance mirrors `/slopweaver:loop`'s own composition guidance, so the
 * voice contract survives the hand-off into a fresh workspace rather than only applying in the loop's own
 * session. The core-deliverable pre-flight comes FIRST, directly under the question
 * (`../../../admit/requestedDeliverables.js`): a worker that reads its scope discipline after the decision
 * has already picked up whatever the decision implied, and the failure that module records was a
 * worker widening its own scope before it had delivered the ask's own artifact. The asker-tag pre-flight
 * (`../../../admit/askerTagGate.js`) rides directly under it, for the same reason and against a measured
 * failure of the same shape: the door refuses an untagged answer, and learning that at the door costs a
 * whole review cycle because a new digest needs a new verdict. The local-skill guidance (see `../../../live/turn/localSkillGuidance.js`) is what actually fixes
 * the gap: it names a repo-local skill's owning path here, in the brief the child reads before its
 * first `gh`/branch action, rather than relying on the child to independently recall it exists.
 *
 * @param askedBy the Slack user id that raised this ask — who the answer owes a tag
 * @param briefPath the brief file this fresh session should read `routingInput.profile` from
 * @param dispatchId the dispatch this session was resumed for
 * @param firstAnswer the first answer this ask's dispatch already posted, when one stands — the plan the
 *   worker must not post again
 * @param home the resolved state home, echoed back into the finish-command instruction
 * @param profile the brief's private judgement/voice profile, when one was loaded
 * @param ownerDirectives the explicit current owner rulings frozen into the brief
 * @param ownerUserId this session's own owner, or `undefined` when `profile.json` declares none
 * @param question the brief's own question text
 * @param record the durable dispatch record this session was dispatched from
 * @param surface where this reply will land, which decides whether a tag is owed at all
 * @param unprompted whether `witness help` opened this ask rather than a tag
 * @param stoodDown whether somebody in the ask's thread stood the bot down earlier
 * @returns the lines to print, in order
 */
export function freshResumeLines({
  askedBy,
  briefPath,
  card,
  dispatchId,
  firstAnswer,
  home,
  ownerDirectives,
  ownerUserId,
  profile,
  question,
  record,
  stoodDown = false,
  surface,
  unprompted = false,
}: {
  askedBy: string;
  briefPath: string;
  card: StartedChecklist;
  dispatchId: string;
  firstAnswer?: FirstAnsweredEvent | undefined;
  home: string;
  ownerDirectives: readonly OwnerDirective[] | undefined;
  ownerUserId: string | undefined;
  profile: JudgementProfile | undefined;
  question: string;
  record: FreshDispatchRecord;
  stoodDown?: boolean;
  surface: ReplySurface;
  unprompted?: boolean;
}): readonly string[] {
  return [
    ...openingLines({ askedBy, ownerUserId, question, stoodDown, surface, unprompted }),
    `DECISION: ${JSON.stringify(record.decision, null, 2)}`,
    groundingGuidanceLine({ needs: record.decision.needs }),
    ...standingWorkerGuidance({
      askedBy,
      briefPath,
      dispatchId,
      firstAnswer,
      home,
      ownerDirectives,
      profile,
      question,
      surface,
    }),
    provenanceLine({ record }),
    `ASK PERMALINK: ${record.askPermalink}`,
    `Read the live thread first (this is investigation, never grounding): slopweaver slack read-thread ${record.askPermalink} --json`,
    ...workerStepLines({
      briefPath,
      card,
      channel: record.channel,
      dispatchId,
      home,
      launcher: bundledLauncherPath({ importMetaUrl: import.meta.url }),
    }),
  ];
}

/**
 * The exact provenance label the worker's answer must carry. The door checks `grounding.provenance.model`
 * against the label CODE derives from this dispatch record, so the worker is told the exact string rather than
 * left to copy one out of a skill doc that cannot know which workspace it is in. A mismatch is caught at `turn
 * answer` — after the review has already bound a digest to the old bytes — so paying for it there is one whole
 * review cycle.
 */
function provenanceLine({ record }: { record: FreshDispatchRecord }): string {
  return `PROVENANCE: your answer's grounding.provenance.model must read exactly "${dispatchedWorkerLabel({ host: record.session.host, workspaceRef: record.session.workspaceRef })}"`;
}

/**
 * What `turn resume` says to a worker whose ask, or whose whole conversation, was permanently ignored while
 * it was running.
 *
 * Both arms name the dispatch rather than the ask, because that is the token the worker holds and the only
 * one it can check — and both say STOP rather than describing a state, since a session reading this has a
 * brief in front of it telling it to keep going.
 *
 * @param dispatchId the dispatch this session was resumed for
 * @param kind which entrance the ignore was recorded against
 * @returns the single refusal line
 */
export function ignoredResumeRefusal({
  dispatchId,
  kind,
}: {
  dispatchId: string;
  kind: "ask" | "conversation";
}): string {
  if (kind === "ask") {
    return `this exact ask is now permanently ignored — stop investigating ${dispatchId}`;
  }
  return `this conversation is now permanently ignored — stop investigating ${dispatchId}`;
}
