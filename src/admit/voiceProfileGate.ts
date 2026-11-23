/**
 * The gate that makes the door see a VOICE finding — on both lanes, for the first time.
 *
 * ## What was actually broken
 *
 * `admitDoor` had never once seen one. The as-me lane checked the operator's exact rules in the CLI shell
 * BEFORE `throughDoor` and exited `EXIT_USAGE`, so the decision was made and the ledger never heard about it;
 * the as-bot lane had no voice check at all — `gatesFor`, `dripGatesFor`, `lifecycleRunShared`'s `gatesFor`
 * and `answerGates` all carried none. That is the whole reason about one in a hundred of the owner's own sent
 * Slack messages carry an em-dash despite a hard rule: nearly all of them are agent-authored posts sent under the owner's account,
 * on paths nothing was checking.
 *
 * ## Why every finding is a `warn` and none is a `hold`
 *
 * **The rule**: no hard blocks for voice. Every voice rule — the literal bans, the
 * em-dash, and the profile checks alike — uses the door's fail-loudly-then-escape-hatch shape: the send fails
 * with the finding NAMED, and the session either rewrites it or overrides with a stated reason. Both ends of
 * that are deliberate. A hard block was tried and abandoned, and pure advisory markdown is ignored about half
 * the time; the middle ground is a nudge rather than a force — make a session LOOK at the finding and say
 * it looked. The door already had exactly that shape, and the voice lane was not using
 * it. Overrides are recorded either way, so a released violation is in the audit trail rather than invisible.
 *
 * ## The prose arrives by CLOSURE, never on the request
 *
 * `../admit/ledger.ts` records every finding's `summary` in the door ledger (`door_event`, through
 * `./doorLedgerPort.ts`). So putting the message text on `DoorRequest` — or quoting the
 * matched text into a summary — would turn the door ledger into a copy of every message the install has ever
 * sent, which is the one thing both that file and `./painPoint.ts` state they will not do. The caller, which
 * knows its own artifact shape, extracts the prose and hands it in; the request carries only `actor`, and a
 * finding names the field PATH and the rule that fired.
 */
import {
  type AuthoredProse,
  type ExactVoiceRule,
  type ExactVoiceRuleFinding,
  exactVoiceRuleFindings,
  rulesForActor,
  type VoiceActor,
  voiceRuleLabel,
} from "../outbound/voice/exactRules.js";
import type { DoorFinding, DoorGate, DoorRequest } from "./types.js";

/** The override token that waives a voice finding, recorded by the door whenever it is used. */
export const VOICE_PROFILE_OVERRIDE = "voice.profile:v1";

/**
 * The artifact field every Slack lane states its lane in, and the one thing this gate reads off the request.
 *
 * Deliberately not exported: every producer writes `actor:` as a literal key in its own request object, so
 * exporting this would offer a shared name nothing can actually use as a key. It is here so the refusal's
 * correction and the reader below cannot disagree about which field that is.
 */
const VOICE_ACTOR_ARTIFACT_FIELD = "actor";

/**
 * Everything the gate needs from a caller, as ONE value.
 *
 * Extracted rather than inlined because four gate lists and a dozen call sites pass it — it is a real
 * contract in `.claude/rules/typescript-patterns.md`'s sense, and a lane adding a field later is one edit
 * here instead of four signatures that can disagree.
 */
export interface VoiceGateInput {
  /** Whether the caller's named `voice-rules` hatch is open for this invocation. */
  readonly allowVoiceRules: boolean;
  /** The authored prose regions the caller extracted from its own artifact. */
  readonly prose: readonly AuthoredProse[];
  /** The operator's whole private exact-rule list, before the actor split. */
  readonly rules: readonly ExactVoiceRule[];
}

/**
 * The input for a send that AUTHORS NOTHING — a delete, a progress tick, a spinner edit.
 *
 * Named rather than spelled as three empty literals at each site, so that "this lane has no words in it" is
 * a claim a reader can see and a reviewer can argue with, instead of looking like a lane somebody forgot.
 */
export const NO_AUTHORED_PROSE: VoiceGateInput = { allowVoiceRules: false, prose: [], rules: [] };

/**
 * Which lane this request is on, read off the door request itself.
 *
 * An unrecognised or absent value is `undefined` rather than a defaulted `"bot"`, and the gate then raises
 * its own finding instead of passing. A default here is how a lane that forgets the field becomes silently
 * unchecked, which is the defect this whole module exists to close, one level down.
 */
function actorOf({ request }: { request: DoorRequest }): VoiceActor | undefined {
  const actor = request.artifact[VOICE_ACTOR_ARTIFACT_FIELD];
  if (actor === "me" || actor === "bot") {
    return actor;
  }
  return undefined;
}

/**
 * Every finding this module can produce, narrowed to the door's `warn` arm.
 *
 * Named rather than left as `DoorFinding` because NO voice rule hard
 * blocks, and the arm carrying `override` is how a type says that: a `hold` added here would not compile.
 */
type VoiceWarn = Extract<DoorFinding, { readonly severity: "warn" }>;

/** Build one `warn` — every voice refusal is self-correctable by construction. */
function warn({ code, summary, correction }: { code: string; summary: string; correction: string }): VoiceWarn {
  return { code, correction, override: VOICE_PROFILE_OVERRIDE, severity: "warn", summary };
}

