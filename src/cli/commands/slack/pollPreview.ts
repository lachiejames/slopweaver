/**
 * `slack poll` up to where its dry run and its send split: the poll composed offline, the own-DM proof read once,
 * and the preview the dry run prints.
 *
 * The order is the point. Composing first means Slack is never asked about a poll that did not render; reading the
 * proof once, before the split, means a dry run and the send make the same first read, so a rate limit after it
 * cannot exempt one from the PR-lead rule and judge the other.
 */

import { logger } from "../../../lib/logger.js";
import { prLedRefusalsFor } from "../../../outbound/slack/draftPrLead.js";
import type { PollArtifact } from "../../../outbound/slack/pollForm.js";
import { type PollSurface, previewSurfaceFromChannelId } from "../../../outbound/slack/pollRender.js";
import type { SlackCardChrome } from "../../../outbound/slack/types.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { buildPollPlan, type PollPlan, type PollPostOptions, pollDryRunLines } from "./pollCore.js";
import type { VerifyOwnDm } from "./verifiedOwnDm.js";

/** The seams composing a poll and proving its destination read. */
export interface PollComposeDeps {
  readonly cardChrome: (args: { home: string }) => SlackCardChrome;
  readonly pollEventType: (args: { home: string }) => string;
  readonly verifiedOwnDm: VerifyOwnDm;
}

/**
 * Compose the poll over a surface, with the chrome and event type the profile configures.
 *
 * @param artifact the validated poll
 * @param deps the profile-reading seams
 * @param options the parsed post invocation
 * @param pings the already-resolved mention tokens
 * @param surface the conversation kind the footer is written for
 * @returns the fully-decided send
 */
export function composePollPlan({
  artifact,
  deps,
  options,
  pings,
  surface,
}: {
  artifact: PollArtifact;
  deps: Pick<PollComposeDeps, "cardChrome" | "pollEventType">;
  options: PollPostOptions;
  pings: readonly string[];
  surface: PollSurface;
}): PollPlan {
  return buildPollPlan({
    artifact,
    chrome: deps.cardChrome({ home: options.home }),
    metadataEventType: deps.pollEventType({ home: options.home }),
    options,
    pings,
    surface,
  });
}

/**
 * Compose the poll offline over the surface its channel id implies, then read whether that destination is proven
 * their own DM — once, for both the dry run and the send.
 *
 * @param artifact the validated poll
 * @param deps the composing and proving seams
 * @param options the parsed post invocation
 * @param pings the already-resolved mention tokens
 * @returns the offline preview plan, the surface it assumed, and the destination proven their, if any
 */
export async function composeAndProve({
  artifact,
  deps,
  options,
  pings,
}: {
  artifact: PollArtifact;
  deps: PollComposeDeps;
  options: PollPostOptions;
  pings: readonly string[];
}): Promise<{ readonly plan: PollPlan; readonly surface: PollSurface; readonly verifiedOwnDm: string | undefined }> {
  const surface = previewSurfaceFromChannelId({ channel: options.channel });
  const plan = composePollPlan({ artifact, deps, options, pings, surface });
  const verifiedOwnDm = await deps.verifiedOwnDm({ channel: plan.channel, home: options.home });
  return { plan, surface, verifiedOwnDm };
}

/**
 * The dry-run preview, which itself stays OFFLINE and token-free.
 *
 * A dry run is the step taken before deciding to send at all, so requiring credentials and a live Slack lookup
 * to see it was a regression. But it must still show the footer that will really ship, or the preview lies about
 * the very thing the footer exists to get right — so the surface is derived from the channel id and the output
 * SAYS that is where it came from. The real send asks Slack and refuses when the answer is unclear.
 *
 * Its question is held to the PR-lead rule the send's door holds it to, so the preview refuses what
 * the send would, on the same proof the send reads.
 *
 * @param emit where the preview's lines go
 * @param options the parsed post invocation
 * @param plan the poll composed over the surface its channel id implies
 * @param surface the surface the channel id implies, which the footer names as its source
 * @param verifiedOwnDm the destination a bot-token read proved their own DM, read once before the paths split
 * @returns EXIT_OK once the preview is printed, EXIT_EXPECTED_EMPTY when the send would hold it
 */
export function emitPollDryRun({
  emit,
  options,
  plan,
  surface,
  verifiedOwnDm,
}: {
  emit: (line: string) => void;
  options: PollPostOptions;
  plan: PollPlan;
  surface: PollSurface;
  verifiedOwnDm: string | undefined;
}): number {
  const prLed = prLedRefusalsFor({ channel: plan.channel, payload: plan.payload, verifiedOwnDm });
  if (prLed.length > 0) {
    for (const line of prLed) {
      logger.error({ msg: line });
    }
    logger.error({ msg: "nothing was posted." });
    return EXIT_EXPECTED_EMPTY;
  }
  for (const line of pollDryRunLines({ plan })) {
    emit(line);
  }
  emit(
    `  the footer above assumes ${options.channel} is a ${surface === "direct-message" ? "DM" : "shared channel"}, ` +
      "from its id. The real send confirms that with Slack and refuses if it cannot.",
  );
  return EXIT_OK;
}
