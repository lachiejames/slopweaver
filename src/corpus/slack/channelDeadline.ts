/**
 * The per-conversation PROGRESS deadline the Slack crawl races each channel against.
 *
 * This exists because of a measured operational cost rather than a theory. Six sightings
 * (`slack-crawl-intermittent-silent-hang`) caught the crawl frozen inside one channel with every signal at
 * zero — 0.0% CPU, RSS not moving a byte, `lsof`/`nettop` showing no socket at all — and in the sharpest two
 * it had not even received a FIRST history page for that channel. Roughly one channel in fifteen to twenty,
 * which turned an unattended 603-channel backfill into a babysat one: a human noticed each hang, killed the
 * pass, rebuilt the channel allowlist without the hung id, and relaunched.
 *
 * ## Why PROGRESS rather than elapsed time
 *
 * A fixed per-channel wall-clock budget cannot work here, and the same doc says why: `#dev-alerts` and
 * `#daily-summaries` each looked identical to a hang for 5-7 minutes — flat RSS, flat bronze, flat watermark
 * — while genuinely working, because they were simply large. A channel has to be judged against its OWN
 * rate, so the only safe cut-off is "nothing at all happened for N minutes": a page received, a thread
 * polled or a batch banked all re-arm it, and a large-but-healthy conversation re-arms it hundreds of times.
 *
 * ## What an expiry may and may not do
 *
 * It abandons the conversation and NOTHING else. No watermark entry, no `fullHistory` entry, no summary, no
 * thread-cursor advance — so the channel still has no completion marker and the very next pass offers it a
 * full backfill again, with no human maintaining an exclusion list. Rows an earlier mid-conversation flush
 * already banked stay on disk, which is safe for exactly the reason that seam is narrow: a partial
 * commit carries neither `oldest` nor `maxTsIso`, so it cannot write the marker that would make a prefix
 * read as the whole channel.
 *
 * This does not fix the hang, and is not meant to. It removes the human from the loop and, because the skip
 * line names the PHASE the conversation was waiting in when it froze, it produces the one fact no sighting
 * so far could capture.
 */
import { type CoverageGap, coverageGap } from "../ingestJob.js";

/**
 * What a conversation's crawl was WAITING for when its deadline expired.
 *
 * `first-page` is kept apart from `history-page` deliberately: the two highest-confidence sightings never
 * received a first response at all, which places the block BEFORE the first `conversations.history` call for
 * that channel resolves — a much narrower claim than "stuck somewhere in the paging loop", and the
 * distinction is free to record here and unrecoverable afterwards.
 */
type ChannelCrawlPhase = "first-page" | "history-page" | "page-threads" | "known-threads";

/** One unit of forward motion, any of which re-arms the deadline. */
type ChannelProgressKind = "page" | "thread" | "flush";

/** Where a conversation had got to at the moment its deadline expired — the skip line's whole payload. */
export interface ChannelProgressSnapshot {
  /** What the crawl was awaiting when it froze. */
  readonly phase: ChannelCrawlPhase;
  /** Milliseconds since this conversation's crawl started. */
  readonly elapsedMs: number;
  /** Milliseconds since the last page, thread or flush — i.e. how long nothing at all happened. */
  readonly sinceProgressMs: number;
  /** History pages received for this conversation. */
  readonly pages: number;
  /** Threads polled for this conversation. */
  readonly threads: number;
  /** Messages + replies read so far, banked prefixes included. */
  readonly rows: number;
  /** The stall window this conversation was judged against, so a line read later says what the bar was. */
  readonly timeoutMs: number;
}

/** A live timer the deadline arms itself with. */
export interface DeadlineHandle {
  /** Re-arm from now. */
  readonly reset: () => void;
  /** Disarm for good; further `reset` calls do nothing. */
  readonly release: () => void;
}

/**
 * The timer seam. Injected so a test can trip a stall the instant it wants one, instead of sleeping —
 * a plain function passed in, which is what keeps the two required tests deterministic rather than timed.
 */
export type DeadlineTimer = (args: { onExpiry: () => void; timeoutMs: number }) => DeadlineHandle;

