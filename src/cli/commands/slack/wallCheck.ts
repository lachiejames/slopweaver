/**
 * The wall-refusal precheck shared by `slopweaver slack post|reply`'s two lanes, plus every as-me pre-send
 * check that can be decided WITHOUT the ability to post — split out of `./run.ts` purely to keep that file
 * under this repo's `file-size-ratchet` cap. Carries no policy of its own beyond wiring the injected live
 * reads into the two pure decisions in `../../../outbound/slack/wallGate.js` and
 * `../../../outbound/slack/publicCardGate.js`.
 *
 * **Nothing in this module posts.** The render proof and the pass that runs it live in `./dripSendPlan.ts`,
 * so a preparation pass (`./prepareDrip.ts`, which the draft recorder uses) never imports a module holding
 * a send edge.
 *
 * The one thing this file DOES decide is which identity each lane sends under, because that is the only
 * place both lanes are visible at once: {@link asMeWallRefusalFor} is the as-me lane and passes `me`, and
 * `./run.ts`'s card lane passes `bot`. The wall gate reads nothing else to tell them apart.
 */
import { hatchOpen } from "../../../hatch/open.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import { topLevelPostsOf } from "../../../outbound/slack/highStakesChannel.js";
import { type MentionResolution, renderableMentions } from "../../../outbound/slack/mentionIndex.js";
import { needsSurfaceForOneCard, publicDripRefusal } from "../../../outbound/slack/publicCardGate.js";
import { reviewAskShapeRefusal } from "../../../outbound/slack/reviewAskShape.js";
import { type WallActor, wallRefusal } from "../../../outbound/slack/wallGate.js";
import type { SlackDripOptions } from "./coreTypes.js";
import {
  buildSlackDripPlan,
  bumpRefusalForPlan,
  paragraphSpacingRefusalForPlan,
  renderRefusalForPlan,
  type SlackDripPlan,
} from "./dripCore.js";
import { type HighStakesDeps, highStakesRefusals } from "./highStakesGate.js";
import { slackReadErrorLines } from "./readErrors.js";
import type { SlackWriteDeps } from "./run.js";
import type { DripConfig } from "./wiring.js";

/**
 * The reads a PREPARATION pass may perform, and the whole point of the type is what it does NOT carry.
 *
 * `SlackWriteDeps` satisfies this structurally, so the send lane passes its own bag straight through and no
 * production wiring changed. What a caller holding only this type cannot reach is `proveRender` — and that
 * is not a stylistic narrowing, it is the one dependency the as-me lane has that POSTS. The proof step in
 * `./dripSendPlan.ts` posts the identical bytes to the operator's own proof conversation, reads them back
 * and deletes them, and the delete can fail; `--dry-run` is the single gate that opts out of it.
 *
 * MEASURED, and why a type rather than a boolean: a draft recorder that reused the
 * full send pass with ordinary options would post a real message while parking a draft they had not answered
 * yet. A `dryRun: true` argument prevents that only for as long as nobody passes `false`; a dependency bag
 * with no send edge prevents it in the compiler. The ISO draft this seam was cut for is a typed form and
 * never reaches the proof branch at all — recording must not rest on that coincidence.
 */
export interface DripReadDeps extends HighStakesDeps {
  readonly wallRun: SlackWriteDeps["wallRun"];
  readonly conversationSurface: SlackWriteDeps["conversationSurface"];
}

/**
 * Refuse a reply whose own messages would take our unbroken run in the thread past the wall limit.
 *
 * A no-op for `slack post`, which never carries a `threadTs` — see `parseThreadTs` in `./coreArgs.ts`.
 * Runs unconditionally, including under `--dry-run`, at the same point in the pipeline the other
 * pre-send refusals (bare refs, the bump gate, the voice gate) run: a caller composing a wall should see
 * the refusal before deciding whether to override it, not only after removing `--dry-run`. A failure to
 * establish the run itself (a flaky read, a missing scope) is logged and treated as a PASS — this check
 * exists to catch a wall, not to make every reply depend on one extra Slack call succeeding.
 *
 * Under `actor: "me"` the standing run comes back as 0 whatever the thread holds, so the only thing that
 * can trip the limit is this send's own `newMessageCount` — the read still earns its place by naming the
 * last message from someone else, which is what makes the refusal's prose true.
 *
 * **That lane therefore does NOT fail open**, and the asymmetry is the point rather than an inconsistency.
 * The bot lane genuinely cannot decide without the read, so a failed read there is a pass. The as-me lane
 * already holds everything the arithmetic needs before the call, so a failed read costs it only the prose
 * about who last replied — and failing open would hand a caller an unlimited drip on a flaky read. A Codex
 * review pass found this by counterexample: `fetchCompleteSlackThread` refuses past 200 pages
 * (`../../../live/slack/pagination.ts`), so a long enough thread turned a six-message drip into a silent
 * send.
 *
 * @param deps the injected world, for the live run count and the override env
 * @param channel the target channel
 * @param threadTs the thread root, or undefined for `slack post`
 * @param newMessageCount how many messages this send is about to post, all necessarily consecutive
 * @param token the token this send will use — also the identity "ours" is measured against
 * @param actor which identity this send goes out under; in the `me` lane an earlier message from that
 *   identity is the owner's own hand and never extends the run (`../../../outbound/slack/wallGate.ts`)
 * @param env the environment the session id is read from
 * @param home the Slopweaver home whose journal holds this session's `wall` grant
 * @returns one refusal, or empty when the send may proceed
 */
