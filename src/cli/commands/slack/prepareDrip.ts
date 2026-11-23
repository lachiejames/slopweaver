/**
 * Everything an as-me send does BEFORE it can post: read the words, validate the form against the
 * operator's bounds and voice rules, linkify bare references, resolve every mention, and build the plan
 * through the checks `./wallCheck.ts` can decide without a send edge.
 *
 * Extracted from `./run.ts`'s `runSlackDrip` because two callers need exactly this and only one of them may
 * send: the ordinary `slack post --as me` lane, which follows it with `./dripSendPlan.ts`, and the draft
 * recorder (`./draftRun.ts`), which follows it with a filesystem append. The dependency bag here carries no
 * seam that posts and no module imported here holds one, so "recording cannot post" is answered twice over
 * — by the type and by the import graph.
 *
 * Nothing here reads a clock beyond the hatch reads it shares with the send lane, and nothing writes
 * anything except the voice pain-point record, which is an observation and never decides a send.
 */
import { hatchOpen } from "../../../hatch/open.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { linkifyDripArtifact } from "../../../outbound/artifact/bareRefRuns.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { slackDeliveryErrorLines } from "../../../outbound/slack/deliveryErrors.js";
import { addressableMembers, dmNonMemberRefusal } from "../../../outbound/slack/dmMembership.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";
import { type ExactVoiceRuleFinding, VOICE_RULES_HATCH } from "../../../outbound/voice/exactRules.js";
import { bareRefVerdictFor } from "../../bareRefDoor.js";
import type { DripSource, SlackDripOptions } from "./coreTypes.js";
import { STDIN_SENTINEL } from "./coreTypes.js";
import { resolvedTagRefusals } from "./departedTagCheck.js";
import type { SlackDripPlan } from "./dripCore.js";
import { dripMentionedPeople, resolveDripMentions } from "./dripMentions.js";
import { assessSlackDripSource } from "./dripSourceAssessment.js";
import type { SlackWriteDeps } from "./run.js";
import { type DripReadDeps, planDripChecked } from "./wallCheck.js";
import type { DripConfig } from "./wiring.js";

/**
 * The reads a preparation pass performs, and — as with {@link DripReadDeps} — the point is what is absent.
 *
 * `SlackWriteDeps` satisfies it structurally, so the send lane hands its own bag straight through and no
 * production wiring changed. A holder of THIS type cannot reach `proveRender`, `makeApi` or `readMedia`:
 * there is no way to put bytes into Slack, and no way to open a file the caller named.
 */
export interface DripPrepareDeps extends DripReadDeps {
  readonly readStdin: SlackWriteDeps["readStdin"];
  readonly bareRefContext: SlackWriteDeps["bareRefContext"];
  readonly resolveMentions: SlackWriteDeps["resolveMentions"];
  readonly conversationMembership: SlackWriteDeps["conversationMembership"];
  readonly taggedAccount: SlackWriteDeps["taggedAccount"];
  readonly promptChannel: SlackWriteDeps["promptChannel"];
  readonly recordVoicePainPoints: SlackWriteDeps["recordVoicePainPoints"];
}

/** A send that has passed every check decidable without the ability to post, and what those checks read. */
export interface PreparedDrip {
  readonly plan: SlackDripPlan;
  readonly resolution: MentionResolution;
  /** Voice findings that did not refuse — printed above a dry run, and recorded on a parked draft. */
  readonly advisory: readonly string[];
  readonly config: DripConfig;
  /** Whether the exact voice rules were lifted for this invocation, which the door gate needs verbatim. */
  readonly allowVoiceRules: boolean;
  /** Every exact `me`-lane rule the words break, hatch or not — the recorder refuses on these (`./draftRecordMessage.ts`). */
  readonly voiceRuleFindings: readonly ExactVoiceRuleFinding[];
  /** The words as READ — a `-` sentinel already replaced by the stdin bytes — which a parked draft records. */
  readonly source: DripSource;
}

/**
 * Run the whole pre-send preparation for one as-me send.
 *
 * The caller reads `config` before stdin or Slack, because a corrupt profile is a fact failure that exits 1
 * with its own sentence, where every refusal returned here is the caller's input and exits 2.
 *
 * @param deps the injected reads, deliberately carrying no send edge
 * @param config the operator's bounds and voice rules, already read from a profile that could be trusted
 * @param env the environment every hatch and gate in the pass reads its override token from
 * @param options the parsed invocation
 * @param token the token this send would use — read-only here, and the identity the gates measure against
 * @returns the prepared send, or every refusal the first failing step produced
 */
