/**
 * The Slack threads the console voice has put on the owner's screen in one call, and the two things that record
 * decides: a thread it already showed them is never opened again, and a thread read that is NOT the one last in front
 * of them says so.
 *
 * Opening the same thread again is noise when the owner already has it in front of them, and a thread read that is
 * not the one on screen leaves the voice and the owner talking about different threads.
 *
 * Three calls (`open_card`, then `browser` twice) can each put a thread in front of the owner inside 53 s (MEASURED
 * from one call's file; repro: read lines 92-126 of
 * `$SLOPWEAVER_HOME/talk/calls/<call>.jsonl`), and the owner's first complaint arrives only in their NEXT turn. `browser` refuses a Slack message link, so a repeat
 * reaches `browser_open` or `open_card`, which is what this record guards. So the record is held for the whole call
 * the owner started (a reconnect or rollover keeps it), never one turn: a turn-long record would miss the repeat.
 *
 * Pure: `../components/voice/slackScreenVerb.ts` holds the value and does the opening.
 */
import { isBag, str } from "./bag";
import { threadKeyOf } from "./slackLink";

/** One thread put on the owner's screen: its key, the link it was opened by, and when. */
export interface ShownSlackThread {
  /** `<workspace>/<channel>:<root ts>`, the same for the root's link and any reply's. */
  readonly key: string;
  readonly url: string;
  readonly atIso: string;
}

/** Every thread put on the owner's screen this call, oldest first: the last is what is in front of the owner. */
export interface ThreadsShown {
  readonly threads: readonly ShownSlackThread[];
}

/** What `browser_open` answers, unrun, for a thread already in front of the owner: an answer, never a refusal. */
export interface AlreadyShownAnswer {
  readonly alreadyOnOwnerScreen: true;
  readonly url: string;
  readonly openedAtIso: string;
  readonly why: string;
}

/** A call that has put no thread on the owner's screen yet. */
export const NO_THREADS_SHOWN: ThreadsShown = { threads: [] };

/** What the voice is told when it asks to open a thread the owner already has. */
const ALREADY_SHOWN_WHY =
  "that Slack thread is already on the owner's screen from earlier in this call, so nothing was opened again; walk them " +
  "through it (read it whole with slack_open if you have not), and never open it again";

/** The workspace a Slack host is, its `<workspace>.slack.com` subdomain. */
const WORKSPACE = /^([a-z0-9-]+)\.slack\.com$/;

/** A `thread_ts` as Slack writes one, once the query is decoded. */
const THREAD_TS = /^[0-9]+\.[0-9]+$/;

/**
 * A link spelled the one way `threadKeyOf` reads, as the browser would resolve it: the host lowercased, the path's
 * escapes decoded and any trailing slash dropped, the query decoded down to its `thread_ts`, the fragment gone. So
 * `ACME.slack.com`, an escaped `thread_ts` value and a trailing `#` all name the thread the plain link names.
 *
 * @param link a link the voice passed
 * @returns the workspace and that spelling, or `undefined` for a link that is not https on a Slack workspace
 */
