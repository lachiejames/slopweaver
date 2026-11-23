/**
 * The as-me lane's SEND-CAPABLE half: the render proof, which posts, and the refusal pass that runs it.
 *
 * A separate module from `./wallCheck.ts` rather than a section of it, and the separation is the point. A
 * preparation pass — `./prepareDrip.ts`, which a draft recorder uses — must be unable to post what it is
 * preparing, and the strongest form of that is a module it does not import at all. `wallCheck.ts` now holds
 * only reads; every effect that puts bytes into Slack from this lane is here.
 *
 * MEASURED, and why this is a module boundary rather than a comment: `runRenderProof`
 * posts the identical bytes to the operator's own proof conversation, reads them back and deletes them, and
 * the delete can fail. A recorder that reached it while parking a draft they had not answered yet would have
 * left a real message behind under their own name.
 */
import type { SlackWriteApi } from "../../../corpus/slack/writeApi.js";
import { hatchOpen } from "../../../hatch/open.js";
import { logger } from "../../../lib/logger.js";
import { storedRenderIssues } from "../../../outbound/slack/renderCheck.js";
import {
  dirtyProofRefusal,
  needsRenderProof,
  unconfiguredProofRefusal,
  unprovableRefusal,
} from "../../../outbound/slack/renderProof.js";
import type { SlackDripMessagePayload } from "../../../outbound/slack/types.js";
import type { SlackDripOptions } from "./coreTypes.js";
import type { SlackDripPlan } from "./dripCore.js";
import type { SlackWriteDeps } from "./run.js";
import { asMeWallRefusalFor, type DripReadDeps } from "./wallCheck.js";
import type { DripConfig } from "./wiring.js";

/**
 * The reads of { DripReadDeps} plus the ONE seam that posts, and nothing else.
 *
 * `SlackWriteDeps` satisfies it structurally, so the send lane hands its own bag through unchanged. Naming
 * the send edge in a three-field type rather than taking the whole write bag is what lets a test drive the
 * proof round trip with three plain functions — and what makes the edge visible in one line.
 */
export interface DripSendDeps extends Pick<DripReadDeps, "conversationSurface" | "wallRun"> {
  readonly proveRender: SlackWriteDeps["proveRender"];
}

/**
 * Every refusal the as-me lane can only decide WITH the ability to post, in the order the send runs them.
 *
 * The complement of `planDripChecked` (`./wallCheck.ts`): together the two are the whole pre-send pass, and
 * apart they are what lets a recorder reach exactly the half that costs nothing. The render proof runs
 * first because it is the one that can put bytes anywhere, and a caller should learn its verdict before
 * being told about a wall it could fix by rewriting.
 *
 * @param config the operator's drip bounds and cadence, from `profile.json`
 * @param deps the injected reads plus the one seam that posts
 * @param env the environment the gates' override tokens are read from
 * @param options the parsed invocation
 * @param plan the plan `planDripChecked` already cleared
 * @param token the token this send will use
 * @returns the first refusal these two steps triggered, or empty when the send may proceed
 */
export async function sendOnlyDripRefusals({
  config,
  deps,
  env,
  options,
  plan,
  token,
}: {
  config: DripConfig;
  deps: DripSendDeps;
  env: Readonly<Record<string, string | undefined>>;
  options: SlackDripOptions;
  plan: SlackDripPlan;
  token: string;
}): Promise<readonly string[]> {
  const proofErrors = await renderProofRefusalFor({ config, deps, env, options, plan, token });
  if (proofErrors.length > 0) {
    return proofErrors;
  }
  return asMeWallRefusalFor({ deps, env, home: options.home, plan, token });
}