/** The watchdog for ONE conversation. */
export interface ChannelProgressDeadline {
  /**
   * Name the phase now being awaited. Called BEFORE the await, so an expiry reports where the crawl froze
   * rather than where it last succeeded.
   */
  readonly awaiting: (args: { phase: ChannelCrawlPhase }) => void;
  /** Record one unit of forward motion and re-arm. */
  readonly progressed: (args: { of: ChannelProgressKind; rows: number }) => void;
  /** Resolves ONLY on expiry; for a conversation that keeps moving it stays pending until `release`. */
  readonly expiry: Promise<ChannelProgressSnapshot>;
  /** Whether the deadline has already expired — the paging loops' cheap "stop, nobody is listening" check. */
  readonly abandoned: () => boolean;
  /** Disarm. MUST run however the conversation ends, or a finished run waits out one last timer. */
  readonly release: () => void;
}

/**
 * How the crawl arms ONE conversation's watchdog.
 *
 * A factory rather than a shared instance because a deadline carries per-conversation state, and a factory
 * rather than a number because it is also the seam a test trips a stall through — one injection point for
 * both, instead of a production knob plus a parallel test-only knob that can drift apart.
 */
export type ChannelDeadlineFactory = () => ChannelProgressDeadline;

/**
 * How long ONE conversation may make no progress at all before the crawl abandons it and moves on.
 *
 * Generous on purpose, and the margin is measured rather than guessed. MEASURED against the
 * live workspace, on a private channel that had twice been reported hung: over 190 seconds of real crawling
 * the deadline was re-armed 104 times, and the LONGEST gap with no page, thread or flush was **21.3s**
 * (median 0.39s, twelve gaps over 5s — the SDK absorbing 429s). So a healthy conversation on a rate-limited
 * connection sits ~28x inside this window. Every sighting of the real hang, by contrast, was frozen at
 * 11-14 minutes with nothing happening at all.
 *
 * A tighter number would start cutting off healthy channels for no gain, since an abandoned channel is
 * simply retried on the next pass — and the cost of a false skip is worse than it looks: the conversation is
 * re-read from scratch, so a run that mistimed this would make no forward progress at all.
 */
export const SLACK_CHANNEL_STALL_MS = 10 * 60_000;

/** The floor a configured stall window is clamped to — below this a healthy round-trip could trip it. */
export const MIN_SLACK_CHANNEL_STALL_MS = 1_000;

/**
 * Resolve the per-channel stall window from a raw `SLOPWEAVER_SLACK_STALL_MINUTES` value. Pure.
 *
 * Configurable because the right number depends on the network the crawl is on, and unparseable input falls
 * back to the default rather than refusing: a typo in an env var must not stop a backfill, and the resolved
 * value is reported on every skip line anyway.
 *
 * @param raw the raw env string, or undefined when unset
 * @returns the stall window in milliseconds, never below {@link MIN_SLACK_CHANNEL_STALL_MS}
 */
export function resolveChannelStallMs({ raw }: { raw: string | undefined }): number {
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return SLACK_CHANNEL_STALL_MS;
  }
  return Math.max(MIN_SLACK_CHANNEL_STALL_MS, Math.round(minutes * 60_000));
}

/**
 * The real, `setTimeout`-backed timer.
 *
 * Deliberately NOT `unref`'d. The whole point is that it fires on a process that has gone quiet, and an
 * unref'd timer is exactly the one the runtime is free to skip when nothing else is keeping the loop alive.
 * The cost of that choice is that `release` is mandatory, which is why every caller runs it in a `finally`.
 *
 * @param onExpiry what to run when the window elapses with no reset
 * @param timeoutMs the window
 * @returns the live handle
 */
export function setTimeoutDeadlineTimer({
  onExpiry,
  timeoutMs,
}: {
  onExpiry: () => void;
  timeoutMs: number;
}): DeadlineHandle {
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(onExpiry, timeoutMs);
  const clear = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return {
    release: clear,
    reset: () => {
      if (timer === undefined) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(onExpiry, timeoutMs);
    },
  };
}

/**
 * Arm a fresh progress deadline for one conversation.
 *
 * @param timeoutMs how long the conversation may make no progress before it is abandoned
 * @param timer the timer seam, defaulting to the real `setTimeout`-backed one
 * @param nowMs the clock, defaulting to `Date.now` — injected so a skip line's elapsed figures are exactly
 *   assertable in a test rather than whatever the machine happened to take
 * @returns the watchdog; the caller MUST `release` it however the conversation ends
 */
