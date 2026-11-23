/**
 * The join step of an as-me draft release: read whether they are in the channel, and when they are outside a PUBLIC one and
 * the row carries their yes, join it as them before the post, recording the join on the autonomy ledger as its own act.
 * The decision is `../../../outbound/slack/channelJoin.ts`'s; this is the read, the call and the record around it.
 *
 * It runs after every gate the approved words cross and before the send (`./releaseSend.ts`), so a release a gate
 * refuses never joins anything, and a join is never left behind by a release that was going to stop anyway.
 *
 * The record is the join's, never the send's: the send is their approved ask and is no row there (`skills/autonomy`),
 * while joining a channel as them is an act they never asked for by name, taken because it was the one step between their
 * yes and the send. A record that will not write does not stop the send — they are already in the channel by then, and
 * holding their approved words on a ledger fault would leave the join with neither its message nor its record — so it is
 * said loudly instead, with the command that records it by hand.
 */
import { buildAutonomyAction } from "../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { currentSessionIds } from "../../../handover/runOwner.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type ChannelAccess,
  type ChannelJoinError,
  ChannelJoinErrors,
  channelJoinDecision,
  channelLabel,
} from "../../../outbound/slack/channelJoin.js";
import type { ParkedSlackDraft } from "../../../outbound/slack/draftRegister.js";
import type { SlackDripOptions } from "./coreTypes.js";
import { heldRowOf } from "./releaseHeldRow.js";
import { appendReleaseHold } from "./releaseRefusalHold.js";
import type { SlackWriteDeps } from "./run.js";
import { journalSendFailure } from "./sendFailureJournalling.js";
import { usage } from "./writeOutput.js";

/** The autonomy kind every release join is recorded under. */
const RELEASE_JOIN_KIND = "slack-join-public-channel";

/** The line they read on their card for a join: what was done, to what, and why it mattered. */
const RELEASE_JOIN_SAID =
  "Joined a public channel as you, so a message you had approved could post there. Slack refuses a post from someone outside the channel.";

/**
 * The action id a release join is recorded under: one per channel and row, so a re-run after a crash appends nothing new.
 *
 * @param channel the channel joined
 * @param draftId the row whose release joined it
 * @returns the ledger id
 */
export function releaseJoinActionId({ channel, draftId }: { channel: string; draftId: string }): string {
  return `slack-join-${channel.toLowerCase()}-for-${draftId}`;
}

/**
 * Build the autonomy row for one release join. Pure.
 *
 * @param channel the channel joined
 * @param draft the row whose release joined it, carrying their yes
 * @param label how the channel is named in the fleet's note
 * @param nowIso when the join landed
 * @param bySession which session joined, as provenance
 * @param workspaceUrl `auth.test`'s workspace base, which the subject's link is built on
 * @returns the row, or why it will not build
 */
export function releaseJoinRow({
  bySession,
  channel,
  draft,
  label,
  nowIso,
  workspaceUrl,
}: {
  bySession: string;
  channel: string;
  draft: Pick<ParkedSlackDraft, "approval" | "id">;
  label: string;
  nowIso: string;
  workspaceUrl: string;
}): Result<AutonomyActionRow, string> {
  const base = workspaceUrl.endsWith("/") ? workspaceUrl : `${workspaceUrl}/`;
  let anchor = "an approval the row does not carry";
  if (draft.approval !== undefined) {
    anchor = draft.approval.anchor;
  }
  const built = buildAutonomyAction({
    actionId: releaseJoinActionId({ channel, draftId: draft.id }),
    bySession,
    doneIso: nowIso,
    kind: RELEASE_JOIN_KIND,
    run: undefined,
    said: RELEASE_JOIN_SAID,
    steer: undefined,
    subject: `${base}archives/${channel}`,
    why:
      `draft ${draft.id} carries their recorded yes (${anchor}); conversations.info read is_member false on the public ` +
      `channel ${label}, and chat.postMessage refuses a non-member not_in_channel, so joining was the one step ` +
      "between their yes and the send.",
    witness: `slopweaver slack post --as me --draft ${draft.id} -> conversations.join ${channel} ok (joined ${label})`,
  });
  return built.mapErr((error) => error.message);
}

/**
 * The join step as the release runs it, after every gate and before the send, which a non-member is refused
 * `not_in_channel` on: join when they are outside a public channel and the row carries their yes, or refuse before
 * anything posts. A throw is journalled and held like any other the release meets, over a yes that still stands.
 *
 * @param deps the injected world, for the membership read, the register, the join and `auth.test`
 * @param draft the row being released
 * @param drip the release's drip options, carrying its dry-run, `--json` and state home
 * @param token their user token, which the read and the join go out under
 * @returns the exit code a refused join ends the release on, or undefined when the release goes on to send
 */
