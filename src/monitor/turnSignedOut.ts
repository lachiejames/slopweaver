/**
 * `turn-signed-out` — a bot turn is blocked on a browser sign-in, so the one step is the owner's: log in there, now.
 *
 * Anything useful must be reachable before an answer is given, which can mean a floating note and a high-priority
 * queue card telling the owner to log into a named page right now. So a
 * `turn block --need sign-in --sign-in-url <url>` (`../cli/commands/turn/block.ts`) records the page's origin on the
 * block, and this monitor turns every turn still waiting on that origin into ONE floating work card — the
 * team-blocked tier the Queue draws first — with the page opened in the owner's work Chrome through the pin, exactly as
 * `resync-signed-out` does for a scheduled resync.
 *
 * ## Why a card the owner pressed Done on is HELD, not re-posted
 *
 * The owner's Done says they signed in; the turn stays blocked until the visible session that holds it runs
 * `turn unblock`. Between the two, a monitor that only re-read the block would post a fresh card over that Done. So a
 * subject whose
 * card was settled AT OR AFTER the newest block on its origin is held; a block entered after that is news.
 * {@link signInAnswered} is the same one rule `resync-signed-out` reads.
 *
 * ## Datadog and GitHub are the fleet's to sign in to
 *
 * The same rule applies to a turn exactly as to a resync: a wall on either is HELD until a
 * fresh `browser sign-in` look found the step genuinely the owner's ({@link fleetSignInHold}).
 *
 * Pure: the blocked asks, card history, the pin path, the sign-in looks and the clock in, a reading out.
 */
import type { SignInProbeRow } from "../browser/signInProbeStore.js";
import { isRecord } from "../lib/parsers.js";
import type { BlockedAsk } from "../live/turn/blockedOnHuman.js";

import {
  fleetSignInHold,
  hostOf,
  type SignInCardHistory,
  signInAnswered,
  signInSubjectKey,
} from "./resyncSignedOut.js";
import type { MonitorReading, MonitorSubject } from "./types.js";

/** The only event kinds that move a turn into or out of waiting on the owner — `blockedAsks` reads nothing else. */
const BLOCK_STATE_KINDS: ReadonlySet<unknown> = new Set(["blocked-on-human", "unblocked"]);

/**
 * Which of the ask-lifecycle log's unreadable lines could have hidden a block or its lift. A line that parses and
 * names any other kind cannot. MEASURED on the live log: 69 of 298 lines did not decode, every one
 * an older-schema `dispatched` row, so counting them all left this monitor permanently unmeasurable. Repro:
 * `slopweaver monitor check --only turn-signed-out --json`, before this filter. A line that is not JSON, or
 * names no kind, is still counted: nothing says what it was.
 *
 * @param text the log's contents
 * @param unreadable the 1-based line numbers the parser could not decode
 * @returns the subset that may have been a block or an unblock, in line order
 */
export function blockBearingUnreadable({
  text,
  unreadable,
}: {
  text: string;
  unreadable: readonly number[];
}): readonly number[] {
  const lines = text.split("\n");
  return unreadable.filter((lineNumber) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[lineNumber - 1]!);
    } catch {
      return true;
    }
    return !isRecord(parsed) || typeof parsed["kind"] !== "string" || BLOCK_STATE_KINDS.has(parsed["kind"]);
  });
}

/** One waiting turn blocked on a sign-in page this monitor can name. */
interface SignInBlock {
  readonly origin: string;
  readonly thread: string;
  readonly tsIso: string;
}

/**
 * Every turn still WAITING on a browser sign-in whose origin the block recorded. A cleared block owed a resume is
 * not the owner's to sign in to again, and a `--need sign-in` with no origin — a CLI login — names no page to open.
 *
 * @param asks every ask standing against the owner, from `../live/turn/blockedOnHuman.ts`'s `blockedAsks`
 * @returns the blocks, in the order given
 */
