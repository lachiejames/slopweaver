/**
 * The injectable seam contract for `slopweaver refresh` — every effect the verb performs, named once.
 *
 * It lives in its own module because both the shell and the steps it delegates to (job planning, hydration)
 * are written against it: keeping it here means those modules depend on the CONTRACT rather than on the shell,
 * which is what lets the shell import them instead of the other way round.
 *
 * Several members are optional. That is deliberate and not laziness: each was added by a later PR, and an
 * optional seam means the test decks written before it need no edit to keep passing, so a seam being absent is
 * a supported state the code branches on rather than a hole.
 */

import type { calendarIngestJob } from "../../../corpus/calendar/ingest.js";
import type { chatgptIngestJob } from "../../../corpus/chatgpt/ingest.js";
import type { fathomIngestJob } from "../../../corpus/fathom/ingest.js";
import type { gmailIngestJob } from "../../../corpus/gmail/ingest.js";
import type { ingestSources } from "../../../corpus/ingestSource.js";
import type { outlookMailIngestJob } from "../../../corpus/outlook/ingest.js";
import type { outlookCalendarIngestJob } from "../../../corpus/outlookCalendar/ingest.js";
import type { SourceProgress } from "../../../corpus/progress.js";
import type { acquireRefreshSlot } from "../../../corpus/refreshSlot.js";
import type { selfIngestJob } from "../../../corpus/self/ingest.js";
import type { CorpusSource, ExportWindow } from "../../../corpus/types.js";
import type { Logger } from "../../../lib/logger.js";
import type { SyncRunRecorder } from "../../../syncRun/recorder.js";
import type { RefreshOptions, RefreshSummaryLine, TokenedSource } from "./core.js";
import type { githubJob, githubOrgJob } from "./githubJobs.js";
import type { MemberHydrationResult } from "./members.js";
import type { StoreIngestSource } from "./storeLeg.js";
import type { StructureHydrationResult } from "./structures.js";
import type { sourceJob } from "./tokenedJobs.js";
import type { MeasureVoice } from "./voiceLeg.js";

