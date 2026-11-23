/**
 * Who a recovery pass should LOOK at, derived from the bot token's own conversation membership rather
 * than from a list somebody typed.
 *
 * ## Why this file exists
 *
 * Every live-loop handover doc once carried the widened gap pass as a literal:
 * thirteen channel ids, copied from shift to shift. The bot was then tagged in a PRIVATE
 * channel it is a member of and which no shift had ever added to that literal, so every widened pass
 * was structurally blind to it. A hand-carried set cannot notice a channel the bot was invited
 * to yesterday; the token's own membership notices it the moment Slack does.
 *
 * ## Why the OWNER's membership is the wrong subject
 *
 * `slopweaver atlas slack` knows which conversations the OWNER's account is in. That is a different,
 * much larger set — and a channel the owner is in but the bot is not is one the bot cannot read a single
 * message from. The subject here is the bot token, asked through `conversations.list` and narrowed by
 * `actionableChannels` to the conversations it can actually open.
 *
 * ## Complete or nothing
 *
 * Discovery is fail-closed: a partial membership walk is indistinguishable from a smaller workspace, and
 * a recovery pass over a silently-truncated set reports "nothing unanswered" about channels it never
 * opened — the exact failure this module was written to end. A failed walk returns a typed
 * {@link RecoveryDiscoveryError} and no usable prefix.
 *
 * **An EMPTY actionable set is the same failure wearing a success's clothes**, which is why it is its own
 * variant rather than an `ok([])`. Every downstream count is derived from what discovery handed
 * back, so a walk that succeeded and named nothing the bot may act in produced `requestedChannels: 0`,
 * `scannedChannels: 0`, no failures — and therefore `completeness: "complete"`, exit `3`, a clean bill of
 * health over a workspace nobody read. This install's bot holds DMs and joined channels at all times, so
 * zero is never the true answer: it means the walk answered about the wrong subject.
 *
 * ## A NON-EMPTY walk is not evidence of a COMPLETE one — hence the scope preflight
 *
 * The harder version of the same defect, and the reason this module asks `auth.test` before it asks
 * `conversations.list` at all. **Slack filters `conversations.list` by the token's own scopes and says
 * nothing about what it filtered**: a token holding `channels:read` and not `groups:read` walks both
 * lanes to clean cursor exhaustion, returns every public channel and every DM, omits every private
 * channel, and reports no error. The result is non-empty, so neither of the variants above fires — and
 * the pass certifies `complete` over a breadth that silently excluded exactly the conversation class
 * this module exists to reach, `#acme-bugs` among them.
 *
 * So a walk is trusted only when the token demonstrably holds the read scope for every conversation class
 * the lanes ask for. **Undetermined is refused too**: `grantedScopes` answers `undefined` when the set
 * could not be established, and coercing that to "fine" is the same unverified certification in a
 * different costume (`corpus/slack/responseMetadata.ts#slackScopesFromMetadata` on why the third state is
 * load-bearing). Read this install's own answer with
 * `slopweaver slack probe --method auth.test --scopes --bot`.
 *
 * The preflight covers BREADTH only. A `*:history` scope the token lacks fails the read of one specific
 * conversation, which the scan already records as that channel's own coverage failure — a bucket, not a
 * blind spot.
 */
import type { SlackApi, SlackChannelRef } from "../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../lib/result.js";
import { fetchCompleteSlackChannels } from "../slack/channelPagination.js";
import type { SlackPageError } from "../slack/errors.js";
import { actionableChannels } from "./recoverSweep.js";

/**
 * The read scope each conversation class in `SLACK_LANE_TYPES` needs before Slack will include it in a
 * `conversations.list` answer — `public_channel`, `private_channel` and `im` on the `channels-and-dms`
 * lane, `mpim` on the `group-dms` lane. A token missing one gets a clean walk with that class absent.
 */
const DISCOVERY_READ_SCOPES: readonly string[] = ["channels:read", "groups:read", "im:read", "mpim:read"];

/**
 * The membership walk itself failed, so what it returned is a prefix of the truth rather than the truth.
 *
 * @internal
 */
export interface DiscoveryWalkFailedError {
  readonly code: "DISCOVERY_WALK_FAILED";
  readonly message: string;
  readonly cause: SlackPageError;
}

/**
 * The walk finished and named no conversation the bot may act in — see this module's header for why
 * that is a failure rather than an empty success.
 *
 * @internal
 */
export interface DiscoveryFoundNothingError {
  readonly code: "DISCOVERY_FOUND_NOTHING";
  readonly message: string;
  /** How many conversations the walk returned BEFORE `actionableChannels` narrowed them — `0` distinguishes an empty walk from a fully-filtered one. */
  readonly discovered: number;
}

/**
 * The token demonstrably lacks a read scope one discovery lane needs, so its walk would silently omit a
 * whole conversation class while exhausting every cursor cleanly.
 *
 * @internal
 */
export interface DiscoveryScopesMissingError {
  readonly code: "DISCOVERY_SCOPES_MISSING";
  readonly message: string;
  /** Exactly which of {@link DISCOVERY_READ_SCOPES} Slack says this token does not hold. */
  readonly missing: readonly string[];
}

/**
 * `auth.test` established no scope set at all, so whether the walk would be complete was never checked —
 * a distinct claim from a token that holds nothing.
 *
 * @internal
 */