export function channelProgressDeadline({
  timeoutMs,
  timer = setTimeoutDeadlineTimer,
  nowMs = () => Date.now(),
}: {
  timeoutMs: number;
  timer?: DeadlineTimer;
  nowMs?: () => number;
}): ChannelProgressDeadline {
  const startedAtMs = nowMs();
  let lastProgressAtMs = startedAtMs;
  let phase: ChannelCrawlPhase = "first-page";
  let pages = 0;
  let threads = 0;
  let rows = 0;
  let expired = false;
  const snapshot = (): ChannelProgressSnapshot => {
    const at = nowMs();
    return {
      elapsedMs: at - startedAtMs,
      pages,
      phase,
      rows,
      sinceProgressMs: at - lastProgressAtMs,
      threads,
      timeoutMs,
    };
  };
  let expire: (at: ChannelProgressSnapshot) => void = () => undefined;
  const expiry = new Promise<ChannelProgressSnapshot>((resolve) => {
    expire = resolve;
  });
  const handle = timer({
    onExpiry: () => {
      expired = true;
      expire(snapshot());
    },
    timeoutMs,
  });
  return {
    abandoned: () => expired,
    awaiting: ({ phase: next }) => {
      phase = next;
    },
    expiry,
    progressed: ({ of, rows: read }) => {
      pages += of === "page" ? 1 : 0;
      threads += of === "thread" ? 1 : 0;
      rows = read;
      lastProgressAtMs = nowMs();
      handle.reset();
    },
    release: handle.release,
  };
}

/**
 * The structured line one abandoned conversation logs. Pure.
 *
 * Carries the channel ID and never its name: every other warning in this connector already identifies a
 * conversation by id, and a name is workspace-private in a way an opaque id is not. `phase` is the field
 * this whole change exists to produce — it is the one fact about the hang that no live sighting could
 * capture, and these lines are the dataset the root-cause work reads.
 *
 * @param channelId the abandoned conversation
 * @param at where its crawl had got to when the deadline expired
 * @returns the single skip line
 */
export function channelStallLine({ channelId, at }: { channelId: string; at: ChannelProgressSnapshot }): string {
  return [
    `slack channel ${channelId} ABANDONED: no page, thread or flush for ${String(at.sinceProgressMs)}ms`,
    `(window ${String(at.timeoutMs)}ms) while awaiting ${at.phase}`,
    `— elapsed=${String(at.elapsedMs)}ms pages=${String(at.pages)} threads=${String(at.threads)}`,
    `rows=${String(at.rows)}; no watermark and no fullHistory recorded, so the next pass retries it whole`,
  ].join(" ");
}

/**
 * The coverage gap one abandoned conversation reports to the ingest run. Pure.
 *
 * A gap rather than only the {@link channelStallLine} warning, and that is the whole fix for a measured
 * defect: with the warning alone the Slack lane stayed `ok`, so `refresh` exited 0 and a resync recorded
 * success over a corpus it had not refreshed (`refresh --source slack --lookback-days 2`). A
 * gap fails the source (`../ingestJob.ts` `CoverageGap`), and that half is unchanged.
 *
 * **It is `heldPerContainer`, and the claim that it was not wedging the lane is what a measurement killed.**
 * This gap used to hold the POOLED Slack cursor — one cursor for the whole workspace — on the reasoning that
 * the hang is intermittent rather than tied to a conversation. At hundreds of conversations something stalls
 * on nearly every pass, so the cursor stopped moving at all: MEASURED, `corpus/watermarks/slack.json`
 * read an instant hours behind the newest bronze row that morning's pass had written, and dozens of per-channel cursors stood past the pooled one.
 *
 * Holding it bought no coverage, which is the part worth stating rather than asserting: `workspaceCrawl.ts`'s
 * `abandonStalledChannel` records `skipped`, one warning and an `abandoned` entry and NOTHING else — no
 * summary, no `visited` entry, no `fullHistory`, no thread-cursor advance — and `./reach.ts#planChannelOldest`
 * then reads a channel from its OWN cursor "outright over the pooled window, in both directions", or from the
 * epoch when it has no entry. So what re-offers an abandoned conversation is its own untouched per-channel
 * state, never `window.since`. That is exactly the obligation {@link ../ingestJob.CoverageGap.heldPerContainer}
 * asks a lane to be able to name before it sets the flag.
 *
 * Identifies the conversation by id only, for the reason the warning does.
 *
 * @param channelId the abandoned conversation
 * @returns the gap, held by this channel's own watermark rather than by the workspace cursor
 */
export function channelStallGap({ channelId }: { channelId: string }): CoverageGap {
  return coverageGap({
    heldPerContainer: true,
    message: `slack channel ${channelId} was abandoned as stalled and not read this run; the next pass retries it whole`,
  });
}
