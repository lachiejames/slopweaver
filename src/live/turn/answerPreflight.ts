/**
 * THE DETERMINISTIC ANSWER GATES, in one list, so the same checks run BEFORE a reviewer is spawned and again
 * at the door — rather than only at the door, twenty minutes of verification later.
 *
 * ## The measured failure this exists for
 *
 * Measured over one week of real bot turns. One ask ran FIVE review rounds, converged,
 * and then died at the door on `ANSWER_DOES_NOT_TAG_ASKER` — "this answer is for <the asker> and mentions
 * them nowhere, so posting it notifies nobody". Nothing about the answer was wrong; it was missing one
 * mention run, and that is decidable from the answer's own bytes before any reviewer exists. It was not
 * alone: over the same week seven door refusals fired only after review had passed — four unresolvable
 * mentions on one ask, two over-cap bodies, and that asker tag. Reproduce the class over any live home with:
 *
 * ```
 * jq -r 'select(.kind=="failed") | .reason' "$SLOPWEAVER_HOME/live/slack/asks.jsonl" | sort | uniq -c | sort -rn
 * ```
 *
 * The owner's instruction was to stop catching these late rather than to catch them better: "doing well is
 * basically just the absence of a fuckup over an extended period of time".
 *
 * ## One list, two call sites, and why the door keeps every check
 *
 * The pre-flight is the SAME gate list the door runs, not a cheaper copy of it. A second implementation
 * would drift, and the drift would be silent in exactly the direction that matters — a pre-flight that
 * passes something the door later refuses is the failure being fixed, running twice. So
 * {@link deterministicAnswerGates} is the one definition and both callers compose it.
 *
 * The door still runs all of them afterwards. The pre-flight is an early exit, never a substitute: the
 * answer can change between the two points (that is what a review round is FOR), so a check that passed at
 * spawn says nothing about the bytes that finally post.
 *
 * ## What is deliberately NOT here
 *
 * `answerQualityGate` cannot be: it reads the verdict, and at pre-flight time there is no verdict — that is
 * the whole point of the moment. `withholdGate` reads a judgement the review path does not have. Both stay
 * door-only, and that asymmetry is the reason this list is named rather than the door's list being reused
 * wholesale.
 *
 * ## The VOICE gate is here, and that is the deadlock it closes
 *
 * MEASURED on `C0SYN000001/1790048248.995219`: seven review rounds, seven reviewer workspaces,
 * three discarded clean verdicts, an ask unposted for over an hour — and the round-7 diff was one adjective,
 * `genuinely expired` to `properly expired`. The reviewer's packet names the MINED voice principles (four of
 * them, `../../cli/commands/turn/reviewPacket.ts`); the door enforced the operator's EXACT rule list out of
 * `profile.json` (twenty-six), and nothing ran that list until send time.
 *
 * That is a deadlock rather than an inconvenience. `turn review` binds a verdict to the exact bytes reviewed,
 * `turn answer` refuses a send without a live verdict for those bytes, and the door refused those same bytes
 * — so fixing the prose voided the verdict, and posting needed a live one. There was no move that satisfied
 * both, and every voice-rule hit cost a whole reviewer round.
 *
 * Running the same gate HERE breaks it, and it is the cheaper half of the fix rather than a second opinion:
 * the prose is corrected while a rewrite is still free, BEFORE any verdict exists to void. The hatch
 * (`../../hatch/registry.ts`'s `voice-rules` row) is deliberately not the answer — overriding the owner's configured
 * voice to save a review round is the wrong trade, and the gap was never that an agent had no option.
 *
 * ## The one member whose input is not the answer's own bytes
 *
 * `../../admit/declinedAtlasGate.ts` asks whether a blind spot declines an atlas this install can actually
 * read, which the bytes alone cannot say. It stays here rather than going door-only because it is as
 * decidable at spawn as any of the others — the atlases are on disk, not at a provider — and the grading is
 * done by the CALLER (`./declinedAtlasReadings.ts`) so this list itself performs no I/O. That is also why
 * both call sites are async: a `DoorGate` is synchronous, so the read happens before the list is built.
 */