export async function wallRefusalFor({
  deps,
  channel,
  threadTs,
  newMessageCount,
  token,
  actor,
  env,
  home,
}: {
  deps: Pick<DripReadDeps, "wallRun">;
  channel: string;
  threadTs: string | undefined;
  newMessageCount: number;
  token: string;
  actor: WallActor;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
}): Promise<readonly string[]> {
  if (threadTs === undefined) {
    return [];
  }
  const allowWall = hatchOpen({ env, home, id: "wall", nowIso: new Date().toISOString() });
  const fetched = await deps.wallRun({ actor, channel, threadTs, token });
  if (fetched.isErr()) {
    // The line says which of the two happened, because a reader of stderr cannot tell the lanes apart and
    // "skipped" would be a lie in the as-me half.
    const consequence = actor === "bot" ? "check skipped" : "counting this send's own messages only";
    logger.warn({
      msg: `wall-run read failed for ${channel} ${threadTs}, ${consequence}: ${slackReadErrorLines({ error: fetched.error }).join("; ")}`,
    });
    if (actor === "bot") {
      return [];
    }
    return wallRefusal({ allowWall, existingRun: { length: 0 }, newMessageCount });
  }
  return wallRefusal({ allowWall, existingRun: fetched.value, newMessageCount });
}

/**
 * Build the drip plan and run every refusal that can be decided WITHOUT the ability to post.
 *
 * Split from the send-capable pass in `./dripSendPlan.ts` so a preparation pass — a draft parked for the
 * owner to read — can reach exactly these checks and no others. Its `deps` is {@link DripReadDeps}, which
 * carries no send edge, so "recording cannot post" is the compiler's answer rather than a promise about
 * how this is called.
 *
 * The order inside is unchanged and load-bearing: the two pure gates run before the two that cost a Slack
 * read, and the public-channel gate stays ahead of the wall gate — see {@link publicDripRefusalFor}'s own
 * note on why that precedence is the point.
 *
 * @param artifact the validated, bare-ref-resolved artifact
 * @param config the operator's drip bounds and cadence, from `profile.json`
 * @param deps the injected reads, deliberately without `proveRender`
 * @param env the environment the gates' override tokens are read from
 * @param options the parsed invocation
 * @param resolution every mentioned person, already resolved
 * @param token the token this send will use
 * @returns the plan, or the first refusal it triggered
 */
export async function planDripChecked({
  artifact,
  config,
  deps,
  env,
  options,
  resolution,
  token,
}: {
  artifact: AsMeArtifact;
  config: DripConfig;
  deps: DripReadDeps;
  env: Readonly<Record<string, string | undefined>>;
  options: SlackDripOptions;
  resolution: MentionResolution;
  token: string;
}): Promise<Result<SlackDripPlan>> {
  const plan = buildSlackDripPlan({
    artifact,
    intervalMs: config.intervalMs,
    mentions: renderableMentions({ resolution }),
    options,
  });
  // A release to a direct message carries the hatch's own named exception with it: the one other person in
  // a DM is the reader, so a mention adds nothing. Only a draft release sets it, from a live surface read.
  const bumpRefusal = bumpRefusalForPlan({
    allowUntagged:
      options.bumpExemption === "direct-message" ||
      hatchOpen({ env, home: options.home, id: "untagged-bump", nowIso: new Date().toISOString() }),
    plan,
  });
  if (bumpRefusal.length > 0) {
    return err(bumpRefusal);
  }
  // Before the two gates that need a Slack read, because this one needs nothing and a caller should not
  // wait on the network to be told their own form carries a mention that would post as plain text.
  const renderRefusal = renderRefusalForPlan({ plan });
  if (renderRefusal.length > 0) {
    return err(renderRefusal);
  }
  const voiceRefusal = voiceShapeRefusal({ artifact, env, options, paragraphSpacing: config.paragraphSpacing, plan });
  if (voiceRefusal.length > 0) {
    return err(voiceRefusal);
  }
  const surfaceErrors = await surfaceRefusals({ deps, env, home: options.home, plan, token });
  if (surfaceErrors.length > 0) {
    return err(surfaceErrors);
  }
  return ok(plan);
}

/**
 * The two voice-shape refusals, in order: paragraph spacing, then their review-ask shape.
 * The same voice override that lifts the exact vocabulary rules lifts both: they are the operator's private voice
 * content, and one break-glass for one deliberate artifact is the whole point of that name. It never lifts the
 * reviewer declaration a recording owes, which is always possible to give.
 *
 * @param paragraphSpacing whether the operator's profile turns the spacing rule on
 * @returns the first gate's refusal lines, or nothing when both pass
 */