/**
 * Prove a PUBLIC raw-body post renders correctly, somewhere private, before it goes anywhere public.
 *
 * The only lane with no other control: `--form` is checked before the wire from its own blocks, and every
 * send is checked after it, but a `--body` string's styling and mentions are decided by Slack's parse, which
 * does not happen until it is published. So the identical bytes are posted to the operator's own
 * render-proof conversation, read back, checked, and deleted.
 *
 * Every failure arm REFUSES and names the `unproven-render` grant, per the ruling that a
 * block must always carry a key. The delete is deliberately NOT one of those arms — see below.
 *
 * @param config the operator's as-me preferences, for the proof conversation
 * @param deps the injected world, for the proof round trip
 * @param env the environment the override token is read from
 * @param options the parsed invocation, for `--dry-run`, which never performs the round trip
 * @param plan the fully-built plan, for its shape, channel and payload
 * @param token the token this send will use
 * @returns the refusal, or empty when the proof passed or was not needed
 */
async function renderProofRefusalFor({
  config,
  deps,
  env,
  options,
  plan,
  token,
}: {
  config: DripConfig;
  deps: DripSendDeps;
  env: Readonly<Record<string, string | undefined>>;
  options: SlackDripOptions;
  plan: SlackDripPlan;
  token: string;
}): Promise<readonly string[]> {
  // A `--dry-run` NEVER performs the round trip, and this is the one gate that opts out of running under it.
  // The others are reads and a dry run is documented as traceless, but proving a render means posting a real
  // message and deleting it — a side effect from a verb whose whole contract is that nothing is sent. The
  // subprocess suite caught this: every `--body` dry run started refusing on an unconfigured proof channel.
  // The cost is that a composer sees this refusal only on the real send, which is the right way round.
  if (options.dryRun) {
    return [];
  }
  const allowUnproven = hatchOpen({
    env,
    home: options.home,
    id: "unproven-render",
    nowIso: new Date().toISOString(),
  });
  const rawBody = plan.artifact.kind === "plain";
  // The surface read is skipped unless the answer can change the outcome, exactly as the one-card gate does.
  const needsSurface = rawBody && plan.shape === "top-level" && !allowUnproven;
  const surface = needsSurface ? await deps.conversationSurface({ channel: plan.channel, token }) : undefined;
  if (
    !needsRenderProof({ allowUnproven, proofChannel: config.renderProofChannel, rawBody, shape: plan.shape, surface })
  ) {
    return [];
  }
  if (config.renderProofChannel === undefined) {
    return unconfiguredProofRefusal();
  }
  const proof = await deps.proveRender({
    channel: config.renderProofChannel,
    home: options.home,
    payload: plan.messages[0]!.payload,
    token,
  });
  if (proof.kind === "unprovable") {
    return unprovableRefusal({ reason: proof.reason });
  }
  return proof.issues.length > 0 ? dirtyProofRefusal({ issues: proof.issues }) : [];
}

/**
 * Post one payload to the proof conversation, read Slack's own parse of it back, and delete it.
 *
 * The DELETE is not allowed to fail the send, and that is the one asymmetry worth defending. By the time it
 * runs the question has already been answered, so refusing here would block a send whose render is PROVEN
 * GOOD over a stray message in the operator's own DM. It is logged loudly instead, naming the exact message
 * to remove, which is the honest trade: a visible leftover beats a false refusal.
 *
 * @param api the write seam
 * @param channel the proof conversation
 * @param payload the exact bytes the real send would post
 * @returns what Slack's parse of those bytes contains, or why the round trip could not answer
 */
export async function runRenderProof({
  api,
  channel,
  payload,
}: {
  api: SlackWriteApi;
  channel: string;
  payload: SlackDripMessagePayload;
}): Promise<{ kind: "checked"; issues: readonly string[] } | { kind: "unprovable"; reason: string }> {
  let ts: string | undefined;
  try {
    const posted = await api.sendDripMessage({ channel, payload, uploads: [] });
    ts = posted.ts;
    const stored = await api.readOwnMessage({ channel, ts });
    if (stored?.blocks === undefined) {
      return { kind: "unprovable", reason: "the proof message posted but could not be read back" };
    }
    return { issues: storedRenderIssues({ blocks: stored.blocks }), kind: "checked" };
  } catch (error) {
    return { kind: "unprovable", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    if (ts !== undefined) {
      const gone = await api.deleteOwnMessage({ channel, ts }).catch(() => false);
      if (!gone) {
        logger.warn({ msg: `render proof left a message behind in ${channel} at ts ${ts} — delete it by hand` });
      }
    }
  }
}