import { askerTagGate } from "../../admit/askerTagGate.js";
import { coreDeliverableGate } from "../../admit/coreDeliverableGate.js";
import { datadogCitationGate } from "../../admit/datadogCitationGate.js";
import { type DeclinedAtlasReading, declinedAtlasGate } from "../../admit/declinedAtlasGate.js";
import { documentDeliverableGate } from "../../admit/documentDeliverableGate.js";
import { admitDoor } from "../../admit/door.js";
import { doorRefusalLines } from "../../admit/doorRefusal.js";
import { inventedVisualGate } from "../../admit/inventedVisualGate.js";
import { answerVisuals } from "../../admit/inventedVisualSeams.js";
import { realArtifactGate } from "../../admit/realArtifactGate.js";
import { skillLoadGate } from "../../admit/skillLoadGate.js";
import type { DoorDecision, DoorGate, DoorRequest } from "../../admit/types.js";
import {
  type VoiceGateInput,
  type VoiceLaneInput,
  voiceInputFor,
  voiceProfileGate,
} from "../../admit/voiceProfileGate.js";
import type { ReplySurface } from "../../admit/withhold.js";
import { installedTreeRoot } from "../../lib/pluginRoot.js";
import type { Result } from "../../lib/result.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import type { ResolvedMentions } from "../../outbound/slack/render.js";
import { answerProse } from "../../outbound/voice/artifactProse.js";
import { ownerUserIdFromProfile, type ProfileReadError, readExactVoiceRules } from "../../profileStore.js";
import type { IdentityRosterPort } from "../../silver/identityRoster.js";
import { resolveAnswerMentions } from "./answerMentions.js";
import type { TurnRoutingBrief } from "./brief.js";
import { declinedAtlasReadings } from "./declinedAtlasReadings.js";
import { availableSkills } from "./skillCatalogue.js";
import type { CatalogueSkill } from "./skillRouting.js";
import { turnErrorLines } from "./turnErrors.js";

/** Everything the deterministic gates read. Exactly the door's own inputs, minus the verdict and judgement. */
interface AnswerPreflightInput {
  readonly answer: AnswerFormAnswer;
  readonly askedBy: string;
  readonly atlasReadings: readonly DeclinedAtlasReading[];
  readonly mentions: ResolvedMentions;
  readonly ownerUserId: string | undefined;
  readonly question: string;
  readonly skills: readonly CatalogueSkill[];
  readonly surface: ReplySurface;
  /** The operator's exact rules and the answer's authored prose, both read by the caller — see the header. */
  readonly voice: VoiceGateInput;
}

/**
 * The bot-lane voice input for one composed answer, read off disk once.
 *
 * Built here rather than at each call site so the pre-flight and the door cannot disagree about which rules
 * apply to which prose — the disagreement this module's header measures is exactly that, one level up. The
 * hatch is `false` for the same reason `../../live/turn/posterAnswer.ts` states: a turn has no invocation to
 * open the named one on, and the door's own `voice.profile:v1` token is this lane's override.
 *
 * A profile that is there but corrupt is the failure, never "no rules": read that way, every answer's voice
 * check passed on nothing.
 *
 * @param answer the composed answer whose authored regions are judged
 * @param home the resolved state home holding `profile.json`
 * @returns the gate input and the findings the caller records as composition friction, or why the rules
 *   could not be read
 */
export function answerVoiceInput({
  answer,
  home,
}: {
  answer: AnswerFormAnswer;
  home: string;
}): Result<VoiceLaneInput, ProfileReadError> {
  return readExactVoiceRules({ home }).map((rules) =>
    voiceInputFor({ actor: "bot", allowVoiceRules: false, prose: answerProse({ answer }), rules }),
  );
}

/**
 * The gates decidable from the answer's own bytes plus the ask it answers — the ones that need no verdict.
 *
 * Ordered as the door orders them, so a caller printing findings prints them in the order a reader of the
 * door's own output would already know.
 *
 * @param answer the composed answer
 * @param askedBy the Slack user id of whoever asked
 * @param atlasReadings one grading per atlas the answer's blind spots named, graded by the caller — the
 *   only input here that is not decidable from the bytes alone, and it is read from disk rather than a
 *   provider
 * @param mentions the resolved mention map, so the asker-tag gate can tell an unaddressable person from an
 *   untagged one
 * @param ownerUserId the owner's own id, exempt from the tag duty in their own thread
 * @param question the ask's text, which decides what was requested
 * @param skills the catalogue the skill-load gate checks provenance against
 * @param surface where the reply goes — a DM notifies its only reader without a tag
 * @param voice the operator's exact rules and this answer's authored prose, both read by the caller
 * @returns the gate list, ready for `admitDoor`
 */
