/**
 * Slack / Linear / Notion fetch orchestration for `slopweaver refresh` — the three token-gated sources.
 *
 * Each `ingest*` function is the connector's fetch + projection pair plus whatever SIBLING STORE the source
 * fills (Slack's thread cursors, Linear's activity history), and `sourceJob` wraps the selected one as a
 * `SourceIngestJob` so the shell treats all four sources alike.
 *
 * The recurring rule across all three: a bounded run (`--sample`, `--fetch-cap`) must not move a cursor, and
 * a store that fills up invisibly is worse than one that never fills — so what could not be read or written
 * is reported through `notes`/`warnings` rather than left silent.
 *
 * Extracted from the `refresh` shell so the shell composes jobs rather than knowing how each provider is
 * crawled. Slack and Notion's own connector pairs live in the siblings {@link ./tokenedJobsSlack} and
 * {@link ./tokenedJobsNotion}, Notion's run notes in {@link ./tokenedJobsNotionNotes} — split out purely to
 * keep this file under the file-size ratchet's line ceiling; every symbol this file used to export directly
 * still resolves from this same path.
 */

import type { CoverageGap, SourceIngestJob } from "../../../corpus/ingestJob.js";
import { fetchLinearActivity, fetchLinearReferences, makeLinearApi } from "../../../corpus/linear/fetch.js";
import { type LinearTransportStats, sharedLinearTransport } from "../../../corpus/linear/transport.js";
import type { NotionCaptureCaps } from "../../../corpus/notion/caps.js";
import type { SourceProgress } from "../../../corpus/progress.js";
import type { CorpusRecord, ExportWindow } from "../../../corpus/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { TokenedSource } from "./core.js";
import { linearCommitSeam, linearIngestResult, linearPageCommitter } from "./tokenedJobsLinear.js";
import { ingestNotion } from "./tokenedJobsNotion.js";
import { ingestSlack } from "./tokenedJobsSlack.js";

export { flushNotionBatch } from "./tokenedJobsNotion.js";
export { notionDurabilityNotes } from "./tokenedJobsNotionNotes.js";
export { slackChannelCommitter } from "./tokenedJobsSlack.js";

/**
 * Fetch + project Linear activity, and write its ACTIVITY HISTORY to the sibling history store.
 *
 * The history write happens here rather than inside the connector because `refresh` is the only writer into
 * the corpus, and it is reported through the `notes` channel rather than left silent: a store that fills up
 * invisibly is indistinguishable from one that never fills at all, which is the defect class this repo cares
 * most about. A history-write failure, like a lane that did not arrive whole, is a COVERAGE GAP — not fatal to
 * the write, since the records that did arrive are still worth committing, but the source fails and its cursor
 * holds, so the events are re-fetched on the issue page next pass. See `linearIngestResult` for why.
 *
 * The events are deliberately NOT projected into records. See {@link ../../../corpus/history/types} for the
 * ranking argument.
 */
async function ingestLinear({
  token,
  window,
  home,
  onProgress,
  fetchCap,
  sampled = false,
  cursorIsolated = false,
}: {
  token: string;
  window: ExportWindow;
  home: string;
  onProgress?: SourceProgress;
  fetchCap?: number;
  sampled?: boolean;
  cursorIsolated?: boolean;
}): Promise<
  Result<{
    records: readonly CorpusRecord[];
    warnings: readonly string[];
    notes: readonly string[];
    gaps: readonly CoverageGap[];
    committedPerContainer: number;
    projectedPerContainer: number;
    committedCursor?: string;
  }>
> {
  const transport = sharedLinearTransport({ token });
  const perPage = linearPageCommitter({
    bounded: sampled || fetchCap !== undefined,
    cursorIsolated,
    home,
    window,
  });
  // The REFERENCE pass runs first, and every lane after it depends on having done so: `@linear/sdk`'s
  // fragments carry each relation as a bare `{ id }`, and this is what turns those ids back into the names a
  // record's attrs are indexed on. MEASURED 51 requests and 92,136 complexity points for the whole pass —
  // 2% of the hourly request budget — see `corpus/linear/references.ts`.
  const referenced = await fetchLinearReferences({ request: transport.request });
  const fetched = await fetchLinearActivity({
    api: makeLinearApi({ references: referenced.references, request: transport.request }),
    window,
    ...(onProgress !== undefined ? { onProgress } : {}),
    ...(fetchCap !== undefined ? { maxItems: fetchCap } : {}),
    ...linearCommitSeam({ committer: perPage }),
  });
  if (fetched.isErr()) {
    return err([fetched.error.message]);
  }
  return ok(
    linearIngestResult({
      activity: fetched.value,
      cursorIsolated,
      home,
      referencedWarnings: referenced.warnings,
      spendNote: linearSpendNote({ stats: transport.stats() }),
      tally: perPage?.tally(),
    }),
  );
}

