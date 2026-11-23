/**
 * The Slack half of `tokenedJobs.ts` — fetch + project one crawl, plus the two commit seams that write bronze
 * (and mark channels backfilled) as the crawl goes rather than only at the end. Split out of `tokenedJobs.ts`
 * purely to keep that file under the file-size ratchet's line ceiling; no behaviour moves.
 */

import { createBronzeCommitter } from "../../../corpus/corpusWriter.js";
import type { CoverageGap } from "../../../corpus/ingestJob.js";
import type { SourceProgress } from "../../../corpus/progress.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import {
  type ChannelDeadlineFactory,
  channelProgressDeadline,
  channelStallGap,
  resolveChannelStallMs,
} from "../../../corpus/slack/channelDeadline.js";
import { readSlackChannelWatermarks } from "../../../corpus/slack/channelWatermark.js";
import {
  fetchSlackActivity,
  type SlackActivity,
  type SlackChannelCommit,
  type SlackChannelPartialCommit,
} from "../../../corpus/slack/fetch.js";
import { type SlackOwnerBotIdentity, slackOwnerBotIdentity } from "../../../corpus/slack/ownerBot.js";
import { projectSlackRecords, type SlackChannelItems } from "../../../corpus/slack/project.js";
import { readThreadCursors } from "../../../corpus/slack/threadCursors.js";
import type { SlackNameMaps } from "../../../corpus/slack/visibleProse.js";
import type { CorpusRecord, ExportWindow } from "../../../corpus/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { readProfile } from "../../../profileStore.js";
import { readSlackUsergroups, usergroupHandleMap } from "../../../silver/slackUsergroups.js";
import { markConversationBackfilled, persistSlackCursors } from "./slackCursorPersist.js";

/**
 * The watchdog factory a real refresh crawls with, its stall window read from the environment.
 *
 * Read HERE rather than inside the connector so the corpus layer keeps no env dependency of its own, and so
 * the window one run is judged against is decided in a single place. See `corpus/slack/channelDeadline.ts`
 * for why a conversation that stops making progress is abandoned rather than waited on.
 *
 * @returns the factory to hand the crawl
 */
function envChannelDeadline(): ChannelDeadlineFactory {
  const timeoutMs = resolveChannelStallMs({ raw: process.env["SLOPWEAVER_SLACK_STALL_MINUTES"] });
  return () => channelProgressDeadline({ timeoutMs });
}

/**
 * The usergroup id→handle map the corpus holds, spread-ready.
 *
 * Read from the structure rows a PREVIOUS refresh wrote, which is why it is resolved here rather than mid-
 * crawl: this run's own usergroup hydration has not happened yet when the message crawl starts, and a map
 * built from a half-finished pass would name some groups and not others within one projection. A store with
 * no usergroups contributes nothing at all, and every bare `<!subteam^S…>` renders as the generic `@group`
 * exactly as it did before — a visible non-answer rather than a wrong name.
 *
 * @param home the Slopweaver home the structure rows live under
 * @returns `{ usergroupHandles }` when the corpus holds any, or nothing
 */
function corpusUsergroupHandles({ home }: { home: string }): { usergroupHandles?: Readonly<Record<string, string>> } {
  const handles = usergroupHandleMap({ groups: readSlackUsergroups({ home }) });
  return Object.keys(handles).length === 0 ? {} : { usergroupHandles: handles };
}

/**
 * What the per-conversation committer wrote, projected and warned about. A bounded run builds no committer,
 * because it may not mark conversations backfilled, so it committed nothing per container and has nothing to
 * say about it.
 *
 * @param perChannel the per-conversation committer, absent on a bounded run
 * @returns the committer's totals and warnings, all empty on a bounded run
 */
function perContainerTotals({ perChannel }: { perChannel: ReturnType<typeof slackChannelCommitter> }): {
  written: number;
  projected: number;
  warnings: readonly string[];
} {
  if (perChannel === undefined) {
    return { projected: 0, warnings: [], written: 0 };
  }
  return { projected: perChannel.projected(), warnings: perChannel.warnings(), written: perChannel.written() };
}

/**
 * The ingest outcome, assembled from what the crawl produced and what the committer wrote.
 *
 * Split out of {@link ingestSlack} so the shell above stays the sequence of steps and this stays the shape
 * of what they produced.
 *
 * @param activity what the crawl returned
 * @param perChannel the per-conversation committer, absent on a bounded run
 * @param ownerBot the owner's own bot identity, resolved back to the owner in projection
 * @param bounded whether this run was capped, which decides whether cursors may be persisted
 * @param sampled whether this run read a sample rather than the whole window
 * @param home the Slopweaver home
 * @param window the export window
 * @param nowIso the clock every banked cursor is clamped to
 * @returns the records, the write stats, every warning, and one coverage gap per conversation abandoned as stalled
 */
