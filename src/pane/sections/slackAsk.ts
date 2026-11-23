/**
 * The SLACK half of "what is blocked, and on whom".
 *
 * ## Why this exists at all
 *
 * GitHub's `reviewRequests` field is not how the owner is actually asked to review, and it is not how the owner asks
 * anyone else: the owner only reviews what they are tagged for in Slack and never reads GitHub notifications. So a board that computes "blocked on a person" from `reviewRequests` alone
 * is reading a formality. The ask happens in Slack, which means the honest answer is a JOIN.
 *
 * ## What this module does NOT claim
 *
 * It records that a message **linked a pull request and named at least one person**. That is all it can see,
 * and it is deliberately less than "a review was requested". Inferring intent from a link plus a mention would
 * be a guess wearing a measurement's clothes, so every sentence this produces says "raised with", never "asked
 * to review". A row that overstates what a message meant is exactly the confident-but-wrong row the console
 * exists to prevent.
 *
 * The classifier half is pure; {@link gatherAsks} is the thin effectful shell that feeds it.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseRow } from "../../corpus/corpusRowCore.js";
import { readJsonlLines } from "../../corpus/corpusStore.js";
import type { CorpusRecord } from "../../corpus/types.js";
import { type Measured, measured, unmeasurable } from "../../measurement/status.js";
import { slackHaystack } from "../../review/prLink.js";
import { stateHomePaths } from "../../stateHome.js";

/**
 * One message in which the owner linked a pull request and named somebody.
 *
 * `named` holds the raw labels the message carried — Slack ids, handles, or `@`-prefixed text. They are NOT
 * resolved to GitHub logins here: that join needs an identity decision the owner has scoped to a suggestion they
 * approve, never to something written back, so this module keeps the labels as they were written.
 */
export interface SlackAsk {
  /** The pull-request URL this message linked, exactly as matched. */
  readonly prUrl: string;
  /** When the message was posted. */
  readonly atIso: string;
  /** A link back to the message, so every claim on a row is checkable. */
  readonly permalink: string;
  /** The labels the message named, verbatim. Empty when it linked the pull request and named nobody. */
  readonly named: readonly string[];
  /**
   * Who posted it, as the corpus recorded them.
   *
   * Carried because this module must NOT say "you raised it": a teammate posting the same link produces an
   * identical record, and the owner's own bot is rewritten to the owner's user id at projection time, so neither the
   * author field nor its absence proves the owner typed it. The row names the author instead of assuming one.
   */
  readonly author: string;
}

/** A Slack mention run as the corpus stores it, plus the bare `@handle` spelling that pings nobody. */
const MENTION = /<@([A-Z0-9]+)>|(?:^|\s)@([a-z0-9][a-z0-9._-]{0,40})/gi;

/**
 * Every label a message names.
 *
 * Both spellings are kept because both are things the owner types: a real mention run (`<@U…>`) and a bare
 * `@handle`, which Slack renders as plain text and which pings nobody. The second is deliberately included —
 * for THIS purpose the question is "did the owner raise it with someone", and a message naming a person without
 * pinging them still did that. It is a different question from whether the person was notified.
 *
 * @param text the message body as the corpus stored it
 * @returns the labels named, in first-seen order, without duplicates
 */
export function namedIn({ text }: { text: string }): readonly string[] {
  const found: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const [, label = match[2]] = match;
    if (label !== undefined && !found.includes(label)) {
      found.push(label);
    }
  }
  return found;
}

/**
 * A URL with its scheme stripped, which is the form the Slack corpus actually stores.
 *
 * MEASURED, and it is the bug this exists to fix: `gh` reports
 * `https://github.com/owner/repo/pull/<n>`, while the corpus's projected text holds
 * `github.com/owner/repo/pull/<n>` — Slack's own link rendering drops the scheme. Matching on the `gh`
 * spelling therefore found NOTHING, and the pane confidently reported that a pull request raised in Slack
 * three times had never been raised at all. Searching for the bare form matches both spellings, since the
 * full one contains it.
 *
 * MEASURED AGAIN, and this half was the larger one: the projected text does not reliably hold the
 * URL in EITHER spelling. Slack's markup for a labelled link is `<url|label>` and the projection resolves it
 * to the LABEL, so a pasted GitHub link that Slack auto-labelled with its number leaves no URL in `text` at all. Of
 * the Slack records linking a pull request in the work repository, roughly three in ten carried the URL
 * only in `raw`, including messages whose visible prose is literally a review bump. That is why {@link askFromRecord} now
 * matches `../../review/prLink.slackHaystack` rather than `record.text`.
 *
 * @param url the URL as `gh` reported it
 * @returns the same URL without its scheme
 */