/**
 * Every voice finding this send carries, as door findings.
 *
 * Returned as a LIST rather than the first failure, for `./answerQualityGate.ts`'s reason: a composer that
 * learns about the next problem only after another round trip is the loop the typed forms here exist to
 * avoid.
 *
 * @param actor which name this send goes out under, or `undefined` when the request did not state one
 * @param prose the authored prose regions the caller extracted from its own artifact
 * @param rules the operator's whole private exact-rule list, before the actor split
 * @returns one finding per matching rule and prose region; empty when the send is in voice
 */
export function voiceProfileFindings({
  actor,
  prose,
  rules,
}: {
  actor: VoiceActor | undefined;
  prose: readonly AuthoredProse[];
  rules: readonly ExactVoiceRule[];
}): readonly VoiceWarn[] {
  // Two absences, and neither is a lane escaping the check. No RULES is an install that has configured no
  // vocabulary at all, which `../outbound/proposal/lint/voice.ts` already treats as "not gated on
  // vocabulary" rather than as a failure. No PROSE is a send with nothing authored in it — a delete, a
  // progress tick, a spinner edit — and there is no voice question to ask about one. Both are checked
  // BEFORE the actor, because an unstated lane only matters when there is something to judge on it.
  if (rules.length === 0 || prose.length === 0) {
    return [];
  }
  if (actor === undefined) {
    return [
      warn({
        code: "VOICE_ACTOR_UNSTATED",
        correction: `state the lane on the door request's \`${VOICE_ACTOR_ARTIFACT_FIELD}\` artifact field as "me" or "bot"`,
        summary: "this send does not say which name it goes out under, so no voice profile could be applied",
      }),
    ];
  }
  return exactVoiceRuleFindings({ prose, rules: rulesForActor({ actor, rules }) }).map((finding) =>
    warn({
      code: "VOICE_RULE_BROKEN",
      correction: "rewrite the authored prose, or send it unchanged past the override token with a stated reason",
      summary: `${finding.path} ${voiceRuleLabel({ rule: finding.rule })} for the ${actor} lane`,
    }),
  );
}

/**
 * The voice gate for one send.
 *
 * ## Two overrides, and neither replaces the other
 *
 * `SLOPWEAVER_DOOR_OVERRIDE=voice.profile:v1` is the door's own, and it is the one to reach for: the door
 * RECORDS every warn it waives, so a released violation lands in the door ledger rather than vanishing.
 * The `voice-rules` hatch (`../hatch/registry.ts`'s journalled row) is honoured through `allowVoiceRules`
 * too: it is the grant every other voice refusal names, so a session holding it is not refused again here.
 * Nothing is lost when it fires — the grant journal names the session and its reason, and the caller records
 * a pain point for every finding either way, which is that lane's audit trail.
 *
 * It arrives as an ALREADY-RESOLVED boolean rather than being read here, so a caller may only ever ADD to
 * the hatch. A hatch read written as a parameter default is what `hatch-release` refuses tree-wide.
 *
 * @param allowVoiceRules whether the caller's named `voice-rules` hatch is open for this invocation
 * @param prose the authored prose regions the caller extracted from its own artifact
 * @param rules the operator's whole private exact-rule list
 * @returns the gate, which raises one `warn` per broken rule
 */
export function voiceProfileGate({ allowVoiceRules, prose, rules }: VoiceGateInput): DoorGate {
  return (request) => {
    if (allowVoiceRules) {
      return [];
    }
    return voiceProfileFindings({ actor: actorOf({ request }), prose, rules });
  };
}

/**
 * What one lane needs to both RECORD and GATE a send's voice, computed once.
 *
 * Two consumers of the same match, and they are deliberately not the same value. `findings` carries the
 * rule objects, which is what `./painPoint.ts`'s `recordExactVoicePainPoints` writes into
 * `ledgers/pain-points.jsonl` so a later turn's composing brief can learn from them — and it is written even when the send is admitted,
 * because the ledger records composition friction rather than refusals. `gate` is what the door reads, and
 * it carries the WHOLE rule list rather than the actor's slice: the gate applies the split itself, off the
 * actor on the request, so a caller cannot hand it one lane's rules and a different lane's request.
 */
export interface VoiceLaneInput {
  readonly gate: VoiceGateInput;
  readonly findings: readonly ExactVoiceRuleFinding[];
}

/**
 * Build both halves for one send. Pure — the hatch is resolved by the shell and passed in, per
 * `hatch-release`.
 *
 * @param actor which name this send goes out under
 * @param allowVoiceRules whether the caller's named `voice-rules` hatch is open for this invocation
 * @param prose the authored prose regions the caller extracted from its own artifact
 * @param rules the operator's whole private exact-rule list, before the actor split
 * @returns the ledger's findings and the door's gate input
 */
export function voiceInputFor({
  actor,
  allowVoiceRules,
  prose,
  rules,
}: {
  actor: VoiceActor;
  allowVoiceRules: boolean;
  prose: readonly AuthoredProse[];
  rules: readonly ExactVoiceRule[];
}): VoiceLaneInput {
  return {
    findings: exactVoiceRuleFindings({ prose, rules: rulesForActor({ actor, rules }) }),
    gate: { allowVoiceRules, prose, rules },
  };
}