function voiceShapeRefusal({
  artifact,
  env,
  options,
  paragraphSpacing,
  plan,
}: {
  artifact: AsMeArtifact;
  env: Readonly<Record<string, string | undefined>>;
  options: SlackDripOptions;
  paragraphSpacing: boolean;
  plan: SlackDripPlan;
}): readonly string[] {
  const voiceHatch = hatchOpen({ env, home: options.home, id: "voice-rules", nowIso: new Date().toISOString() });
  const spacingRefusal = paragraphSpacingRefusalForPlan({ enabled: paragraphSpacing && !voiceHatch, plan });
  if (spacingRefusal.length > 0) {
    return spacingRefusal;
  }
  return reviewAskShapeRefusal({
    artifact,
    channel: options.channel,
    enabled: !voiceHatch,
    reviewer: options.reviewer,
  });
}

/**
 * The two as-me refusals decided by WHERE the drip lands, in order: a top-level post into a high-stakes
 * channel, then a multi-message top-level post into a channel the whole org reads.
 *
 * The high-stakes one is first because it refuses the post outright (a top-level post
 * there is a finding card or nothing, and an as-me post can never be one), where the one-card gate would only
 * advise consolidating it — and it refuses a DRAFT here too, which could otherwise be parked and never release.
 *
 * @param deps the injected reads
 * @param env the environment the hatches are read from
 * @param home the Slopweaver home, for the high-stakes list and its journalled hatch grants
 * @param plan the fully-built plan, for its channel, thread, shape and message count
 * @param token the token this send will use
 * @returns the first gate's refusal, or empty when the drip may proceed
 */
async function surfaceRefusals({
  deps,
  env,
  home,
  plan,
  token,
}: {
  deps: DripReadDeps;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  plan: SlackDripPlan;
  token: string;
}): Promise<readonly string[]> {
  const { channel, threadTs } = plan;
  const highStakes = await highStakesRefusals({
    channel,
    claim: false,
    deps,
    env,
    formKind: undefined,
    home,
    threadTs,
    token,
    topLevelPosts: topLevelPostsOf({ messageCount: plan.messages.length, shape: plan.shape }),
  });
  if (highStakes.length > 0) {
    return highStakes;
  }
  return publicDripRefusalFor({ deps, env, home, plan, token });
}

/**
 * The as-me lane's wall check, split from the send pass in `./dripSendPlan.ts` so this module carries no
 * send edge at all. The only thing it adds is the `me` actor — this lane sends under the owner's
 * own identity, so their earlier replies in the thread are their hand rather than a run we built.
 *
 * @param deps the injected world, for the live run read
 * @param env the environment the session id is read from
 * @param home the Slopweaver home whose journal holds this session's `wall` grant
 * @param plan the fully-built plan, for its channel, thread and message count
 * @param token the token this send will use
 * @returns one refusal, or empty when the drip may proceed
 */
export async function asMeWallRefusalFor({
  deps,
  env,
  home,
  plan,
  token,
}: {
  deps: Pick<DripReadDeps, "wallRun">;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  plan: SlackDripPlan;
  token: string;
}): Promise<readonly string[]> {
  return wallRefusalFor({
    actor: "me",
    channel: plan.channel,
    deps,
    env,
    home,
    newMessageCount: plan.messages.length,
    threadTs: plan.threadTs,
    token,
  });
}

/**
 * Refuse a multi-message TOP-LEVEL send whose channel anybody in the org can read.
 *
 * Runs BEFORE the wall gate, and the order is the point rather than an accident. Both can fire on the same
 * send, and they give different advice: the wall gate's subject is a run inside one thread, while this one's
 * is the shape of a public post. Reporting the thread advice first for a send that should not have been a
 * drip at all is how a caller ends up consolidating eight messages into four instead of into one.
 *
 * The surface read is SKIPPED entirely unless the answer could change the outcome, so a single-message post
 * — the compliant shape — never pays for a Slack call. Unlike `wallRefusalFor`, a failed read is NOT a pass:
 * see `../../../outbound/slack/publicCardGate.js` for why this one fails closed.
 *
 * @param deps the injected world, for the live surface read
 * @param env the environment the session id is read from
 * @param home the Slopweaver home whose journal holds this session's `public-drip` grant
 * @param plan the fully-built plan, for its channel, shape and message count
 * @param token the token this send will use
 * @returns one refusal naming the one-card target shape, or empty when the send may proceed
 */
async function publicDripRefusalFor({
  deps,
  env,
  home,
  plan,
  token,
}: {
  deps: Pick<DripReadDeps, "conversationSurface">;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  plan: SlackDripPlan;
  token: string;
}): Promise<readonly string[]> {
  const allowPublicDrip = hatchOpen({
    env,
    home,
    id: "public-drip",
    nowIso: new Date().toISOString(),
  });
  const messageCount = plan.messages.length;
  if (allowPublicDrip || !needsSurfaceForOneCard({ messageCount, shape: plan.shape })) {
    return [];
  }
  const surface = await deps.conversationSurface({ channel: plan.channel, token });
  return publicDripRefusal({ allowPublicDrip, messageCount, shape: plan.shape, surface });
}
