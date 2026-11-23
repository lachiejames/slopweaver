/**
 * The settled-chase hold: a parked `bump` or `review-ask` that links a pull request GitHub already closed or merged
 * is refused at recording, before it reaches the owner's Queue.
 *
 * A chase asking two teammates whether it is ok to close a pull request that was closed 40 hours before the chase
 * was cut spends their attention for nothing. Nothing on the recording path read the state of the pull request a
 * draft linked; the thread-chase seat re-read the Slack thread only.
 *
 * Only the two acts whose whole point is to move a pull request along are judged. A `reply` may legitimately report
 * that something merged, and a row with no declared act draws no badge, so neither is held here.
 *
 * Pure: the live state of each link is read by the caller and handed in, so every rule is testable with plain data.
 */
import { type PullRequestRef, parsePullRequestUrl } from "../../goldDebt/pull.js";
import type { PullRequestLiveState } from "../../live/github/pullRequestState.js";
import { receiptLinks } from "./draftReceipts.js";
import type { ParkedDraftAct } from "./draftRegister.js";
import { ChaseSubjectErrors } from "./settledChaseErrors.js";

/** The acts whose subject is live work on a pull request: a chase, and a first review ask. */
const JUDGED_ACTS: ReadonlySet<ParkedDraftAct> = new Set(["bump", "review-ask"]);

/**
 * What one link is to this hold: a pull request it can read, a github.com pull-request address it cannot name, or
 * anything else. The middle kind is what stops the hold being a list of spellings: a link GitHub may well serve as a
 * pull request, but which this reader cannot canonicalise, is REFUSED rather than skipped.
 */
type LinkedPullRequest =
  | { readonly kind: "pull-request"; readonly ref: PullRequestRef }
  | { readonly kind: "unnamed"; readonly key: string; readonly link: string }
  | { readonly kind: "other" };

/** The path segment GitHub files a pull request under, third after the owner and the repository. */
const PULL_SEGMENT = "pull";

/** A path segment of digits only, which GitHub reads as the number it spells, leading zeroes and all. */
const DIGITS = /^\d+$/u;

/**
 * A link's pull request, read off its first four path segments, so a subpage still names the pull request it sits
 * under: `…/files`, `…/commits/<sha>` and `…#discussion_r1` after the pull request's number name it as surely as
 * the bare address does. `parsePullRequestUrl` alone takes only the bare shape, and a link it declines is
 * one this hold would never read.
 *
 * @param link one URL the rendered message carries
 * @returns the pull request the link sits under, `unnamed` for a github.com pull-request path that names none this
 * reader can parse, or `other`
 */
function linkedPullRequest({ link }: { link: string }): LinkedPullRequest {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return { kind: "other" };
  }
  // GitHub redirects `http://`, `www.` and a fully-qualified `github.com.` to the one canonical address, so each
  // names the same pull request. `hostname` drops a port, which a browser would also follow.
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (!WEB_PROTOCOLS.has(parsed.protocol) || !GITHUB_HOSTS.has(host)) {
    return { kind: "other" };
  }
  // GitHub's router reads each segment decoded, so `%70ull/1` is `pull/1`; `URL` keeps the escape.
  const root = parsed.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodedSegment({ segment }));
  if (root[2]?.toLowerCase() !== PULL_SEGMENT) {
    return { kind: "other" };
  }
  // A number with leading zeroes is the number it spells to GitHub, so the number is canonicalised before it is parsed.
  const number = root[3];
  const canonical = number !== undefined && DIGITS.test(number) ? String(Number.parseInt(number, 10)) : number;
  const ref = parsePullRequestUrl({
    url: `https://github.com/${[root[0], root[1], PULL_SEGMENT, canonical].join("/")}`,
  });
  // Keyed by the path it names, so one address spelled two ways (`http://` and `https://`) is refused once.
  const key = [root[0], root[1], PULL_SEGMENT, canonical].join("/").toLowerCase();
  return ref === undefined ? { key, kind: "unnamed", link } : { kind: "pull-request", ref };
}