export async function prepareDrip({
  deps,
  config,
  env,
  options,
  token,
}: {
  deps: DripPrepareDeps;
  config: DripConfig;
  env: Readonly<Record<string, string | undefined>>;
  options: SlackDripOptions;
  token: string;
}): Promise<Result<PreparedDrip>> {
  const source = await readDripSource({ deps, source: options.source });
  const allowVoiceRules = hatchOpen({ env, home: options.home, id: "voice-rules", nowIso: new Date().toISOString() });
  const assessed = assessSlackDripSource({ allowVoiceRules, config, source });
  if (assessed.voiceRuleFindings.length > 0) {
    deps.recordVoicePainPoints({ findings: assessed.voiceRuleFindings, home: options.home, lane: "as-me" });
  }
  const artifact = assessed.parsed;
  if (artifact.isErr()) {
    return err(slackDeliveryErrorLines({ error: artifact.error }));
  }
  if (allowVoiceRules && config.exactVoiceRules.length > 0) {
    logger.warn({ msg: `${VOICE_RULES_HATCH} grant: exact voice rules are overridden for this send` });
  }
  const linkified = linkifiedArtifact({ artifact: artifact.value, deps, env, home: options.home });
  if (linkified.isErr()) {
    return err(linkified.error);
  }
  const resolution = await resolveInConversation({ artifact: linkified.value, deps, options, token });
  if (resolution.isErr()) {
    return err(resolution.error);
  }
  const planned = await planDripChecked({
    artifact: linkified.value,
    config,
    deps,
    env,
    options,
    resolution: resolution.value,
    token,
  });
  if (planned.isErr()) {
    return err(planned.error);
  }
  return ok({
    advisory: assessed.advisory,
    allowVoiceRules,
    config,
    plan: planned.value,
    resolution: resolution.value,
    source,
    voiceRuleFindings: assessed.voiceRuleFindings,
  });
}

/**
 * Resolve every bare reference into a real link, then refuse whatever still cannot resolve — the rule the bot-card
 * lane and `slack edit --as me` enforce too (`../../bareRefDoor.ts`).
 *
 * @param artifact the parsed form
 * @param deps the injected reads, for the bare-reference context
 * @param env the environment the refusal's override token is read from
 * @param home the install whose context resolves the references
 * @returns the linkified form, or every refusal
 */
function linkifiedArtifact({
  artifact,
  deps,
  env,
  home,
}: {
  artifact: Parameters<typeof linkifyDripArtifact>[0]["artifact"];
  deps: Pick<DripPrepareDeps, "bareRefContext">;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Result<Parameters<typeof linkifyDripArtifact>[0]["artifact"]> {
  const context: BareRefContext = deps.bareRefContext({ home });
  const bareRefs = linkifyDripArtifact({ artifact, context });
  const bareRefVerdict = bareRefVerdictFor({ env: ({ name }) => env[name], home, issues: bareRefs.issues });
  return bareRefVerdict.refusals.length > 0 ? err(bareRefVerdict.refusals) : ok(bareRefs.artifact);
}

/**
 * Resolve every mention against the conversation the message posts into: its members are read once — only when the
 * message mentions anybody — so a member is addressable whatever their email says, and a direct message refuses a tag
 * of somebody who is not in it (`../../../outbound/slack/dmMembership.ts`).
 *
 * @param artifact the linkified form
 * @param deps the injected reads, for the membership read, the roster lookup and their bot DM
 * @param options the parsed invocation, naming the conversation
 * @param token the token the membership read goes out under — the send's own
 * @returns every mention resolved, or every refusal
 */
async function resolveInConversation({
  artifact,
  deps,
  options,
  token,
}: {
  artifact: Parameters<typeof dripMentionedPeople>[0]["artifact"];
  deps: Pick<DripPrepareDeps, "conversationMembership" | "promptChannel" | "resolveMentions" | "taggedAccount">;
  options: SlackDripOptions;
  token: string;
}): Promise<Result<MentionResolution>> {
  const { channel, home } = options;
  const membership =
    dripMentionedPeople({ artifact }).length === 0
      ? undefined
      : await deps.conversationMembership({ channel, home, token });
  if (membership?.kind === "unreadable") {
    logger.warn({
      msg: `could not read who is in ${channel} (${membership.cause}): a mention is judged without the conversation's members`,
    });
  }
  const resolved = await resolveDripMentions({
    artifact,
    conversationMembers: addressableMembers({ membership }),
    home,
    resolveMentions: deps.resolveMentions,
  });
  if (resolved.isErr()) {
    return resolved;
  }
  // Only a DM read can be held, so only one asks which DM is their bot's.
  const dmRead = membership?.kind === "read" && membership.directMessage;
  const outside = dmNonMemberRefusal({
    channel,
    membership,
    promptChannel: dmRead ? deps.promptChannel({ home }) : undefined,
    resolution: resolved.value,
  });
  if (outside.length > 0) {
    return err(outside);
  }
  // A tag of somebody who has left refuses here, read live, so record, send and release all ask it
  // (`./departedTagCheck.ts`).
  const departed = await resolvedTagRefusals({
    home,
    resolution: resolved.value,
    taggedAccount: deps.taggedAccount,
    token,
  });
  return departed.length > 0 ? err(departed) : resolved;
}

/**
 * `--form -` / `--body -` read from stdin, which is how prose gets in without shell mangling.
 *
 * @param deps the injected reads, for stdin
 * @param source what the caller typed
 * @returns the source with any stdin sentinel replaced by the bytes it stood for
 */
async function readDripSource({ deps, source }: { deps: DripPrepareDeps; source: DripSource }): Promise<DripSource> {
  if (source.kind === "form") {
    return source.json === STDIN_SENTINEL ? { json: await deps.readStdin(), kind: "form" } : source;
  }
  // The escape hatch is byte-for-byte, so stdin is taken EXACTLY as given except for one trailing
  // newline — a heredoc always adds one, and nobody means to end their message with a blank line.
  return source.text === STDIN_SENTINEL ? { kind: "body", text: (await deps.readStdin()).replace(/\n$/, "") } : source;
}
