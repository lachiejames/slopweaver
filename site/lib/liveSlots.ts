/**
 * How many console reads may hold a connection at once, across every console tab, and in what order one tab's reads
 * reach them — pure, so the queue is a unit test.
 *
 * On a tab the owner already had open every sidebar item was a dead click, and on a fresh tab a
 * click showed nothing for one to three seconds. MEASURED on a production build
 * (`bash scripts/docs-site.sh --start`, then `--nav-timing`): one console tab, clicks landed in 272–3701 ms; four
 * console tabs in one browser, a click to Workstreams took 24 925 ms. Chrome gives one origin six
 * HTTP/1.1 connections, shared by EVERY tab of the profile, and every console page holds 13 `/api/live` reads at
 * load and ~10 more every twenty seconds, each 1–7 s (the board 22–33 s on the owner's machine) — the shell's own badges and
 * voice subscribe to most of them on every page. A click's navigation request queued behind them: issued at +60 ms,
 * answered at +2027 ms, for a page whose server render takes 3 ms. `liveQuiet.ts` met the same pool from the voice's
 * side.
 *
 * So the live reads share {@link LIVE_READ_SLOTS} slots across the whole origin — Web Locks, which every tab of one
 * origin shares — and the other connections stay free for what the owner clicks: the navigation, its prefetches, its
 * chunks, a press. Only the live route is gated; a press, a sync or the voice's own requests are never queued
 * behind a poll.
 *
 * Web Locks queue each name first come first served, with no priority, so a page's own first read used to join the
 * back of every poll tick already waiting. MEASURED on the real desktop app (`slopweaver desktop e2e`,
 * then `navigator.locks.query()` on `/alignment` after 20 s): all three slots held and ~48 lock requests pending,
 * ~37 from the main window and ~11 from the voice window, and the page's `alignment-board` read never left within
 * 30 s because the shell's twenty-second ticks kept refilling the queue ahead of it. So each tab puts a
 * {@link LiveReadQueue} in front of the locks: at most {@link LIVE_READ_SLOTS} of its reads are exposed to them at
 * once, a `foreground` read (a channel with nothing current drawn yet, or a press) goes ahead of a `poll`, and while polls
 * wait they get one grant in every `limit + 1`, oldest first, so no tick starves. The queue is
 * per tab — one window cannot reorder another's — so the voice window's reads already waiting on a lock stay ahead
 * of a later page read in the main window; the most any one window keeps waiting there is its own three.
 *
 * Among the reads that go ahead of a poll, a page's PRIMARY content goes first: the readings that decide what the page
 * holds, declared by the page (`useLive`'s `primary`), ahead of the shell's badges and the sidebar's first reads.
 * MEASURED on the desktop app's work-context Queue over a synthetic store (`slopweaver desktop e2e --context work
 * --only queue`): the Queue's held replies, review drafts and import questions had not answered 20s after the page
 * opened and its board read was still in flight at the 30s cap, while each verb alone answered in 1.8–2.8s
 * (`/usr/bin/time -p slopweaver queue list --json`), so the time went on waiting for one of the three slots. The
 * class is bounded: a channel's read is primary only until it draws a current reading, or for a press, so it can never
 * hold the other lines back past one read per primary channel. A read's line is asked again each time a slot is
 * handed back, so a read the shell queued on a channel the page then joined as primary moves up with it.
 */

/** Live reads in flight at once across every console tab: three of the origin's six connections, the rest the owner's. */
export const LIVE_READ_SLOTS = 3;

/**
 * The lock names the slots are held under, one per slot.
 *
 * @returns the names, `sw-live-0` upward
 */
export function liveSlotNames(): readonly string[] {
  return Array.from({ length: LIVE_READ_SLOTS }, (_, index) => `sw-live-${String(index)}`);
}

/**
 * Which line a read waits in: a first reading or a press on a channel the page's primary content reads, any other
 * first reading or press, or a refresh of a reading already drawn.
 */
export type LiveReadPriority = "primary" | "foreground" | "poll";

/**
 * Why a read was asked for: a mount, the channel's timer, a press, a re-read a server failure owed, or the read a
 * quiet hold owed once released.
 */
export type LiveReadCause = "mount" | "poll" | "press" | "retry" | "catch-up";

/** One read waiting for a slot: what grants it, and the line it is in, asked again each time a slot comes back. */
export interface LiveReadWaiter {
  readonly grant: () => void;
  readonly line: () => LiveReadPriority;
}

/**
 * One tab's admission to the live-read slots: how many of its reads are exposed to the locks, who waits, in the order
 * they asked, and how many primary or foreground reads have gone ahead of the oldest waiting poll.
 */
export interface LiveReadQueue {
  readonly limit: number;
  inUse: number;
  aheadGrantsWhilePollWaited: number;
  readonly waiting: LiveReadWaiter[];
}