function canonicalSlackLink({ link }: { link: string }): { workspace: string; canonical: string } | undefined {
  const trimmed = link.trim();
  if (!URL.canParse(trimmed)) {
    return undefined;
  }
  const parsed = new URL(trimmed);
  const workspace = WORKSPACE.exec(parsed.hostname)?.at(1);
  if (parsed.protocol !== "https:" || workspace === undefined) {
    return undefined;
  }
  // A byte-wise decode never throws, unlike `decodeURIComponent`; whatever it makes of a non-ASCII escape is
  // refused by `threadKeyOf`'s own shape next.
  const path = parsed.pathname
    .replace(/%([0-9A-Fa-f]{2})/g, (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\/+$/, "");
  const threadTs = parsed.searchParams.get("thread_ts");
  const query = threadTs !== null && THREAD_TS.test(threadTs) ? `?thread_ts=${threadTs}` : "";
  return { canonical: `https://${parsed.hostname}${path}${query}`, workspace };
}

/**
 * The key one Slack link's thread is recorded under: its workspace, its channel and its root's ts, so a root's link
 * and a reply's link (`?thread_ts=`) are one thread however either is spelled, and the same channel and ts in another
 * workspace is another.
 *
 * @param link a link the voice passed
 * @returns `<workspace>/<channel>:<root ts>`, or `undefined` for anything that is not a Slack message link
 */
export function threadShownKey({ link }: { link: string }): string | undefined {
  const slack = canonicalSlackLink({ link });
  if (slack === undefined) {
    return undefined;
  }
  const thread = threadKeyOf({ link: slack.canonical });
  if (thread === undefined) {
    return undefined;
  }
  return `${slack.workspace}/${thread.channel}:${thread.threadTs}`;
}

/**
 * The opening of the thread a link names, when this call already put it on the owner's screen — the latest or one since
 * covered by another, which the owner's Slack app still holds all the same: opening it again is the same thread opened
 * over again either way.
 *
 * @param shown this call's record
 * @param url the link the voice passed
 * @returns the recorded opening, or `undefined` when the link is not a Slack thread or this call never showed it
 */
function shownOpening({ shown, url }: { shown: ThreadsShown; url: string }): ShownSlackThread | undefined {
  const key = threadShownKey({ link: url });
  if (key === undefined) {
    return undefined;
  }
  return shown.threads.find((thread) => thread.key === key);
}

/**
 * Whether this call already put the thread a link names on the owner's screen.
 *
 * @param shown this call's record
 * @param url the link the voice passed
 * @returns `true` only for a Slack thread this call already showed the owner
 */
export function shownBefore({ shown, url }: { shown: ThreadsShown; url: string }): boolean {
  return shownOpening({ shown, url }) !== undefined;
}

/**
 * The record after one thread was put on the owner's screen: it becomes the latest, and an earlier opening of the same
 * thread is dropped so each thread appears once. A link that is not a Slack thread changes nothing.
 *
 * @param shown this call's record
 * @param url the link the thread was opened by
 * @param atIso when it opened
 * @returns the new record
 */
export function noteThreadShown({
  shown,
  url,
  atIso,
}: {
  shown: ThreadsShown;
  url: string;
  atIso: string;
}): ThreadsShown {
  const key = threadShownKey({ link: url });
  if (key === undefined) {
    return shown;
  }
  const others = shown.threads.filter((thread) => thread.key !== key);
  return { threads: [...others, { atIso, key, url: url.trim() }] };
}

/**
 * The answer `browser_open` gives, without running, for a thread already on the owner's screen this call.
 *
 * @param shown this call's record
 * @param url the link the voice passed
 * @returns the answer, or `undefined` when the thread is not already shown and may be opened
 */
export function alreadyShownAnswer({
  shown,
  url,
}: {
  shown: ThreadsShown;
  url: string;
}): AlreadyShownAnswer | undefined {
  const opening = shownOpening({ shown, url });
  if (opening === undefined) {
    return undefined;
  }
  return { alreadyOnOwnerScreen: true, openedAtIso: opening.atIso, url: opening.url, why: ALREADY_SHOWN_WHY };
}

/**
 * The reason an answer is an {@link AlreadyShownAnswer}, or nothing: how `open_card` tells a thread it skipped from one
 * it opened. A lookalike without its reason is not one.
 *
 * @param answer whatever `browser_open` answered with
 * @returns the reason, or `undefined`
 */
export function alreadyShownWhy({ answer }: { answer: unknown }): string | undefined {
  if (!isBag(answer) || answer["alreadyOnOwnerScreen"] !== true) {
    return undefined;
  }
  return str({ bag: answer, key: "why" });
}

/**
 * What a `slack_open` answer adds when the thread it read is not the one last put on the owner's screen this call — the
 * case where the voice talks about one thread while the owner is looking at another.
 *
 * @param shown this call's record
 * @param url the link `slack_open` read
 * @returns the sentence, or `undefined` when nothing was put on the owner's screen, the link is not a Slack thread, or it is
 *   the thread in front of the owner
 */
export function otherThreadNotice({ shown, url }: { shown: ThreadsShown; url: string }): string | undefined {
  const key = threadShownKey({ link: url });
  const latest = shown.threads.at(-1);
  if (key === undefined || latest === undefined || latest.key === key) {
    return undefined;
  }
  return (
    `this is NOT the thread on the owner's screen: the one put in front of them in this call is ${latest.url}, opened at ` +
    `${latest.atIso}. Say which thread you are talking about before you talk about it, and never speak of this one as ` +
    "the one they are looking at"
  );
}
