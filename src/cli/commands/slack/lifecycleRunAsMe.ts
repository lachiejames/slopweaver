/**
 * The HUMAN lane's shell for `slack edit`/`slack delete` — split out of `./lifecycleRun.ts` purely to keep
 * that file under this repo's line cap, the same reason `./writeApiStream.ts` split off of `./writeApi.ts`.
 *
 * This is still a genuinely separate CODE PATH from the bot-card lane, not merely a separate file: neither
 * function here calls `messageOwnership` anywhere. The USER token is definitionally the identity that posted
 * the message it edits or deletes, so Slack's own `chat.update`/`chat.delete` authorisation on that token IS
 * the ownership check — there is no metadata-shaped decision left for this program to make. See
 * `../../../outbound/slack/lifecycleGuards.ts` for the guard the bot lane still runs, unchanged.
 */
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { throughDoor } from "../../../admit/effects.js";
import type { PainPointLane } from "../../../admit/painPoint.js";
import { NO_AUTHORED_PROSE, type VoiceGateInput } from "../../../admit/voiceProfileGate.js";
import type { PostedMessage, SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { hatchOpen } from "../../../hatch/open.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { linkifyDripArtifact } from "../../../outbound/artifact/bareRefRuns.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { bumpRefusalFor } from "../../../outbound/slack/asMeBumpGate.js";
import { slackDeliveryErrorLines } from "../../../outbound/slack/deliveryErrors.js";
import type { TaggedAccount } from "../../../outbound/slack/departedTags.js";
import { prLedSendRefusals } from "../../../outbound/slack/draftPrLead.js";
import type { ReadSlackMessage } from "../../../outbound/slack/lifecycleGuards.js";
import { type MentionResolution, renderableMentions } from "../../../outbound/slack/mentionIndex.js";
import { payloadRenderIssues } from "../../../outbound/slack/renderCheck.js";
import type { SlackDripMessagePayload } from "../../../outbound/slack/types.js";
import type { ExactVoiceRuleFinding } from "../../../outbound/voice/exactRules.js";
import type { ProfileReadError } from "../../../profileStore.js";
import { bareRefVerdictFor } from "../../bareRefDoor.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { voiceProseOf } from "./asMeForm.js";
import { type DripSource, resolveSlackWriteToken } from "./core.js";
import { resolvedTagRefusals } from "./departedTagCheck.js";
import { resolveDripMentions } from "./dripMentions.js";
import { assessSlackDripSource } from "./dripSourceAssessment.js";
import { type HighStakesDeps, highStakesEditRefusals } from "./highStakesGate.js";
import { requireSingleDripMessage, singleDripPayload } from "./lifecycleArtifacts.js";
import { type DeleteOptions, type EditMeOptions, lifecycleDoorRequest, STDIN_SENTINEL } from "./lifecycleCore.js";
import { journalDeletedDraft } from "./lifecycleDraftDeletion.js";
import { slackLifecycleErrorLines } from "./lifecycleErrors.js";
import { gatesFor, reportNotPerformed, usage } from "./lifecycleRunShared.js";
import type { JournalDraftDeletion } from "./lifecycleRunTypes.js";
import type { VerifyOwnDm } from "./verifiedOwnDm.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import type { DripConfig } from "./wiring.js";

/** Everything the human lane needs from the world — a subset of `LifecycleDeps` (`./lifecycleRun.ts`). */
export interface AsMeLifecycleDeps {
  readonly readStdin: () => Promise<string>;
  readonly userToken: (args: { home: string }) => string | undefined;
  /** What this edit's bare `#<n>`/`SUP-123` references can resolve against — see `../../bareRefContext.js`. */
  readonly bareRefContext: (args: { home: string }) => BareRefContext;
  readonly dripConfig: (args: { home: string }) => Result<DripConfig, ProfileReadError>;
  readonly recordVoicePainPoints: (args: {
    home: string;
    findings: readonly ExactVoiceRuleFinding[];
    lane: PainPointLane;
  }) => void;
  readonly doorEnv: () => Readonly<Record<string, string | undefined>>;
  /** The door ledger the edit's or delete's decision is recorded through before anything is performed. */
  readonly doorLedger: DoorLedgerPort;
  /** Resolve everyone the edit addresses over one read of the store's identity roster; its refusal stops the edit. */
  readonly resolveMentions: Parameters<typeof resolveDripMentions>[0]["resolveMentions"];
  readonly taggedAccount: (args: { home: string; token: string; user: string }) => Promise<TaggedAccount>;
  readonly highStakes: HighStakesDeps["highStakes"];
  readonly makeTransport: (args: { token: string; home: string }) => SlackWriteTransport;
  /** The register write a confirmed delete makes, so a finding released at that message is owed no follow-up. */
  readonly journalDraftDeletion: JournalDraftDeletion;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  /** The destination when proven their own bot DM — the one conversation an edit's opening is not judged in. */
  readonly verifiedOwnDm: VerifyOwnDm;
}

/**
 * Read the message an as-me edit targets, refusing one that is not there or that is a top-level message in a
 * high-stakes channel (`./highStakesGate.ts`): an as-me message there is never the finding card that gate admits.
 *
 * @param options the parsed invocation, for the home the profile is read under
 * @param posted the message being edited
 * @param transport the Slack seam the read-back goes through
 * @returns the read-back, or the exit code the refusal already reported
 */
async function asMeEditTarget({
  deps,
  options,
  posted,
  transport,
}: {
  deps: AsMeLifecycleDeps;
  options: EditMeOptions;
  posted: PostedMessage;
  transport: SlackWriteTransport;
}): Promise<{ readonly existing: ReadSlackMessage } | { readonly exit: number }> {
  const existing = await transport.readMessage({ posted });
  if (existing === undefined) {
    logger.error({
      msg: `no message at ${posted.ts} in ${posted.channel} — refusing to edit a target that is not there.`,
    });
    return { exit: EXIT_ERROR };
  }
  const env = deps.doorEnv();
  const { channel } = posted;
  const refusals = highStakesEditRefusals({ channel, deps, env, existing, formKind: undefined, home: options.home });
  return refusals.length > 0 ? { exit: usage({ errors: refusals }) } : { existing };
}

/**
 * `--form -` / `--body -` read from stdin, matching how `post`/`reply --as me` read theirs.
 *
 * @param deps the injected world
 * @param source the parsed but not-yet-read source
 * @returns the source, with stdin read if it named the sentinel
 */
async function readEditDripSource({
  deps,
  source,
}: {
  deps: AsMeLifecycleDeps;
  source: DripSource;
}): Promise<DripSource> {
  if (source.kind === "form") {
    return source.json === STDIN_SENTINEL ? { json: await deps.readStdin(), kind: "form" } : source;
  }
  return source.text === STDIN_SENTINEL ? { kind: "body", text: (await deps.readStdin()).replace(/\n$/, "") } : source;
}

/**
 * What `resolveAsMeEditPayload` produces: the one rendered message or every refusal, and — separately —
 * what the door's voice gate will judge if the send gets that far.
 *
 * The two are siblings rather than one value because they fail differently. A parse refusal is a caller
 * mistake, reported before anything is attempted; a voice finding is a `warn` the DOOR raises, with an
 * override token, per the owner's ruling that no voice rule hard-blocks. Folding the second into
 * the `Result` would turn it back into the pre-door `EXIT_USAGE` this whole change exists to remove.
 */
type AsMeEditPayload = {
  readonly payload: Result<SlackDripMessagePayload>;
  readonly voice: VoiceGateInput;
};

/** The one message an edit sends, and the mentions it resolved, which the live departed-tag read still asks about. */
type RenderedAsMeEdit = { readonly payload: SlackDripMessagePayload; readonly resolution: MentionResolution };

/**
 * {@link resolveAsMeEditPayload}, then its opening judged before Slack is read: an edit replaces the opening a
 * teammate reads, so it is held to the rule a send is. The DM it sits in is re-read, never inferred
 * from the message already being there; a dry run asks too, since an edit's dry run reads Slack for its target anyway.
 */
async function judgedAsMeEditPayload(args: Parameters<typeof resolveAsMeEditPayload>[0]): Promise<AsMeEditPayload> {
  const { deps, options } = args;
  const resolved = await resolveAsMeEditPayload(args);
  const { channel } = options;
  const verifiedOwnDm = resolved.payload.isErr()
    ? undefined
    : await deps.verifiedOwnDm({ channel, home: options.home });
  return {
    payload: resolved.payload.andThen((payload) => {
      const prLed = prLedSendRefusals({ channel, payload, verifiedOwnDm });
      return prLed.length > 0 ? err(prLed) : ok(payload);
    }),
    voice: resolved.voice,
  };
}

/**
 * Read, validate and render the `--as me` edit source into the one message `chat.update` will send.
 *
 * Split out of `runEditAsMe` to keep that function under this repo's line cap — the parsing/validation half
 * has nothing to do with the token or the network call that follows it.
 *
 * @param config the operator's drip bounds and exact voice rules, already read from a profile that could be trusted
 * @param options the parsed `--as me` invocation
 * @param deps the injected world
 * @param token the user token the edit posts under, which the live departed-tag read uses too
 * @returns the rendered payload, or every refusal
 */
async function resolveAsMeEditPayload({
  config,
  options,
  deps,
  token,
}: {
  config: DripConfig;
  options: EditMeOptions;
  deps: AsMeLifecycleDeps;
  token: string;
}): Promise<AsMeEditPayload> {
  const source = await readEditDripSource({ deps, source: options.source });
  const allowVoiceRules = hatchOpen({
    env: deps.doorEnv(),
    home: options.home,
    id: "voice-rules",
    nowIso: new Date().toISOString(),
  });
  const assessed = assessSlackDripSource({ allowVoiceRules, config, source });
  if (assessed.voiceRuleFindings.length > 0) {
    deps.recordVoicePainPoints({ findings: assessed.voiceRuleFindings, home: options.home, lane: "as-me" });
  }
  if (assessed.parsed.isErr()) {
    return { payload: err(slackDeliveryErrorLines({ error: assessed.parsed.error })), voice: NO_AUTHORED_PROSE };
  }
  const single = requireSingleDripMessage({ artifact: assessed.parsed.value });
  if (single.isErr()) {
    return { payload: err(slackLifecycleErrorLines({ error: single.error })), voice: NO_AUTHORED_PROSE };
  }
  // Same rule the bot-card lane and `post|reply --as me` enforce: resolve every bare reference into a real
  // link, then refuse whatever still can't resolve. See ../../bareRefDoor.ts.
  const context = deps.bareRefContext({ home: options.home });
  const bareRefs = linkifyDripArtifact({ artifact: single.value, context });
  const bareRefVerdict = bareRefVerdictFor({
    env: ({ name }) => deps.doorEnv()[name],
    home: options.home,
    issues: bareRefs.issues,
  });
  if (bareRefVerdict.refusals.length > 0) {
    return { payload: err(bareRefVerdict.refusals), voice: NO_AUTHORED_PROSE };
  }
  const artifact = bareRefs.artifact;
  // The prose the door will judge comes off the LINKIFIED artifact rather than the parsed one, so a rule is
  // applied to the words that actually go out. `assessSlackDripSource`'s own pass, above, is what feeds the
  // pain-point ledger; this one is what the gate reads.
  const voice: VoiceGateInput = {
    allowVoiceRules,
    prose: voiceProseOf({ artifact }),
    rules: config.exactVoiceRules,
  };
  const rendered = await renderAsMeEditPayload({ artifact, deps, home: options.home });
  if (rendered.isErr()) {
    return { payload: err(rendered.error), voice };
  }
  // The same live departed-tag read `post|reply --as me` makes in its preparation: an edit re-publishes its tags.
  const { payload, resolution } = rendered.value;
  const { taggedAccount } = deps;
  const departed = await resolvedTagRefusals({ home: options.home, resolution, taggedAccount, token });
  return { payload: departed.length > 0 ? err(departed) : ok(payload), voice };
}

/**
 * Resolve the artifact's mentions and render it, refusing an untagged chase or a render a reader sees broken.
 *
 * @param artifact the linkified single message an edit replaces
 * @param deps the injected world
 * @param home the install this edit runs against
 * @returns the rendered payload and the mentions it resolved, or every refusal
 */
async function renderAsMeEditPayload({
  artifact,
  deps,
  home,
}: {
  artifact: AsMeArtifact;
  deps: AsMeLifecycleDeps;
  home: string;
}): Promise<Result<RenderedAsMeEdit>> {
  // The SAME extraction, resolution and refusal the `post`/`reply` lane runs, called rather than restated:
  // this used to be an inlined copy, and a copy is what let the plain-body lane's mention gap survive being
  // fixed in one of the two places it lived.
  const resolved = await resolveDripMentions({ artifact, home, resolveMentions: deps.resolveMentions });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const payload = singleDripPayload({ artifact, mentions: renderableMentions({ resolution: resolved.value }) });
  // Rule 7: a chase names the person, or the door refuses it — same gate `post|reply --as me` runs, over
  // the one rendered message an edit replaces. See ../../../outbound/slack/asMeBumpGate.ts.
  const bumpRefusal = bumpRefusalFor({
    allowUntagged: hatchOpen({
      env: process.env,
      home,
      id: "untagged-bump",
      nowIso: new Date().toISOString(),
    }),
    text: payload.text,
  });
  if (bumpRefusal.length > 0) {
    return err(bumpRefusal);
  }
  // The same pre-wire render refusal `post|reply --as me` runs: an edit is how a broken send gets fixed, so
  // an edit that carries the same broken link would re-publish exactly the defect it came to repair.
  const renderRefusal = payloadRenderIssues({ payload });
  if (renderRefusal.length > 0) {
    return err(renderRefusal.map((issue) => `the edit would post something a reader sees wrong. ${issue}`));
  }
  return ok({ payload, resolution: resolved.value });
}

/**
 * `slack edit --as me` — replace the words of a message the human posted, in place.
 *
 * @param options the parsed `--as me` invocation
 * @param deps the injected world
 * @returns the process exit code
 */
export async function runEditAsMe({
  options,
  deps,
}: {
  options: EditMeOptions;
  deps: AsMeLifecycleDeps;
}): Promise<number> {
  const token = resolveSlackWriteToken({
    actor: "me",
    botToken: undefined,
    userToken: deps.userToken({ home: options.home }),
  });
  if (token.isErr()) {
    return usage({ errors: [token.error.message] });
  }
  // READ before Slack is asked anything: these bounds and rules decide what the edit may say, so a profile that
  // cannot be trusted stops it rather than editing under limits nobody chose.
  const config = deps.dripConfig({ home: options.home });
  if (config.isErr()) {
    return unreadableProfileExit({ error: config.error, nothingHappened: "nothing was changed." });
  }
  const resolved = await judgedAsMeEditPayload({ config: config.value, deps, options, token: token.value });
  if (!resolved.payload.isOk()) {
    return usage({ errors: resolved.payload.error });
  }
  const payload = resolved.payload.value;
  const posted: PostedMessage = { channel: options.channel, ts: options.ts };
  const transport = deps.makeTransport({ home: options.home, token: token.value });
  const target = await asMeEditTarget({ deps, options, posted, transport });
  if ("exit" in target) {
    return target.exit;
  }
  const existing = target.existing;
  if (options.dryRun) {
    deps.out(
      `dry run — nothing was changed. would chat.update (as me, no ownership check) ${options.channel}/${options.ts}`,
    );
    deps.out(`  form: ${payload.form}`);
    deps.out(`  media preserved: ${String(existing.fileIds.length)} file(s)`);
    return EXIT_OK;
  }
  const routed = await throughDoor({
    gates: gatesFor({ voice: resolved.voice }),
    home: options.home,
    ledger: deps.doorLedger,
    // Same reason as the bot lane: `chat.update` without `file_ids` detaches whatever the message had.
    perform: async () => transport.updateDripMessage({ fileIds: existing.fileIds, payload, posted }),
    request: lifecycleDoorRequest({ options, targetTs: options.ts }),
  });
  if (!routed.performed) {
    return reportNotPerformed({ through: routed });
  }
  deps.out(
    `edited — channel=${options.channel} ts=${options.ts} (as me) media preserved=${String(existing.fileIds.length)}`,
  );
  return EXIT_OK;
}

/**
 * `slack delete --as me` — remove a message the human posted, with no ownership guard.
 *
 * @param options the parsed `--as me` invocation
 * @param deps the injected world
 * @returns the process exit code
 */
export async function runDeleteAsMe({
  options,
  deps,
}: {
  options: DeleteOptions;
  deps: AsMeLifecycleDeps;
}): Promise<number> {
  const token = resolveSlackWriteToken({
    actor: "me",
    botToken: undefined,
    userToken: deps.userToken({ home: options.home }),
  });
  if (token.isErr()) {
    return usage({ errors: [token.error.message] });
  }
  const posted: PostedMessage = { channel: options.channel, ts: options.ts };
  const transport = deps.makeTransport({ home: options.home, token: token.value });
  if (options.dryRun) {
    deps.out(
      `dry run — nothing was changed. would chat.delete (as me, no ownership check) ${options.channel}/${options.ts}`,
    );
    return EXIT_OK;
  }
  const routed = await throughDoor({
    // A delete authors nothing, so there is no voice question to ask about it.
    gates: gatesFor({ voice: NO_AUTHORED_PROSE }),
    home: options.home,
    ledger: deps.doorLedger,
    perform: async () => transport.deleteMessage({ posted }),
    request: lifecycleDoorRequest({ options, targetTs: options.ts }),
  });
  if (!routed.performed) {
    return reportNotPerformed({ through: routed });
  }
  if (!routed.result) {
    logger.error({
      msg: `chat.delete did not succeed for ${options.channel}/${options.ts}; the message may still be visible`,
    });
    return EXIT_ERROR;
  }
  journalDeletedDraft({ channel: options.channel, deps, home: options.home, ts: options.ts });
  deps.out(`deleted — channel=${options.channel} ts=${options.ts} (as me)`);
  return EXIT_OK;
}
