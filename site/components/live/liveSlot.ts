"use client";

/*
 * The browser half of `site/lib/liveSlots.ts`: hold one of the origin's live-read slots for the length of a read.
 *
 * Two layers, in this order. First this tab's own `LiveReadQueue`, which admits at most `LIVE_READ_SLOTS` of its reads
 * at once, the page's primary content's first reads ahead of the rest, a first read and a press ahead of poll ticks,
 * waiting ticks one grant in every four, oldest first — Web
 * Locks have no priority, so the ordering has to happen before a read reaches them. Then the Web Locks, which every
 * tab of one origin shares and which are what bound the reads in flight across the whole origin; a tab that closes
 * gives its locks back, so a slot can never be stranded by a tab that went away mid-read. A read takes the first free
 * slot outright and otherwise waits on one, round-robin, so waiters spread over the slots rather than all queueing
 * behind the first. The tab's permit is held through both, so the most one tab keeps waiting on the locks is its own
 * `LIVE_READ_SLOTS`, never its whole backlog.
 */

import {
  LIVE_READ_SLOTS,
  type LiveReadPriority,
  liveSlotNames,
  openLiveReadQueue,
  queueLiveRead,
  releaseLiveRead,
} from "../../lib/liveSlots";

/** The slot names, computed once. */
const NAMES = liveSlotNames();

/** This tab's admission to the slots: one per renderer, never shared with another window. */
const local = openLiveReadQueue({ limit: LIVE_READ_SLOTS });

/** Which slot the next read that finds none free waits on. */
let turn = 0;

/** A lock request that found its slot taken. */
const TAKEN = Symbol("taken");

/**
 * Run one live read while holding a slot, released however the read ends: this tab's permit first, in its
 * priority's line, then one of the origin's locks.
 *
 * Where the browser has no lock manager the tab's permit is the only bound, and it bounds THIS tab alone: two such
 * tabs could hold twice {@link LIVE_READ_SLOTS} connections between them.
 *
 * @param line which line of this tab's queue the read waits in (`liveReadPriority`), asked again each time a slot
 *   comes back, so a channel the page joins as primary while its read waits moves the read up
 * @param run the read — its fetch and its body, both, since the body holds the connection until it is read
 * @returns what the read returned
 */
export async function withLiveSlot<T>({
  line,
  run,
}: {
  line: () => LiveReadPriority;
  run: () => Promise<T>;
}): Promise<T> {
  await new Promise<void>((grant) => {
    queueLiveRead({ grant, line, queue: local });
  });
  try {
    if (typeof navigator === "undefined" || !("locks" in navigator)) {
      return await run();
    }
    return await withOriginLock({ run });
  } finally {
    releaseLiveRead({ queue: local });
  }
}

/**
 * Hold one of the origin's lock-named slots for the read: the first free one outright, else wait on one round-robin.
 *
 * @param run the read
 * @returns what the read returned
 */
async function withOriginLock<T>({ run }: { run: () => Promise<T> }): Promise<T> {
  for (const name of NAMES) {
    const got = await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
      if (lock === null) {
        return TAKEN;
      }
      return { value: await run() };
    });
    if (got !== TAKEN) {
      return got.value;
    }
  }
  const name = NAMES[turn % NAMES.length];
  turn += 1;
  return navigator.locks.request(name, async () => run());
}