/**
 * One path segment with its percent-escapes decoded, or as written when an escape is malformed: GitHub answers a
 * malformed one with an error page, never a pull request, so leaving it undecoded misreads nothing.
 *
 * @param segment one non-empty segment of a URL's path
 * @returns the decoded segment
 */
function decodedSegment({ segment }: { segment: string }): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Every link the rendered message carries in any form Slack renders as one: a `url` field, `<url|label>` markup,
 * and a bare or scheme-less address in text.
 *
 * @param payload the rendered message
 * @returns the links, in first-seen order, repeats kept
 */
function messageLinks({ payload }: { payload: unknown }): readonly string[] {
  const candidates: string[] = [];
  collectLinkCandidates({ into: candidates, value: payload });
  return [...receiptLinks({ payload }), ...candidates];
}

/** The schemes a browser follows to github.com. */
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/** The hosts GitHub serves its pull requests from, the bare one canonical. */
const GITHUB_HOSTS: ReadonlySet<string> = new Set(["github.com", "www.github.com"]);

/** Slack's `<target>` / `<target|label>` markup, whatever the target's spelling. */
const SLACK_MARKUP = /<([^|>\s]+)(?:\|[^>]*)?>/gu;

/** One token of prose, up to whitespace or markup. */
const PROSE_TOKEN = /[^\s<>|"]+/gu;

/** Punctuation and mrkdwn emphasis that close a sentence around an address rather than belonging to it. */
const TRAILING_PROSE = /[.,;:!?)\]}*_~'"]+$/u;

/** Where a scheme-qualified address a browser follows to github.com starts. */
const WEB_SCHEME = /^https?:/iu;

/**
 * Every link candidate in the rendered message, past what `receiptLinks` reads: every `url` field and markup target
 * whatever its spelling, every scheme-qualified token of prose, and every scheme-less one naming github.com, given
 * a scheme.
 *
 * The hold does not match URL SHAPES, because each shape it matched was one more spelling a link could avoid (a bare
 * URL, `https:/` in a field and in markup, an encoded host, an address glued to prose). It takes anything that could be a link and
 * lets {@link linkedPullRequest} read it with the WHATWG parser a browser uses, which settles what it addresses.
 *
 * @param value one JSON value of the rendered message
 * @param into where each candidate is collected, in first-seen order
 */
function collectLinkCandidates({ into, value }: { into: string[]; value: unknown }): void {
  if (typeof value === "string") {
    collectTextCandidates({ into, text: value });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectLinkCandidates({ into, value: item });
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, field] of Object.entries(value)) {
      if (key === "url" && typeof field === "string") {
        into.push(field);
        continue;
      }
      collectLinkCandidates({ into, value: field });
    }
  }
}

/**
 * The candidates in one string of the message: every markup target, and every candidate in each token of prose.
 *
 * @param text one string value of the rendered message
 * @param into where each candidate is collected, in first-seen order
 */
function collectTextCandidates({ into, text }: { into: string[]; text: string }): void {
  for (const match of text.matchAll(SLACK_MARKUP)) {
    into.push(match[1]!);
  }
  for (const match of text.matchAll(PROSE_TOKEN)) {
    collectProseTails({ into, token: match[0].replace(TRAILING_PROSE, "") });
  }
}

/**
 * The candidates in one token of prose: every tail of it, as written when it opens on a web scheme and with one
 * added always. An address glued to the prose before it is read where it starts — `PR=https://…` and
 * `seexhttps://…` alike — so no list of what may precede an address, or of how its host is spelled, is kept
 * to be outrun. A token is bounded by whitespace, so the work is quadratic in one word's length, never a message's.
 *
 * @param token one whitespace-delimited token, closing punctuation stripped
 * @param into where each candidate is collected, in first-seen order
 */