/**
 * What the Linear crawl actually SPENT, from the transport's own observation rather than an inference.
 *
 * Requests and complexity are separate budgets (2,500/hr and 3,000,000/hr), and complexity tracks the size of
 * the NESTED connections rather than the outer page size — so a request count cannot be converted into a
 * complexity spend, and a much fatter selection can be cheap in one and expensive in the other. Numbers only:
 * this line is safe to paste as proof.
 */
function linearSpendNote({ stats }: { stats: LinearTransportStats }): string {
  const seconds = Math.round(stats.latencyMs / 1000);
  const megabytes = (stats.bytes / 1_048_576).toFixed(1);
  const unpriced = stats.unpricedResponses > 0 ? `, ${String(stats.unpricedResponses)} unpriced` : "";
  return `spend: ${String(stats.requests)} request(s), ${String(stats.complexity)} complexity${unpriced}, ${megabytes} MB, ${String(seconds)}s in-flight`;
}

/**
 * The per-source dispatch `sourceJob`'s `run()` closure delegates to — extracted to keep that shell lean.
 *
 * @param source which tokened source to fetch
 * @param token that source's already-resolved token
 * @param window the export window to fetch
 * @param slackChannels the `--slack-channel` filter (Slack only; empty means every visible channel)
 * @param home the Slopweaver home, which holds the sibling stores
 * @param progress the optional connector-level progress sink, already wrapped for spreading
 * @param nowIso the clock Slack's per-channel cursors are clamped to (Slack only; every other source
 *   here banks a cursor nothing reads back as a floor)
 * @param sampled whether `--sample` bounded the run, so no secondary cursor may be persisted
 * @param cursorOverridden whether an explicit window flag beat the stored cursor (Slack: the window then
 *   governs a never-crawled channel too, instead of the epoch backfill)
 * @param fetchCap the `--fetch-cap` item ceiling, if any
 * @param refetchUnchanged whether `--refetch-unchanged` disabled Notion's already-held-unchanged skip
 * @param withAttachments whether this Notion run fetches attachment bytes (`--no-notion-attachments` withholds them)
 * @param notionCaps the per-item depth/request/time bounds the Notion capture runs under (Notion only)
 * @returns the fetch outcome for whichever source was selected
 */
// max-lines-exempt: a per-source dispatch whose whole body is one branch per source; a split would put a source's arguments away from its branch
async function runSourceJob({
  source,
  token,
  window,
  slackChannels,
  home,
  progress,
  nowIso,
  sampled,
  cursorOverridden,
  fetchCap,
  refetchUnchanged,
  withAttachments,
  notionCaps,
  cursorIsolated,
}: {
  source: TokenedSource;
  token: string;
  window: ExportWindow;
  slackChannels: readonly string[];
  home: string;
  progress: { onProgress?: SourceProgress };
  nowIso: () => string;
  sampled: boolean;
  cursorOverridden: boolean;
  fetchCap?: number;
  refetchUnchanged?: boolean;
  withAttachments?: boolean;
  notionCaps?: NotionCaptureCaps;
  cursorIsolated: boolean;
}): Promise<
  Result<{
    records: readonly CorpusRecord[];
    warnings: readonly string[];
    notes?: readonly string[];
    gaps?: readonly CoverageGap[];
    committedPerContainer?: number;
    // Declared beside `committedPerContainer` rather than left to widen from a branch: a lane that reports
    // one and not the other is read as an EMPTY run by `ingestSource.ingestOneWithDeps`, which then
    // advances its cursor to the window end over records it did commit.
    projectedPerContainer?: number;
    committedCursor?: string;
  }>
> {
  switch (source) {
    case "slack":
      return ingestSlack({
        cursorIsolated,
        cursorOverridden,
        home,
        nowIso,
        progress,
        sampled,
        slackChannels,
        token,
        window,
        ...(fetchCap !== undefined ? { fetchCap } : {}),
      });
    case "linear":
      return ingestLinear({
        cursorIsolated,
        home,
        sampled,
        token,
        window,
        ...progress,
        ...(fetchCap !== undefined ? { fetchCap } : {}),
      });
    case "notion":
      return ingestNotion({
        home,
        token,
        window,
        ...progress,
        ...notionOnlyArgs({ fetchCap, notionCaps, refetchUnchanged, withAttachments }),
      });
    default: {
      // TokenedSource is derived from the registry: a new member fails to compile here, never ingests as Notion.
      const unhandled: never = source;
      return unhandled;
    }
  }
}

