/*
 * A landing row's `humanWait` — the five facts `src/review/humanWait.ts` computes on a `blocked-on` row.
 *
 * Its own module so `./readLandingRow.ts` stays a reader of the row rather than of every nested shape in it. The
 * same rule holds here as there: a field the page's claim rests on that is PRESENT and unreadable refuses the
 * row, while an ABSENT `humanWait` is the verb saying the row is not waiting on a human (or a document from
 * before it said anything), and reads as `undefined`.
 */

import { type Bag, str, strings, sub } from "../../lib/bag";

/** The wait on one row, as the verb published it. */
export interface LandingWait {
  /** The verb's own next-act word — `name-the-reviewer`, `bump`, `ask`, `wait`, `wait-on-channel`, `read-the-messages`, `sync-slack`. */
  readonly next: string;
  /** The verb's own sentence for all five facts. */
  readonly sentence: string;
  readonly stale: string;
  readonly who: readonly string[];
  readonly requestedAtIso: string | undefined;
  readonly lastAskAtIso: string | undefined;
  readonly lastAskPermalink: string | undefined;
  /** The Slack watermark, in canonical UTC, on a `sync-slack` wait whose corpus is PROVEN behind; else absent. */
  readonly slackThroughIso: string | undefined;
}

/** Whether a string is an instant in exactly the form `toISOString` writes, which a real calendar date round-trips. */
function isCanonicalInstant({ iso }: { iso: string }): boolean {
  const ms = Date.parse(iso);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === iso;
}

/**
 * The row's wait.
 *
 * @param row one landing row as the document carries it
 * @returns the wait, `undefined` when the row carries none, or `null` when a present one is malformed
 */
export function humanWaitOf({ row }: { row: Bag }): LandingWait | undefined | null {
  if (row["humanWait"] === undefined || row["humanWait"] === null) {
    return undefined;
  }
  const held = sub({ bag: row, key: "humanWait" });
  if (held === undefined) {
    return null;
  }
  const next = str({ bag: held, key: "next" });
  const sentence = str({ bag: held, key: "sentence" });
  const stale = str({ bag: held, key: "stale" });
  const who = strings({ bag: held, key: "who" });
  if (next === undefined || sentence === undefined || stale === undefined || who === undefined) {
    return null;
  }
  const requestedAtIso = str({ bag: held, key: "requestedAtIso" });
  if (requestedAtIso === undefined && held["requestedAtIso"] !== undefined) {
    return null;
  }
  const slackThroughIso = str({ bag: held, key: "slackThroughIso" });
  if (slackThroughIso === undefined && held["slackThroughIso"] !== undefined) {
    return null;
  }
  // The seat prints this as the instant the history is stale since, and the verb publishes it only in canonical
  // UTC (`toISOString`), so anything else is refused with the row rather than drawn as a date — `Date.parse`
  // alone would take a 30th of February and print it as a day in March.
  if (slackThroughIso !== undefined && !isCanonicalInstant({ iso: slackThroughIso })) {
    return null;
  }
  let lastAskAtIso: string | undefined;
  let lastAskPermalink: string | undefined;
  if (held["lastAsk"] !== undefined) {
    const lastAsk = sub({ bag: held, key: "lastAsk" });
    if (lastAsk === undefined) {
      return null;
    }
    lastAskAtIso = str({ bag: lastAsk, key: "atIso" });
    lastAskPermalink = str({ bag: lastAsk, key: "permalink" });
    if (lastAskAtIso === undefined || lastAskPermalink === undefined) {
      return null;
    }
  }
  return {
    lastAskAtIso,
    lastAskPermalink,
    next,
    requestedAtIso,
    sentence,
    slackThroughIso,
    stale,
    who,
  };
}