export async function releaseJoinStep({
  deps,
  draft,
  drip,
  token,
}: {
  deps: Pick<
    SlackWriteDeps,
    "appendDraftEvent" | "autonomy" | "channelAccess" | "joinChannel" | "out" | "readDraftLog" | "whoAmI"
  >;
  draft: ParkedSlackDraft;
  drip: SlackDripOptions;
  token: string;
}): Promise<number | undefined> {
  let joined: Result<undefined, ChannelJoinError>;
  try {
    joined = await joinBeforeRelease({ deps, draft, dryRun: drip.dryRun, home: drip.home, json: drip.json, token });
  } catch (cause: unknown) {
    // A throw is journalled and held like any other the release meets, except that the hold, like a refusal's, waits on
    // Their yes as the register holds it now: a throw after the join (its own output line, say) must not write over a
    // yes they withdrew, nor over a register nobody could read.
    const why = `the release stopped on an error before sending: ${cause instanceof Error ? cause.message : String(cause)}`;
    journalAndHold({ deps, draft, drip, hold: true, why });
    throw cause;
  }
  if (joined.isErr()) {
    // A row without their yes already says so on the register, and its refusal names the approval it needs instead.
    journalAndHold({ deps, draft, drip, hold: joined.error.code !== "JOIN_NOT_APPROVED", why: joined.error.message });
    return usage({ errors: [joined.error.message] });
  }
  return undefined;
}

/**
 * Journal a release the join step stopped before anything posted, and hold the row `slack-refused` where asked and where
 * it still carries their yes, so their Queue card says why the yes did not go out. The yes is read off the row as it stands
 * NOW, never off the copy the release resolved: a withdrawn yes already says so on the register and a hold would write
 * over the one that withdrew it, and a private channel refuses before the decision ever asks.
 */
function journalAndHold({
  deps,
  draft,
  drip,
  hold,
  why,
}: {
  deps: Pick<SlackWriteDeps, "appendDraftEvent" | "readDraftLog">;
  draft: ParkedSlackDraft;
  drip: SlackDripOptions;
  hold: boolean;
  why: string;
}): void {
  journalSendFailure({ channel: draft.channel, errors: [why], options: drip, threadTs: draft.threadTs });
  if (hold && !drip.dryRun && rowNow({ deps, draft, home: drip.home }) === "approved") {
    appendReleaseHold({ deps, home: drip.home, id: draft.id, reason: "slack-refused", why });
  }
}

/**
 * The row being released as the register holds it now: still the same cut and carrying their yes, the same cut without
 * it, or moved. A register that will not read at all counts as moved, said as a warning, so nothing joins and no hold
 * is written over a row nobody could read; the send's own row-moved check reads it again and reports it on its own
 * terms.
 */
function rowNow({
  deps,
  draft,
  home,
}: {
  deps: Pick<SlackWriteDeps, "readDraftLog">;
  draft: ParkedSlackDraft;
  home: string;
}): "approved" | "moved" | "unapproved" {
  try {
    const now = heldRowOf({ deps, draftId: draft.id, home });
    if (now.isErr() || now.value.row.draft.digest !== draft.digest) {
      return "moved";
    }
    return now.value.row.draft.approval === undefined ? "unapproved" : "approved";
  } catch (cause: unknown) {
    logger.warn({
      msg: `could not re-read draft ${draft.id} off the register (${cause instanceof Error ? cause.message : String(cause)}), so it joins nothing and holds nothing`,
    });
    return "moved";
  }
}

/**
 * Join the channel a release posts into when they are outside it and the row carries their yes; refuse when it cannot be
 * joined, or they have not said yes; do nothing when they are already in.
 */
async function joinBeforeRelease({
  deps,
  draft,
  dryRun,
  home,
  json,
  token,
}: {
  deps: Pick<SlackWriteDeps, "autonomy" | "channelAccess" | "joinChannel" | "out" | "readDraftLog" | "whoAmI">;
  draft: ParkedSlackDraft;
  dryRun: boolean;
  home: string;
  json: boolean;
  token: string;
}): Promise<Result<undefined, ChannelJoinError>> {
  const say = ({ line }: { line: string }): void => {
    if (json) {
      logger.info({ msg: line });
      return;
    }
    deps.out(line);
  };
  const { channel } = draft;
  const access = await readAccess({ channel, deps, token });
  if (access === undefined) {
    return ok(undefined);
  }
  // Their yes is read off the row as it stands NOW, after the awaited gates and the membership read, never off the copy
  // the release resolved: a `not-owner-yes` hold folds the approval away and leaves the digest alone, so the stale copy
  // would join on a yes they have since withdrawn. A row that moved or vanished joins nothing, and the
  // row-moved check the send runs next refuses it with its own reason.
  const current = rowNow({ deps, draft, home });
  if (current === "moved") {
    return ok(undefined);
  }
  const decision = channelJoinDecision({ access, approved: current === "approved", channel, draftId: draft.id });
  if (decision.kind === "no-join") {
    return ok(undefined);
  }
  if (decision.kind === "refuse") {
    return err(decision.error);
  }
  const label = channelLabel({ channel, name: decision.name });
  if (dryRun) {
    say({ line: `would join ${label} as them first: they are not a member, and the row carries their yes` });
    return ok(undefined);
  }
  const joined = await dispatchJoin({ channel, deps, draft, home, label, token });
  if (joined.isErr()) {
    return err(joined.error);
  }
  if (joined.value === "already-member") {
    return ok(undefined);
  }
  say({ line: `joined ${label} as them: they were not a member, and their approved message posts there next` });
  await recordReleaseJoin({ channel, deps, draft, home, label, say, token });
  return ok(undefined);
}