function collectProseTails({ into, token }: { into: string[]; token: string }): void {
  for (let start = 0; start < token.length; start += 1) {
    const tail = token.slice(start);
    // A scheme-qualified tail is a candidate, its host left to the parser (`%67ithub.com` is github.com).
    if (WEB_SCHEME.test(tail)) {
      into.push(tail);
    }
    // Every tail is also given a scheme, never parsed as written, and the parser alone decides its host:
    // `github.com:443/…` reads as the scheme `github.com:` unprefixed, and `%67ithub.com/…` is
    // github.com only once parsed. `notgithub.com/…` is read as github.com too, which can only read a pull
    // request's state more often than needed, never less.
    into.push(`https://${tail}`);
  }
}

/** One linked pull request and what its live read (`../../live/github/pullRequestState.ts`) answered. */
export interface ChasedPullRequestRead {
  readonly ref: PullRequestRef;
  readonly state: PullRequestLiveState;
}

/**
 * The pull requests a row's rendered message links, once each, when its act is one this hold judges.
 *
 * @param act the act the recording declared
 * @param payload the rendered message, which the links are read off
 * @returns each distinct github.com pull request linked, in first-seen order; none for an act not judged
 */
export function chasedPullRequests({
  act,
  payload,
}: {
  act: ParkedDraftAct | undefined;
  payload: unknown;
}): readonly PullRequestRef[] {
  if (act === undefined || !JUDGED_ACTS.has(act)) {
    return [];
  }
  const byKey = new Map<string, PullRequestRef>();
  for (const link of messageLinks({ payload })) {
    const linked = linkedPullRequest({ link });
    if (linked.kind === "pull-request" && !byKey.has(linked.ref.debtId)) {
      byKey.set(linked.ref.debtId, linked.ref);
    }
  }
  return [...byKey.values()];
}

/**
 * The github.com pull-request links a judged row carries that name no pull request this reader can parse, once each.
 * The hold refuses each one, since a link it cannot read is a link whose state it never checked.
 *
 * @param act the act the recording declared
 * @param payload the rendered message, which the links are read off
 * @returns each distinct such link, in first-seen order; none for an act not judged
 */
export function unnamedPullRequestLinks({
  act,
  payload,
}: {
  act: ParkedDraftAct | undefined;
  payload: unknown;
}): readonly string[] {
  if (act === undefined || !JUDGED_ACTS.has(act)) {
    return [];
  }
  const unnamed = new Map<string, string>();
  for (const link of messageLinks({ payload })) {
    const linked = linkedPullRequest({ link });
    if (linked.kind === "unnamed" && !unnamed.has(linked.key)) {
      unnamed.set(linked.key, linked.link);
    }
  }
  return [...unnamed.values()];
}

/**
 * Why the row may not park, one line per linked pull request that is closed, merged, missing or unread.
 *
 * An unread state refuses rather than passes: a chase let through because GitHub did not answer is exactly the moot
 * ask this hold exists to stop (no silent fallback).
 *
 * @param act the act the recording declared, named in each line
 * @param reads every linked pull request and what its read answered
 * @returns the refusal messages, empty when every linked pull request is open
 */
export function settledChaseRefusals({
  act,
  reads,
}: {
  act: ParkedDraftAct;
  reads: readonly ChasedPullRequestRead[];
}): readonly string[] {
  const lines: string[] = [];
  for (const { ref, state } of reads) {
    switch (state.kind) {
      case "open":
        break;
      case "settled":
        lines.push(ChaseSubjectErrors.settled({ act, state: state.state, url: ref.url }).message);
        break;
      case "absent":
        lines.push(ChaseSubjectErrors.absent({ act, url: ref.url }).message);
        break;
      case "notChecked":
        lines.push(ChaseSubjectErrors.unread({ act, url: ref.url }).message);
        break;
      default: {
        const unreachable: never = state;
        return unreachable;
      }
    }
  }
  return lines;
}