export function deterministicAnswerGates({
  answer,
  askedBy,
  atlasReadings,
  mentions,
  ownerUserId,
  question,
  skills,
  surface,
  voice,
}: AnswerPreflightInput): readonly DoorGate[] {
  return [
    // FIRST, because it is the one member decidable with no reference to the ask at all and the one whose
    // late firing was measured costing whole reviewer rounds — see this module's header. The gate reads the
    // lane off the request's own `actor` field, so a caller that forgets to state it is refused rather than
    // silently unchecked (`../../admit/voiceProfileGate.ts`).
    voiceProfileGate(voice),
    coreDeliverableGate({ answer, question }),
    // Beside the core-deliverable gate rather than inside it, and the two questions are genuinely
    // different: that one asks whether the answer hands back the artifact its question asked for, this one
    // asks whether what it hands back is OPENABLE by the room it lands in. An answer can satisfy the first
    // and fail the second — the four-ISO-docs turn did exactly that.
    documentDeliverableGate({ answer, surface }),
    realArtifactGate({ answer, question }),
    inventedVisualGate({ visuals: answerVisuals({ answer }) }),
    // Beside the invented-visual gate, and asking the complementary question about the evidence an answer
    // links rather than attaches: that one asks whether an attached picture is real, this one asks whether a
    // cited link opens on the window and scope the claim was computed over. Review verdicts classify claims
    // and never citations, because a reviewer re-derives every number through the API and nobody clicks the
    // links.
    datadogCitationGate({ answer }),
    skillLoadGate({ answer, question, skills }),
    // The only gate here whose input is not the answer's own bytes: it needs to know what this install's
    // atlases actually hold, which is on disk rather than in the form. The grading is the CALLER's, so this
    // list stays pure — see `../../admit/declinedAtlasGate.ts` for why the roster arrives as data.
    declinedAtlasGate({ answer, readings: atlasReadings }),
    // The PEOPLE half alone: this gate asks whether a named human was tagged, and a user group answers a
    // different question — tagging @engineers does not discharge a duty owed to the person who asked.
    askerTagGate({ answer, askedBy, mentions: mentions.people, ownerUserId, surface }),
  ];
}

/**
 * Run those gates over a composed answer before a reviewer is opened.
 *
 * `env` is injected rather than read so the same override token that waives a finding at the door waives it
 * here — a pre-flight a person cannot get past would be a deadlock the door itself does not have.
 *
 * @param env the environment, read only for `SLOPWEAVER_DOOR_OVERRIDE`
 * @param input everything the gates read
 * @param request the door request the gates are handed — the same shape the send path builds
 * @returns the door's own decision: `pass`, `warn` or `hold`, with the findings behind it
 */
function answerPreflightDecision({
  env,
  input,
  request,
}: {
  env: Readonly<Record<string, string | undefined>>;
  input: AnswerPreflightInput;
  request: DoorRequest;
}): DoorDecision {
  return admitDoor({ env, gates: deterministicAnswerGates(input), request });
}

/**
 * Run the deterministic gates over a composed answer BEFORE a reviewer is opened, and say what blocks it.
 *
 * MEASURED over one week: one ask ran five review rounds and then died at the door on
 * `ANSWER_DOES_NOT_TAG_ASKER`, a property of the answer's own bytes the whole time. Refusing here costs a
 * session one re-compose; letting it through cost five reviewer workspaces and about a hundred minutes.
 *
 * The resolve is done here too, because an unaddressable mention was four of the same week's seven late
 * refusals and is decidable from the same bytes.
 *
 * @param answer the composed answer, already parsed and grounding-checked
 * @param brief the ask's own brief — who asked, what they asked, and on which surface
 * @param home the resolved state home, holding the owner's profile and the skill catalogue
 * @param identityRoster the door the store's identity roster is read through, for the mention resolve
 * @returns the refusal lines to print, or an empty array when nothing blocks the spawn
 */
export async function preflightRefusal({
  answer,
  brief,
  home,
  identityRoster,
}: {
  answer: AnswerFormAnswer;
  brief: TurnRoutingBrief;
  home: string;
  identityRoster: IdentityRosterPort;
}): Promise<readonly string[]> {
  const voice = answerVoiceInput({ answer, home });
  if (voice.isErr()) {
    return ["the answer would be refused at the door, so no reviewer was opened:", `refused: ${voice.error.message}`];
  }
  const mentions = await resolveAnswerMentions({ answer, askedAtIso: new Date().toISOString(), home, identityRoster });
  if (mentions.isErr()) {
    return [
      "the answer would be refused at the door, so no reviewer was opened:",
      ...turnErrorLines({ error: mentions.error }),
    ];
  }
  const decision = answerPreflightDecision({
    env: process.env,
    input: {
      answer,
      askedBy: brief.userId,
      atlasReadings: await declinedAtlasReadings({ answer, home }),
      mentions: mentions.value,
      ownerUserId: ownerUserIdFromProfile({ home }) ?? undefined,
      question: brief.question,
      skills: availableSkills({ home, repoRoot: installedTreeRoot({ importMetaUrl: import.meta.url }) }),
      surface: brief.surface,
      voice: voice.value.gate,
    },
    request: {
      action: { kind: "verb", noun: "turn", verb: "review" },
      // The LANE, not an empty bag: `../../admit/voiceProfileGate.ts` reads which name a send goes out under
      // off this field and refuses the request outright when it is absent. An answer is always the bot's.
      artifact: { actor: "bot" },
      meta: { createsWorkItem: false, effect: "local-state", home, requiresApproval: false },
    },
  });
  if (decision.status === "pass") {
    return [];
  }
  return [
    "the answer would be refused at the door, so no reviewer was opened — fix it and re-run `turn review`:",
    ...doorRefusalLines({ command: "posting this turn's answer", decision }),
  ];
}