function slackIngestResult({
  activity,
  perChannel,
  ownerBot,
  bounded,
  sampled,
  home,
  window,
  nowIso,
}: {
  activity: SlackActivity;
  perChannel: ReturnType<typeof slackChannelCommitter>;
  ownerBot: SlackOwnerBotIdentity | undefined;
  bounded: boolean;
  sampled: boolean;
  home: string;
  window: ExportWindow;
  nowIso: () => string;
}): {
  records: readonly CorpusRecord[];
  warnings: readonly string[];
  gaps: readonly CoverageGap[];
  committedPerContainer: number;
  projectedPerContainer: number;
  committedCursor?: string;
} {
  const perContainer = perContainerTotals({ perChannel });
  return {
    committedPerContainer: perContainer.written,
    gaps: activity.abandonedChannels.map((channel) => channelStallGap({ channelId: channel.id })),
    projectedPerContainer: perContainer.projected,
    records: projectSlackBulkRecords({ activity, ownerBot }),
    warnings: [
      ...persistSlackCursors({ activity, bounded, home, nowIso, sampled, until: window.until }),
      ...perContainer.warnings,
    ],
    // Why the crawl's own newest timestamp has to travel: see `SlackActivity.maxTsIso`.
    ...(activity.maxTsIso.length > 0 ? { committedCursor: activity.maxTsIso } : {}),
  };
}

/**
 * Fetch + project Slack activity into records. PR4.5: the owner's own bot identity (from `profile.json`,
 * when set) is resolved back to the owner in projection (me-to-me), and every record inherits its
 * channel's visibility via the projector's single stamp choke-point. Extracted to keep `sourceJob` lean.
 *
 * @returns the ingested records and their write stats, or the ingest failure
 */
// max-lines-exempt: one crawl reading and writing four cursor stores; each isolation decision is only readable beside the fetch it governs
export async function ingestSlack({
  token,
  window,
  slackChannels,
  home,
  progress,
  nowIso,
  sampled = false,
  cursorOverridden = false,
  fetchCap,
  cursorIsolated = false,
}: {
  token: string;
  window: ExportWindow;
  slackChannels: readonly string[];
  home: string;
  progress: { onProgress?: SourceProgress };
  /**
   * The clock every banked per-channel cursor is clamped to. Called PER WRITE rather than resolved once:
   * a full backfill crawl runs for hours, and a conversation finished at hour 30 has honestly been read to
   * hour 30 — pinning the whole run to its start instant would throw that coverage away and re-read it.
   */
  nowIso: () => string;
  sampled?: boolean;
  cursorOverridden?: boolean;
  fetchCap?: number;
  /**
   * This run is not the file corpus's crawl and must leave every resume store on disk untouched, in BOTH
   * directions — `store load` pulling into the Supabase store.
   *
   * A THIRD reason to withhold a cursor, beside `--sample` and `--fetch-cap`, and a different kind of
   * reason: those two describe a run that saw a PREFIX of its window, while this describes a run that is
   * not writing the files those cursors index at all. It is separate from `bounded` because a bounded run
   * still withholds only the CHANNEL watermark — MEASURED here, a `--fetch-cap`-only run wrote thread
   * cursors, since `persistSlackCursors` gates those on `sampled` alone. A Codex planning pass named that
   * exact line, and it is why this flag exists rather than reusing `bounded`.
   */
  cursorIsolated?: boolean;
}): Promise<
  Result<{
    records: readonly CorpusRecord[];
    warnings: readonly string[];
    gaps: readonly CoverageGap[];
    committedPerContainer: number;
    projectedPerContainer: number;
    committedCursor?: string;
  }>
> {
  const bounded = sampled || fetchCap !== undefined || cursorIsolated;
  // A corrupt profile refuses the crawl rather than reading as one with no bot: every record the owner's bot
  // wrote would otherwise be banked under the wrong identity, and the channel cursors would move past them.
  const profile = readProfile({ home });
  if (profile.isErr()) {
    return err([`${profile.error.message}. No Slack record was fetched.`]);
  }
  const ownerBot = slackOwnerBotIdentity({ slackBot: profile.value?.slackBot });
  const perChannel = slackChannelCommitter({ bounded, home, nowIso, ownerBot, window });
  const fetched = await fetchSlackActivity({
    api: makeSlackApi({ token }),
    channelDeadline: envChannelDeadline(),
    // An explicit `--since`/`--all`/`--lookback-days` is the request, so it also governs a channel that has
    // never been crawled: silently widening it to the epoch would answer a question nobody asked, and would
    // make a deliberately narrow probe run pull a whole workspace's history.
    // An isolated run withholds the backfill too, and that is not a detail: with the cursor maps empty
    // below, every channel looks never-crawled, so leaving this on would turn a seven-day store load into
    // an epoch-wide backfill of the whole workspace. The window is the request, and nothing widens it.
    backfillNewChannels: !cursorOverridden && !cursorIsolated,
    channelCursors: cursorIsolated ? new Map() : readSlackChannelWatermarks({ home }),
    threadCursors: cursorIsolated ? {} : readThreadCursors({ home }),
    window,
    ...progress,
    ...slackCommitSeams({ perChannel }),
    ...(slackChannels.length > 0 ? { channelFilter: slackChannels } : {}),
    ...(fetchCap !== undefined ? { maxItems: fetchCap } : {}),
    ...corpusUsergroupHandles({ home }),
  });
  if (fetched.isErr()) {
    return err([fetched.error.message]);
  }
  return ok(
    slackIngestResult({
      activity: fetched.value,
      bounded: bounded || cursorIsolated,
      home,
      nowIso,
      ownerBot,
      perChannel,
      sampled: sampled || cursorIsolated,
      window,
    }),
  );
}