function signInBlocks({ asks }: { asks: readonly BlockedAsk[] }): readonly SignInBlock[] {
  const blocks: SignInBlock[] = [];
  for (const ask of asks) {
    const origin = ask.blocked.signInOrigin;
    if (ask.standing !== "waiting" || ask.blocked.need !== "sign-in" || origin === undefined) {
      continue;
    }
    blocks.push({ origin, thread: `${ask.channel}/${ask.threadTs}`, tsIso: ask.blocked.tsIso });
  }
  return blocks;
}

/**
 * Evaluate `turn-signed-out`: one subject per origin a waiting turn is blocked on, or clear.
 *
 * @param asks every ask standing against the owner
 * @param cards what the hand register holds about each subject key's cards
 * @param pinPath the pin shim the pass opens the origin through, or absent when none is written yet — then no page opens
 * @param blindSpot why part of the ask log could not be read, when so
 * @param probes every `browser sign-in` look, in written order — what decides whether a Datadog or GitHub wall is the owner's
 * @param nowIso the instant the pass judges a look's freshness at
 * @returns the reading
 */
export function evaluateTurnSignedOut({
  asks,
  cards,
  pinPath,
  blindSpot,
  probes,
  nowIso,
}: {
  asks: readonly BlockedAsk[];
  cards: ReadonlyMap<string, SignInCardHistory>;
  pinPath: string | undefined;
  blindSpot: string | undefined;
  probes: readonly SignInProbeRow[];
  nowIso: string;
}): MonitorReading {
  const byOrigin = new Map<string, SignInBlock[]>();
  for (const block of signInBlocks({ asks })) {
    const group = byOrigin.get(block.origin);
    if (group === undefined) {
      byOrigin.set(block.origin, [block]);
    } else {
      group.push(block);
    }
  }
  if (byOrigin.size === 0) {
    if (blindSpot !== undefined) {
      return { because: blindSpot, monitorId: "turn-signed-out", state: "unmeasurable" };
    }
    return { monitorId: "turn-signed-out", state: "clear" };
  }
  const subjects = [...byOrigin.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([origin, blocks]) => blockSubject({ blocks, cards, nowIso, origin, pinPath, probes }));
  return {
    monitorId: "turn-signed-out",
    state: "firing",
    subjects,
    ...(blindSpot === undefined ? {} : { blindSpot }),
  };
}

/** One origin's subject: the host the owner logs into, the threads waiting on it, and the page the pass opens for them. */
function blockSubject({
  blocks,
  cards,
  nowIso,
  origin,
  pinPath,
  probes,
}: {
  blocks: readonly SignInBlock[];
  cards: ReadonlyMap<string, SignInCardHistory>;
  nowIso: string;
  origin: string;
  pinPath: string | undefined;
  probes: readonly SignInProbeRow[];
}): MonitorSubject {
  const host = hostOf({ origin });
  const newestBlockIso = blocks
    .map((block) => block.tsIso)
    .toSorted()
    .at(-1)!;
  const answered = signInAnswered({ cards, origin, wallIso: newestBlockIso });
  const fleetHeld = fleetSignInHold({ nowIso, origin, probes });
  const count = blocks.length === 1 ? "1 bot turn is" : `${String(blocks.length)} bot turns are`;
  const base = {
    details: blocks.map((block) => `blocked since ${block.tsIso}: ${block.thread}`),
    id: host,
    key: signInSubjectKey({ origin }),
    label: `${count} blocked on ${host}'s sign-in page`,
    // Cited on the card whenever no window is opened on it, so the page it names is still one click away.
    page: origin,
  };
  if (!answered && fleetHeld !== undefined) {
    return { ...base, delivery: { kind: "hold", why: fleetHeld.why }, fleetPresses: fleetHeld.provider };
  }
  return {
    ...base,
    // Only with a pin to open it through: a page opened any other way may land in the owner's personal Chrome profile.
    ...(pinPath === undefined ? {} : { opens: origin }),
    ...(answered
      ? {
          delivery: {
            kind: "hold",
            why: `your card for ${host} was settled after the newest turn blocked on it — the session holding the turn unblocks it`,
          },
        }
      : {}),
  };
}