function bareUrl({ url }: { url: string }): string {
  return url.replace(/^https?:\/\//, "");
}

/**
 * Whether a message links THIS pull request, and not merely one whose number starts with the same digits.
 *
 * A plain substring test is wrong: one pull request's number can be a prefix of another's (12 of 123), so its
 * URL occurs inside the longer one's and a message about the longer one would be reported as an ask about the
 * shorter — a row confidently naming the wrong pull request. The match therefore has to
 * end at a non-digit or at the end of the text.
 *
 * @param text the message body
 * @param url the pull request's URL
 * @returns whether the message links that exact pull request
 */
export function linksPr({ text, url }: { text: string; url: string }): boolean {
  const bare = bareUrl({ url });
  for (let from = 0; ; from = from + 1) {
    const at = text.indexOf(bare, from);
    if (at === -1) {
      return false;
    }
    const next = text.charAt(at + bare.length);
    if (next === "" || next < "0" || next > "9") {
      return true;
    }
    from = at;
  }
}

/**
 * Turn one corpus record into an ask, when it links one of the pull requests on the board.
 *
 * Matching is by the pull request's own URL appearing in the message, which is why this needs no fuzzy
 * identity resolution at all — the URL is exact and unambiguous. The cost is that a message QUOTING someone
 * else's link matches too; the row says who posted it and links the message, so the reader can see that.
 *
 * The URL is looked for in the record's RAW payload as well as its projected text — see {@link bareUrl}'s own
 * note for the 29.8% of linking messages that a `record.text` match cannot see. `named`, deliberately, still
 * reads only the projected text: it answers a different question (was this raised WITH somebody, mention run
 * or not) and the resolved names are the right input for it.
 *
 * @param record the corpus record to consider
 * @param prUrls the pull-request URLs currently on the board
 * @returns the ask, or `undefined` when this record links none of them
 */
export function askFromRecord({
  record,
  prUrls,
}: {
  record: CorpusRecord;
  prUrls: readonly string[];
}): SlackAsk | undefined {
  if (record.source !== "slack") {
    return undefined;
  }
  const matched = prUrls.find((url) => linksPr({ text: slackHaystack({ record }), url }));
  if (matched === undefined) {
    return undefined;
  }
  // Destructured with a default rather than coalesced: `?? ""` is banned outright and the ternary spelling is
  // warned, so the default is the one form both gates accept.
  const { author = "" } = record;
  return {
    atIso: record.tsIso,
    author,
    named: namedIn({ text: record.text }),
    permalink: record.url,
    prUrl: matched,
  };
}

/**
 * The asks for one pull request, newest first.
 *
 * @param asks every ask gathered for the board
 * @param url the pull request's URL
 * @returns that pull request's asks, newest first
 */
export function asksForPr({ asks, url }: { asks: readonly SlackAsk[]; url: string }): readonly SlackAsk[] {
  return asks.filter((ask) => ask.prUrl === url).toSorted((a, b) => b.atIso.localeCompare(a.atIso));
}

/**
 * The slice of Slack that was actually read, so every claim made from it can be bounded by it.
 *
 * An absence is only ever true OVER A WINDOW. The corpus holds hundreds of megabytes per window file and the
 * pane re-collects on a 60-second TTL, so reading all of it per refresh is not on the table — which means the
 * honest output is not "the owner never raised this" but "the owner did not raise this between X and Y". Carrying the window
 * next to the claim is what keeps the second sentence from silently becoming the first.
 */
export interface AskWindow {
  /** The oldest instant the read covered. Every absence claim is scoped to this. */
  readonly startIso: string;
  /** The newest Slack record found, or why the corpus could not be read at all. */
  readonly newestIso: Measured<string>;
}

/**
 * Whether an absence may be reported at all over {@link AskWindow}.
 *
 * This is the load-bearing honesty check. An empty result means one of two very different things: the owner did not
 * raise it, or the corpus has not caught up. Printing the first when only the second is known manufactures
 * exactly the confident absence this console exists to refuse.
 *
 * The freshness bound is deliberately weak and stated as such: a corpus newer than the pull request's last
 * activity does NOT prove it covers the pull request's whole life. It is enough to refuse the claim in the
 * case that actually occurs — a corpus nobody has refreshed lately.
 *
 * @param window the slice of Slack that was read
 * @param prUpdatedIso when the pull request was last active
 * @returns whether an absence may be reported, or why it may not
 */
export function absenceReportable({
  window,
  prUpdatedIso,
}: {
  window: AskWindow;
  prUpdatedIso: string;
}): Measured<true> {
  if (!window.newestIso.known) {
    // The caller's reason is deliberately NOT interpolated. This string is rendered into a row, so anything
    // it carries becomes row prose — including, in the limit, text that reads like one of the other verdicts.
    // The specific reason stays available on `window` for a caller that wants it in the collapsed detail.
    return unmeasurable({ why: "the Slack corpus was not read at all" });
  }
  if (prUpdatedIso === "") {
    return unmeasurable({
      why: "gh reported no last-activity instant for this pull request, so nothing bounds the window",
    });
  }
  return window.newestIso.value >= prUpdatedIso
    ? measured({ value: true })
    : unmeasurable({
        why: `the Slack corpus ends ${window.newestIso.value} but this pull request was active at ${prUpdatedIso} — refresh before trusting an absence`,
      });
}

/** A bronze window filename, `<startDate>_<endDate>.jsonl`. The dates bound what the file can contain. */
const WINDOW_NAME = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.jsonl$/;

/**
 * The END date encoded in a bronze window filename, or the empty string when the name is not a window.
 *
 * @param name the filename
 * @returns the window's end date, or the empty string
 */
function windowEnd({ name }: { name: string }): string {
  const match = WINDOW_NAME.exec(name);
  // A name that is not `<start>_<end>.jsonl` is not a bronze window, so it has no end date to bound it.
  if (match === null) {
    return "";
  }
  // Group 2 is mandatory in `WINDOW_NAME`, so a match always carries it.
  return match[2]!;
}

/**
 * Which Slack window files can hold a record at or after `sinceIso`.
 *
 * Selected from the FILENAME rather than the contents, because the whole point is to avoid opening a file
 * whose every record is older than the window — one of them is ~290 MB, and the pane re-collects every 60
 * seconds.
 *
 * @param names the filenames in the Slack bronze directory
 * @param sinceIso the oldest instant the caller cares about
 * @returns the filenames worth opening, oldest first
 */
export function windowsSince({ names, sinceIso }: { names: readonly string[]; sinceIso: string }): readonly string[] {
  const since = sinceIso.slice(0, 10);
  return names.filter((name) => windowEnd({ name }) >= since).toSorted();
}

/** How far back the ask window reaches. A pull request nobody has touched in this long is a different problem. */
const ASK_WINDOW_DAYS = 30;

/**
 * One parsed window file, kept so a 60-second pane refresh does not re-read tens of megabytes.
 *
 * Keyed by path plus the file's size and mtime, so a refreshed corpus invalidates it without anyone having to
 * remember to. Only the matching asks are retained — never the records — because the corpus does not fit in
 * the pane's memory and was never meant to.
 */
const CACHE = new Map<string, { readonly asks: readonly SlackAsk[]; readonly newestIso: string }>();

/**
 * One corpus record parsed from a JSONL line, or `undefined` when the line is not a valid corpus row.
 *
 * Through {@link parseRow}, the same validating decoder every other corpus reader uses — not a bare
 * `JSON.parse` cast. "Our own writer produced this line" is not a type guard: a truncated flush, a stale
 * schema or a hand-edited fixture would all parse as JSON while failing `parseRow`'s field checks, and this
 * pane's caller (`askFromRecord`) reads fields off the result unconditionally.
 */
function parseRecord({ line }: { line: string }): CorpusRecord | undefined {
  const decoded = parseRow({ line });
  return "record" in decoded ? decoded.record : undefined;
}

/**
 * Scan one window file for asks, reusing the cache when the file has not changed.
 *
 * Lines are substring-filtered BEFORE being parsed. A window holds hundreds of thousands of records and a
 * handful can possibly match, so parsing every line to discard it is the difference between milliseconds and
 * seconds on a page that re-collects every minute.
 */
function scanWindow({ path, prUrls }: { path: string; prUrls: readonly string[] }): {
  readonly asks: readonly SlackAsk[];
  readonly newestIso: string;
} {
  const stat = statSync(path);
  const key = `${path}:${String(stat.size)}:${String(stat.mtimeMs)}:${prUrls.join(",")}`;
  const hit = CACHE.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const asks: SlackAsk[] = [];
  // STREAMED, never `readFileSync(path, "utf8")`: a Slack window file has no size ceiling, and the epoch
  // backfill's single window passed 3.5 GB — seven times the length V8 will make a string,
  // so the whole pane section threw `Cannot create a string longer than 0x1fffffe8 characters`.
  readJsonlLines({
    onLine: ({ line }) => {
      // A cheap pre-filter only: the exact, boundary-aware match happens in `askFromRecord` once parsed.
      if (line.length === 0 || !prUrls.some((url) => line.includes(bareUrl({ url })))) {
        return;
      }
      const record = parseRecord({ line });
      if (record === undefined) {
        return;
      }
      const ask = askFromRecord({ prUrls, record });
      if (ask !== undefined) {
        asks.push(ask);
      }
    },
    path,
  });
  const newestIso = asks.map((ask) => ask.atIso).reduce((a, b) => (a > b ? a : b), "");
  const scanned = { asks, newestIso };
  CACHE.set(key, scanned);
  return scanned;
}

/**
 * Gather every Slack message that linked one of these pull requests and named somebody.
 *
 * The effectful shell for this module: it reads bounded slices of the local Slack corpus and hands the pure
 * classifier plain data. Nothing here reaches the network.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param prUrls the pull-request URLs currently on the board
 * @param nowMs the instant the window is measured back from
 * @returns the asks found, and the window they are true over
 */
export function gatherAsks({ home, prUrls, nowMs }: { home: string; prUrls: readonly string[]; nowMs: number }): {
  readonly asks: readonly SlackAsk[];
  readonly window: AskWindow;
} {
  const startIso = new Date(nowMs - ASK_WINDOW_DAYS * 86_400_000).toISOString();
  // The home layout is owned by stateHome.ts — deriving `corpus/bronze` here would fork the contract.
  const dir = join(stateHomePaths({ home }).corpus.bronze, "slack");
  if (prUrls.length === 0) {
    return {
      asks: [],
      window: { newestIso: unmeasurable({ why: "no pull request was on the board to look for" }), startIso },
    };
  }
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch {
    return {
      asks: [],
      // Deliberately path-free: this string is interpolated into a rendered row, and an absolute home path
      // there is both the hygiene gate's leak class and a way for arbitrary text to reach the sentence.
      window: {
        newestIso: unmeasurable({ why: "no Slack corpus under the state home — run `slopweaver refresh`" }),
        startIso,
      },
    };
  }
  const windows = windowsSince({ names, sinceIso: startIso });
  if (windows.length === 0) {
    return {
      asks: [],
      window: {
        newestIso: unmeasurable({ why: `no Slack window file covers the last ${String(ASK_WINDOW_DAYS)} days` }),
        startIso,
      },
    };
  }
  const gathered = windows.map((name) => scanWindow({ path: join(dir, name), prUrls }));
  const newest = gathered.map((scan) => scan.newestIso).reduce((a, b) => (a > b ? a : b), "");
  return {
    asks: gathered.flatMap((scan) => scan.asks).filter((ask) => ask.atIso >= startIso),
    window: {
      newestIso:
        newest === "" ? measured({ value: windowNewestFallback({ names: windows }) }) : measured({ value: newest }),
      startIso,
    },
  };
}

/**
 * The newest instant the read COULD have seen, when no message matched.
 *
 * Taken from the newest window filename rather than left unknown: "nothing matched" is only an absence if we
 * know how far the read reached, and the filename is exactly that bound. Without it every empty result would
 * report as unmeasurable and the stale-pull-request state could never fire at all.
 *
 * @param names the window filenames that were read
 * @returns the end date of the newest window, as an instant
 */
function windowNewestFallback({ names }: { names: readonly string[] }): string {
  const ends = names.map((name) => windowEnd({ name })).filter((end) => end !== "");
  const latest = ends.reduce((a, b) => (a > b ? a : b), "");
  return latest === "" ? "" : `${latest}T00:00:00.000Z`;
}