/**
 * The Notion-only arguments, each omitted when the caller did not set it.
 *
 * Under `exactOptionalPropertyTypes` an unset option has to be ABSENT rather than `undefined`, so each one
 * needs its own conditional spread. Four of those inline made `runSourceJob` about its last branch instead
 * of about choosing a source.
 *
 * @returns the subset of `ingestNotion`'s options this call actually sets
 */
function notionOnlyArgs({
  fetchCap,
  refetchUnchanged,
  withAttachments,
  notionCaps,
}: {
  fetchCap: number | undefined;
  refetchUnchanged: boolean | undefined;
  withAttachments: boolean | undefined;
  notionCaps: NotionCaptureCaps | undefined;
}): { fetchCap?: number; refetchUnchanged?: boolean; withAttachments?: boolean; caps?: NotionCaptureCaps } {
  return {
    ...(fetchCap !== undefined ? { fetchCap } : {}),
    ...(refetchUnchanged !== undefined ? { refetchUnchanged } : {}),
    ...(withAttachments !== undefined ? { withAttachments } : {}),
    ...(notionCaps !== undefined ? { caps: notionCaps } : {}),
  };
}

/**
 * Build a Slack/Linear/Notion job from its token + window (token presence checked by the caller).
 *
 * @param source which tokened source to build
 * @param token that source's already-resolved token
 * @param window the export window to fetch
 * @param slackChannels the `--slack-channel` filter (Slack only; empty means every visible channel)
 * @param home the Slopweaver home, which holds the sibling stores
 * @param onProgress the optional connector-level progress sink
 * @param nowIso the clock Slack's per-channel cursors are clamped to — injected so a test can pin it
 * @param sampled whether `--sample` bounded the run, so no secondary cursor may be persisted
 * @param cursorOverridden whether an explicit window flag beat the stored cursor (Slack: the window then
 *   governs a never-crawled channel too, instead of the epoch backfill)
 * @param fetchCap the `--fetch-cap` item ceiling, if any
 * @param refetchUnchanged whether `--refetch-unchanged` disabled Notion's already-held-unchanged skip
 * @param withAttachments whether this Notion run fetches attachment bytes (`--no-notion-attachments` withholds them)
 * @param notionCaps the per-item depth/request/time bounds the Notion capture runs under (Notion only)
 * @returns the source job
 */
export function sourceJob({
  source,
  token,
  window,
  slackChannels,
  home,
  onProgress,
  nowIso,
  sampled = false,
  cursorOverridden = false,
  fetchCap,
  refetchUnchanged,
  withAttachments,
  notionCaps,
  cursorIsolated = false,
}: {
  source: TokenedSource;
  token: string;
  window: ExportWindow;
  slackChannels: readonly string[];
  home: string;
  onProgress?: SourceProgress;
  nowIso: () => string;
  sampled?: boolean;
  cursorOverridden?: boolean;
  fetchCap?: number;
  refetchUnchanged?: boolean;
  withAttachments?: boolean;
  notionCaps?: NotionCaptureCaps;
  /**
   * This run pulls into the Supabase store, not into bronze, so every cursor store on disk is read as
   * empty and written not at all. See {@link ./tokenedJobsSlack.ingestSlack} for what it withholds per
   * source and why it is not the same thing as `sampled` or `fetchCap`.
   */
  cursorIsolated?: boolean;
}): SourceIngestJob {
  const progress = onProgress !== undefined ? { onProgress } : {};
  const run = (): ReturnType<typeof runSourceJob> =>
    runSourceJob({
      cursorIsolated,
      cursorOverridden,
      home,
      nowIso,
      progress,
      sampled,
      slackChannels,
      source,
      token,
      window,
      ...(fetchCap !== undefined ? { fetchCap } : {}),
      ...(refetchUnchanged !== undefined ? { refetchUnchanged } : {}),
      ...(withAttachments !== undefined ? { withAttachments } : {}),
      ...(notionCaps !== undefined ? { notionCaps } : {}),
    });
  return { label: source, run, source, window };
}