/** The injectable effectful seams the `refresh` shell composes (fakes in tests, production in `runRefresh`). */
export interface RefreshDeps {
  readonly nowDate: () => Date;
  readonly home: () => string;
  readonly resolveTokens: () => Readonly<Partial<Record<TokenedSource, string | undefined>>>;
  readonly slackReadToken: () => { token?: string; warning?: string };
  readonly buildGithubJob: typeof githubJob;
  /** GitHub ORG-MODE job builder (PR4.2) — optional so pre-PR4.2 test decks need no extra seam. */
  readonly buildGithubOrgJob?: typeof githubOrgJob;
  readonly buildSourceJob: typeof sourceJob;
  readonly readWatermark: (args: { home: string; source: CorpusSource }) => string | undefined;
  readonly ingestSources: typeof ingestSources;
  /** Member hydration for ONE source (PR4.1) — optional so pre-PR4.1 refresh tests need no extra seam. */
  readonly hydrateMember?: (args: {
    source: CorpusSource;
    home: string;
    fetchedAtIso: string;
    /**
     * The GitHub org to hydrate members for, ALREADY resolved by `resolveGithubOrg` — the same resolution
     * the structural lane uses. A repo slug used to be passed instead and the org derived from it here,
     * which is what let `--github-org` be honoured by one lane and ignored by the other.
     */
    githubOrg?: string;
  }) => Promise<MemberHydrationResult | undefined>;
  /** Structural hydration for ONE source (PR4.2) — optional so pre-PR4.2 test decks need no extra seam. */
  readonly hydrateStructure?: (args: {
    source: CorpusSource;
    home: string;
    fetchedAtIso: string;
    options: RefreshOptions;
  }) => Promise<StructureHydrationResult | undefined>;
  /**
   * The `self` ingest job builder — optional so pre-existing test decks need no extra seam, and injected so the
   * shell's ORDERING (roots resolved and refused before anything is scanned) is testable without a filesystem.
   */
  readonly buildSelfJob?: typeof selfIngestJob;
  /**
   * The `gmail` ingest job builder — optional for the same reason {@link buildSelfJob} is, and injected for a
   * second reason that only mail has: it is the seam that lets the lane's ORDER (crawl, commit, then anchor,
   * and no anchor at all after a gap) be tested against a fake mailbox rather than a real one.
   */
  readonly buildGmailJob?: typeof gmailIngestJob;
  /**
   * The `calendar` ingest job builder — optional and injected for the same reasons {@link buildGmailJob} is,
   * and separate from it because the two authenticate with different grants and crawl different APIs.
   */
  readonly buildCalendarJob?: typeof calendarIngestJob;
  /**
   * The `outlook-calendar` ingest job builder — optional and injected for the same reasons {@link buildCalendarJob}
   * is, and separate from it because it rides the Microsoft grant and holds modified-time anchors, not sync tokens.
   */
  readonly buildOutlookCalendarJob?: typeof outlookCalendarIngestJob;
  /**
   * The `outlook` mailbox ingest job builder — optional and injected for the same reasons {@link buildGmailJob}
   * is, and separate from it because it rides the Microsoft grant and holds a delta link per mail folder.
   */
  readonly buildOutlookMailJob?: typeof outlookMailIngestJob;
  /**
   * The `fathom` ingest job builder — optional and injected for the same reasons {@link buildCalendarJob} is.
   * Separate from both because it authenticates with a bare API key rather than an OAuth grant, and because
   * its credential is one no process here can obtain: the owner mints it by hand.
   */
  readonly buildFathomJob?: typeof fathomIngestJob;
  /**
   * The `chatgpt` ingest job builder — optional and injected for the same reasons {@link buildFathomJob} is. It
   * fetches nothing: it reads the newest export `chatgpt import-export` took in, whole.
   */
  readonly buildChatgptJob?: typeof chatgptIngestJob;
  /** Reads `SELF_ROOTS_ENV`. A seam, so root resolution is not a `process.env` read buried in a branch. */
  readonly selfRootsEnv?: () => string | undefined;
  /**
   * The post-ingest DERIVE lane — the second half of "couple refresh → derive by default", so the common case
   * never leaves silver behind bronze. Optional so the test decks written before it need no extra seam; in
   * production it runs the real derive pipeline in-process.
   */
  readonly derive?: (args: { home: string }) => Promise<{ ok: boolean; lines: readonly RefreshSummaryLine[] }>;
  /**
   * Take one source's just-in-time refresh slot — the `--jit` half of the freshness gate. Optional so every
   * test deck written before it needs no extra seam, and injected so a test never writes into the
   * machine-wide slot directory two vitest workers would share.
   */
  readonly acquireRefreshSlot?: typeof acquireRefreshSlot;
  /**
   * The `--store` leg: replay one source's bronze window files into the selected store. Optional so every
   * test deck written before it needs no extra seam, and injected so a test never opens a database; a run
   * that asked for `--store` with no seam wired is refused, never silently skipped.
   */
  readonly storeIngest?: StoreIngestSource;
  /**
   * Measure their voice length register from the Slack they sent, after a Slack ingest that succeeded
   * (`./voiceLeg.ts`). Optional so every test deck written before it needs no extra seam and opens no store; a
   * deck that wires none runs no voice leg, and production always wires it.
   */
  readonly measureVoice?: MeasureVoice;
  readonly logger: Pick<Logger, "error" | "info" | "out" | "warn">;
  readonly onProgress?: (p: { phase: string; label: string; done: number; total: number; written?: number }) => void;
  /** The connector-level streamed progress seam (PR4.4c) — per-channel/repo/page heartbeats + previews. */
  readonly sourceProgress?: SourceProgress;
  /**
   * Open this run's sync-run ledger (`../../../syncRun/recorder.ts`) — what the Automations page reads to say
   * what a sync found, per channel and repository, while it runs. Optional so every test deck written before it
   * needs no extra seam and writes no ledger; production opens one per run.
   */
  readonly openSyncRun?: (args: {
    home: string;
    jobs: readonly { source: CorpusSource; window: ExportWindow }[];
  }) => SyncRunRecorder;
}