/**
 * The crawl's two commit seams, spread-ready — both or neither, since a bounded run has no committer at all.
 *
 * @param perChannel the committer, absent on a bounded run
 * @returns the seams to spread into `fetchSlackActivity`, or nothing
 */
function slackCommitSeams({ perChannel }: { perChannel: ReturnType<typeof slackChannelCommitter> }): {
  onChannelCommit?: SlackChannelCommit;
  onChannelPartialCommit?: SlackChannelPartialCommit;
} {
  return perChannel === undefined
    ? {}
    : { onChannelCommit: perChannel.commit, onChannelPartialCommit: perChannel.commitPartial };
}

/**
 * Project the records the END-OF-RUN bulk write still has to carry. Pure.
 *
 * Only the conversations the crawl still HOLDS: a per-conversation commit already wrote the rest, and
 * re-projecting those just to have the write dedup them away is what kept a whole workspace of shaped items
 * in memory at once (see `../../../corpus/slack/fetch.SlackChannelSummary`). The curated surfaces are this
 * write's real contribution — they are fetched workspace-wide after the crawl, so no container commit covers
 * them — and they inherit their lane from EVERY crawled conversation, summary or retained, which is why both
 * lists are handed over as visibility signals.
 *
 * @param activity the completed crawl
 * @param ownerBot the owner's declared bot identity for me-to-me resolution, when set
 * @returns the records for the bulk write
 */
function projectSlackBulkRecords({
  activity,
  ownerBot,
}: {
  activity: SlackActivity;
  ownerBot: SlackOwnerBotIdentity | undefined;
}): readonly CorpusRecord[] {
  return projectSlackRecords({
    channels: activity.retainedChannels,
    crawledChannels: [...activity.channelSummaries, ...activity.retainedChannels],
    curated: activity.curated,
    maps: activity.maps,
    ...(ownerBot !== undefined ? { ownerBot } : {}),
  });
}

/**
 * The two commit seams for a Slack crawl: project ONE conversation (or one mid-crawl PREFIX of it), append it
 * to bronze, and — for a completed conversation only — mark that channel backfilled, all before the crawl
 * moves on to the next one.
 *
 * The split is the point. `commit` fires when a conversation has been read to the end and writes rows plus
 * the completion marker; `commitPartial` fires every
 * `corpus/slack/fetch.SLACK_CHANNEL_FLUSH_ITEMS` items inside one and writes rows ONLY, which is what lets a
 * conversation bigger than the heap reach disk at all.
 *
 * `undefined` for a BOUNDED run (`--sample`/`--fetch-cap`), which must stay on the write-once path. The reason
 * is the same one that already stops a bounded run persisting the per-channel store: the marker this writes is
 * the claim "this conversation is in bronze to the end", and a run that stopped mid-channel has not earned it.
 * A false marker is worse than none — it removes the channel from the coverage report's gap list permanently.
 *
 * The committer is created ONCE and reused, which is the difference between this being affordable and not:
 * it holds the dedup index open instead of rebuilding it from 361 MB of Slack bronze on every conversation.
 *
 * @param bounded whether `--sample`/`--fetch-cap` bounded the run
 * @param home the Slopweaver home
 * @param window the export window, which names the bronze file every commit appends to
 * @param ownerBot the owner's own bot identity, so a per-channel projection matches the final one exactly
 * @param nowIso the clock each conversation's banked cursor is clamped to, read as that conversation lands
 * @returns both commit seams plus running totals of what they wrote and what they were offered, or
 *   `undefined` for a bounded run
 */