/**
 * Which line a read is in. A press always goes ahead, because the owner is waiting on what they just wrote; any other read goes
 * ahead until its channel has drawn a CURRENT reading — one a read of this channel answered, or one handed over by a
 * channel another component keeps polled. A tick, a retry or a catch-up over a current reading is background work.
 *
 * A tile showing "loading" and a tile showing a reading kept from an earlier visit or saved by an earlier console
 * process are the same case: nothing current is on screen. MEASURED on the owner's `/fleet`:
 * "Why not more", "Plan usage" and the parked rows' wake all read "3.4h ago", the history's newest tick hours old,
 * each a reading the tab kept from its visit before (`liveRetained.ts`), while the ledger held readings of every one
 * from half an hour earlier
 * (`slopweaver reading list --producer "machine capacity"`). The mount's re-read of each waited in the poll line
 * behind every shell tick, so a figure hours old stood as the fleet's state.
 *
 * A read that goes ahead goes in the primary line when a page's primary content reads its channel, so the page's own
 * first readings are not queued behind the shell's. Never a tick over a current reading: that stays background work
 * whoever reads the channel, which is what bounds the primary line.
 *
 * @param hasCurrentReading whether a tile has drawn a reading this channel's own read answered (or a polled channel
 *   handed over as current), never a kept or saved one, whose age nothing bounds
 * @param primary whether a page's primary content reads the channel (`useLive`'s `primary`)
 * @returns the line to wait in
 */
export function liveReadPriority({
  cause,
  hasCurrentReading,
  primary,
}: {
  cause: LiveReadCause;
  hasCurrentReading: boolean;
  primary: boolean;
}): LiveReadPriority {
  if (cause !== "press" && hasCurrentReading) {
    return "poll";
  }
  if (primary) {
    return "primary";
  }
  return "foreground";
}

/**
 * Which waiting read a returned slot goes to, from each waiter's line in the order they asked. The oldest primary read
 * first, else the oldest foreground read — unless `limit` of either have already gone ahead of a waiting poll, when the
 * oldest poll does, so no tick starves.
 *
 * @param lines each waiter's line, oldest first
 * @param aheadGrantsWhilePollWaited how many primary or foreground reads have gone ahead of the oldest waiting poll
 * @param limit how many of them may go ahead of it
 * @returns the index of the waiter to grant, or `undefined` when nobody waits
 */
export function nextLiveReadWaiter({
  lines,
  aheadGrantsWhilePollWaited,
  limit,
}: {
  lines: readonly LiveReadPriority[];
  aheadGrantsWhilePollWaited: number;
  limit: number;
}): number | undefined {
  const poll = lines.indexOf("poll");
  const primary = lines.indexOf("primary");
  const ahead = primary >= 0 ? primary : lines.indexOf("foreground");
  if (poll >= 0 && (ahead < 0 || aheadGrantsWhilePollWaited >= limit)) {
    return poll;
  }
  if (ahead >= 0) {
    return ahead;
  }
  return undefined;
}

/**
 * A queue nobody holds a slot in.
 *
 * @param limit how many of this tab's reads may be exposed to the locks at once, and how many primary or foreground
 *   grants may pass a waiting poll
 * @returns the queue
 */
export function openLiveReadQueue({ limit }: { limit: number }): LiveReadQueue {
  return { aheadGrantsWhilePollWaited: 0, inUse: 0, limit, waiting: [] };
}

/**
 * Ask for a slot: granted now when one is free, else queued until one is handed back to it.
 *
 * @param queue the tab's queue
 * @param grant called once the slot is this caller's
 * @param line which line the read waits in, asked each time a slot comes back
 */
export function queueLiveRead({
  grant,
  line,
  queue,
}: {
  grant: () => void;
  line: () => LiveReadPriority;
  queue: LiveReadQueue;
}): void {
  if (queue.inUse < queue.limit) {
    queue.inUse += 1;
    grant();
    return;
  }
  queue.waiting.push({ grant, line });
}

/**
 * Hand a slot back: straight to the next waiter when there is one ({@link nextLiveReadWaiter}), so the count never
 * dips between them, and the count of reads gone ahead of a waiting poll starts again once a poll has its slot. With
 * nobody waiting the slot is freed.
 *
 * @param queue the tab's queue
 */
export function releaseLiveRead({ queue }: { queue: LiveReadQueue }): void {
  const lines = queue.waiting.map((waiter) => waiter.line());
  const at = nextLiveReadWaiter({
    aheadGrantsWhilePollWaited: queue.aheadGrantsWhilePollWaited,
    limit: queue.limit,
    lines,
  });
  if (at === undefined) {
    queue.aheadGrantsWhilePollWaited = 0;
    queue.inUse -= 1;
    return;
  }
  if (lines[at] !== "poll" && lines.includes("poll")) {
    queue.aheadGrantsWhilePollWaited += 1;
  } else {
    queue.aheadGrantsWhilePollWaited = 0;
  }
  // `at` indexes `lines`, which mapped `waiting` one to one, so a waiter is there.
  const next = queue.waiting.splice(at, 1)[0];
  next.grant();
}