export interface DiscoveryScopesUnverifiedError {
  readonly code: "DISCOVERY_SCOPES_UNVERIFIED";
  readonly message: string;
}

/** Why a `--discover-channels` pass has no trustworthy breadth to scan. */
export type RecoveryDiscoveryError =
  DiscoveryFoundNothingError | DiscoveryScopesMissingError | DiscoveryScopesUnverifiedError | DiscoveryWalkFailedError;

/** The route out of either scope refusal, shared so both name the same next move. */
const SCOPE_REMEDY =
  "re-run `slopweaver connect slack` to grant it and re-install, or drop --discover-channels and name " +
  "the channels with --channels, which reads exactly what you typed and claims no more";

/** Builds each {@link RecoveryDiscoveryError}, so a test constructs one exactly as the real code does. */
export const RecoveryDiscoveryErrors = {
  foundNothing: ({ discovered }: { discovered: number }): DiscoveryFoundNothingError => ({
    code: "DISCOVERY_FOUND_NOTHING",
    discovered,
    message:
      `the bot's membership walk returned ${String(discovered)} conversation(s) and none it may act in — ` +
      `this token cannot see the bot's own channels and DMs (check \`slopweaver connect slack\` granted ` +
      `groups:read and im:read, and that it is the BOT token rather than a user one)`,
  }),
  scopesMissing: ({ missing }: { missing: readonly string[] }): DiscoveryScopesMissingError => ({
    code: "DISCOVERY_SCOPES_MISSING",
    message:
      `this token does not hold ${missing.join(", ")}, so Slack would omit that whole conversation class ` +
      `from the membership walk and report no error — a discovered set that looks complete and is not. ` +
      SCOPE_REMEDY,
    missing,
  }),
  scopesUnverified: (): DiscoveryScopesUnverifiedError => ({
    code: "DISCOVERY_SCOPES_UNVERIFIED",
    message:
      "the Slack scope set for this token could not be established (auth.test returned none), so whether " +
      "the membership walk can see private channels and DMs was NOT verified — and a walk missing a whole " +
      `conversation class looks exactly like a workspace without one. ${SCOPE_REMEDY}`,
  }),
  walkFailed: ({ cause }: { cause: SlackPageError }): DiscoveryWalkFailedError => ({
    cause,
    code: "DISCOVERY_WALK_FAILED",
    message: `the bot's membership walk did not complete: ${cause.message}`,
  }),
} as const;

/**
 * Whether this token can see every conversation class the discovery lanes ask for, asked BEFORE the walk
 * so nothing has to be attempted to discover it was never permitted.
 */
async function scopePreflight({
  api,
}: {
  api: Pick<SlackApi, "grantedScopes">;
}): Promise<Result<true, RecoveryDiscoveryError>> {
  const granted = await api.grantedScopes();
  if (granted === undefined) {
    return err(RecoveryDiscoveryErrors.scopesUnverified());
  }
  const held = new Set(granted);
  const missing = DISCOVERY_READ_SCOPES.filter((scope) => !held.has(scope));
  if (missing.length > 0) {
    return err(RecoveryDiscoveryErrors.scopesMissing({ missing }));
  }
  return ok(true);
}

/**
 * Every conversation this bot token can actually read history from — each DM it holds plus each channel
 * it has genuinely joined — walked to cursor exhaustion across every discovery lane.
 *
 * A public channel the token merely has read-VISIBILITY of is discarded here, exactly as the scheduled
 * sweep discards it: `conversations.history` answers `not_in_channel` for one, so scanning it is pure
 * waste. Duplicate ids across lanes collapse to their first occurrence, preserving discovery order.
 *
 * Three things are part of the contract rather than incidental, each for the same reason — a coverage
 * claim must never be wider than what was read. The token's scopes are checked FIRST, because a walk
 * filtered by a missing scope exhausts cleanly and reports nothing. A failed walk yields no prefix. And
 * an empty result is returned as {@link DiscoveryFoundNothingError} rather than as success, because every
 * coverage count downstream is derived from this list and a zero would read as a complete pass over
 * nothing.
 *
 * @param api the Slack read seam, holding the BOT token — a user token answers about the wrong subject
 * @returns at least one readable conversation in discovery order, or the typed failure with no prefix
 */
export async function discoverRecoveryChannels({
  api,
}: {
  api: Pick<SlackApi, "grantedScopes" | "listChannels">;
}): Promise<Result<readonly SlackChannelRef[], RecoveryDiscoveryError>> {
  const scopes = await scopePreflight({ api });
  if (scopes.isErr()) {
    return err(scopes.error);
  }
  const discovery = await fetchCompleteSlackChannels({ api });
  if (discovery.isErr()) {
    return err(RecoveryDiscoveryErrors.walkFailed({ cause: discovery.error }));
  }
  const seen = new Set<string>();
  const readable: SlackChannelRef[] = [];
  for (const channel of actionableChannels({ channels: discovery.value.channels })) {
    if (seen.has(channel.id)) {
      continue;
    }
    seen.add(channel.id);
    readable.push(channel);
  }
  if (readable.length === 0) {
    return err(RecoveryDiscoveryErrors.foundNothing({ discovered: discovery.value.channels.length }));
  }
  return ok(readable);
}