export function slackChannelCommitter({
  bounded,
  home,
  window,
  ownerBot,
  nowIso,
}: {
  bounded: boolean;
  home: string;
  window: ExportWindow;
  ownerBot: SlackOwnerBotIdentity | undefined;
  nowIso: () => string;
}):
  | {
      commit: SlackChannelCommit;
      commitPartial: SlackChannelPartialCommit;
      written: () => number;
      projected: () => number;
      warnings: () => readonly string[];
    }
  | undefined {
  if (bounded) {
    return undefined;
  }
  // Created ONCE and closed over by both seams: it holds the dedup index open instead of rebuilding it from
  // the whole Slack bronze tree on every conversation, which is the difference between this being affordable
  // and not — and now, with a flush every batch, between affordable and hopeless.
  const committer = createBronzeCommitter({ home, window });
  const warnings: string[] = [];
  const spend = { offered: 0, written: 0 };
  const bank = ({ items, maps }: { items: SlackChannelItems; maps: SlackNameMaps }): Result<{ written: number }> =>
    bankSlackBatch({ committer, items, maps, ownerBot, spend });
  return {
    commit: ({ items, maps, maxTsIso, oldest, walkedMessages }) => {
      const wrote = bank({ items, maps });
      if (wrote.isErr()) {
        return wrote;
      }
      warnings.push(
        ...markerWarnings({
          channelId: items.channelId,
          home,
          maxTsIso,
          nowIso: nowIso(),
          oldest,
          until: window.until,
          ...(walkedMessages !== undefined ? { walkedMessages } : {}),
        }),
      );
      return wrote;
    },
    // Rows on disk and NOTHING else — no marker, no cursor, no visited entry. A prefix is not a backfill, and
    // the seam's own type is what makes that unrepresentable rather than merely observed here.
    commitPartial: bank,
    projected: () => spend.offered,
    warnings: () => warnings,
    written: () => spend.written,
  };
}

/**
 * Mark one completed conversation backfilled, reporting a failed marker as a WARNING rather than as a failed
 * commit: the records are already on disk, which is the durability the commit seam exists for, and the
 * end-of-crawl persist writes every marker again — so a transient failure here costs a re-read next run
 * rather than data.
 *
 * @param channelId the conversation just committed
 * @param home the Slopweaver home
 * @param maxTsIso the newest `tsIso` the whole conversation yielded, flushed prefix included
 * @param oldest the Slack `oldest` it was read from
 * @param until the window end, stored for a conversation that yielded no usable timestamp
 * @param nowIso the instant this conversation finished, which caps what its cursor may claim
 * @param walkedMessages top-level rows a COMPLETED history walk of this conversation was served, when it ran
 *   to the end of the channel
 * @returns nothing when the marker wrote, else one warning line
 */
function markerWarnings({
  channelId,
  home,
  maxTsIso,
  oldest,
  until,
  nowIso,
  walkedMessages,
}: {
  channelId: string;
  home: string;
  maxTsIso: string;
  oldest: string;
  until: string;
  nowIso: string;
  walkedMessages?: number;
}): readonly string[] {
  const marked = markConversationBackfilled({
    channelId,
    home,
    maxTsIso,
    nowIso,
    oldest,
    until,
    ...(walkedMessages !== undefined ? { walkedMessages } : {}),
  });
  return marked.isErr()
    ? [`channel ${channelId} committed but its backfill marker did not write: ${marked.error.message}`]
    : [];
}

/**
 * Project ONE batch — a whole conversation, or a mid-crawl prefix of one — and append it to bronze.
 *
 * Curated surfaces (pins, bookmarks, canvases) are deliberately NOT projected here: they are fetched once
 * after the whole crawl, from a workspace-wide lane rather than a per-channel one, which is why the
 * end-of-run bulk write still has something of its own to do. Everything else matches the final projection
 * field for field, so that write dedups this away exactly rather than appending twice.
 *
 * @param committer the open bronze committer, whose dedup index spans every batch this run banks
 * @param items the batch to write
 * @param maps the id→name maps built once for this refresh
 * @param ownerBot the owner's own bot identity, so this projection matches the final one exactly
 * @param spend the run's running totals, MUTATED
 * @returns how many rows this batch actually added, or the write errors
 */
function bankSlackBatch({
  committer,
  items,
  maps,
  ownerBot,
  spend,
}: {
  committer: ReturnType<typeof createBronzeCommitter>;
  items: SlackChannelItems;
  maps: SlackNameMaps;
  ownerBot: SlackOwnerBotIdentity | undefined;
  spend: { offered: number; written: number };
}): Result<{ written: number }> {
  const wrote = committer.commit({
    records: projectSlackRecords({ channels: [items], maps, ...(ownerBot !== undefined ? { ownerBot } : {}) }),
  });
  if (wrote.isErr()) {
    return err(wrote.error);
  }
  spend.written += wrote.value.written;
  spend.offered += wrote.value.written + wrote.value.deduped;
  return ok({ written: wrote.value.written });
}