/**
 * Read whether they are in the channel. A read that fails answers undefined, so it joins nothing and adds no refusal of
 * its own: the release goes on exactly as it did before a join existed, and the post either lands or is refused on its
 * own terms.
 */
async function readAccess({
  channel,
  deps,
  token,
}: {
  channel: string;
  deps: Pick<SlackWriteDeps, "channelAccess">;
  token: string;
}): Promise<ChannelAccess | undefined> {
  try {
    return await deps.channelAccess({ channel, token });
  } catch (cause: unknown) {
    logger.warn({
      msg: `could not read whether they are in ${channel} (${cause instanceof Error ? cause.message : String(cause)}), so nothing was joined`,
    });
    return undefined;
  }
}

/**
 * Send the join, re-reading their yes once more inside the request itself, after any rate-limit wait and with nothing
 * awaited before the dispatch, so a yes withdrawn while the join queued sends no join at all. The one
 * in-flight request is the window left, the same one `rowMovedBeforeSend` names for the send.
 */
async function dispatchJoin({
  channel,
  deps,
  draft,
  home,
  label,
  token,
}: {
  channel: string;
  deps: Pick<SlackWriteDeps, "joinChannel" | "readDraftLog">;
  draft: ParkedSlackDraft;
  home: string;
  label: string;
  token: string;
}): Promise<Result<"already-member" | "joined", ChannelJoinError>> {
  // Set by `confirm` from inside the request, so a plain `let` would read as never written to the type checker.
  const seen: { withdrawn: boolean } = { withdrawn: false };
  const confirm = (): boolean => {
    seen.withdrawn = rowNow({ deps, draft, home }) !== "approved";
    return !seen.withdrawn;
  };
  try {
    const joined = await deps.joinChannel({ channel, confirm, home, token });
    return ok(joined.alreadyMember ? "already-member" : "joined");
  } catch (cause: unknown) {
    // Re-read once more: a yes withdrawn while the request was in flight must not be held `slack-refused` over their
    // own hold. `confirm` re-reads the register and sets `seen.withdrawn` again.
    if (seen.withdrawn || !confirm()) {
      return err(ChannelJoinErrors.notApproved({ channel, draftId: draft.id, label }));
    }
    return err(ChannelJoinErrors.refused({ cause, channel, label }));
  }
}

/** Append the join's own autonomy row, or say loudly that it is not recorded and how to record it. */
async function recordReleaseJoin({
  channel,
  deps,
  draft,
  home,
  label,
  say,
  token,
}: {
  channel: string;
  deps: Pick<SlackWriteDeps, "autonomy" | "whoAmI">;
  draft: ParkedSlackDraft;
  home: string;
  label: string;
  say: (args: { line: string }) => void;
  token: string;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const actionId = releaseJoinActionId({ channel, draftId: draft.id });
  const unrecorded = ({ why }: { why: string }): void => {
    logger.error({
      msg:
        `joined ${label} as them, but the autonomy ledger did not record it (${why}). Record it: slopweaver autonomy ` +
        `record --action-id ${actionId} --kind ${RELEASE_JOIN_KIND} --subject <the channel's link> …`,
    });
  };
  // The join has already happened, so nothing in here may throw past it and stop their approved message:
  // the identity read, the row build and the append (whose operation lock can throw) all end in the same report.
  try {
    const { workspaceUrl } = await deps.whoAmI({ token });
    if (workspaceUrl === undefined) {
      unrecorded({ why: "auth.test named no workspace url to link the channel on" });
      return;
    }
    const sessions = currentSessionIds({ env: process.env });
    const row = releaseJoinRow({
      bySession: sessions.length === 0 ? "an unrecorded session" : sessions.join(", "),
      channel,
      draft,
      label,
      nowIso,
      workspaceUrl,
    });
    if (row.isErr()) {
      unrecorded({ why: row.error });
      return;
    }
    const written = await deps.autonomy.appendRecord({ home, record: row.value });
    if (written.isErr()) {
      unrecorded({ why: written.error.message });
      return;
    }
    say({ line: `  recorded the join as ${actionId}` });
  } catch (cause: unknown) {
    unrecorded({ why: cause instanceof Error ? cause.message : String(cause) });
  }
}
