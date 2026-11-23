/**
 * Which build the console at localhost:3000 serves, against the checkout it serves from and that checkout's
 * upstream — the pure half of `slopweaver checkout console`.
 *
 * The owner should never have to wonder whether what they are looking at is up to date or stale, so the page
 * carries a live status of which build is serving. The console's sidebar reads this
 * verb's report and compares it with the build its own bundle was baked from (`site/lib/buildStanding.ts`).
 *
 * The report is EVIDENCE, never a verdict: which build the run record says is serving, the checkout's HEAD, how
 * that HEAD stands against its upstream, the upstream's newest first-parent commits, and whether a rebuild is
 * running or held behind a live call. The page decides what it means for the build it was loaded from, because
 * only the page knows that build — the console's argv is literal, so it cannot be passed here.
 *
 * Pure: every input is text or a number a caller already read. `./consoleBuildRead.ts` is the effectful shell.
 */
import { createHash } from "node:crypto";
import { basename } from "node:path";

import { isRecord } from "../lib/parsers.js";
import type { InstalledApp } from "./installedApp.js";

/** How many of the upstream's newest first-parent commits a report carries — about a day of this repo's landings. */
export const MAINLINE_LIMIT = 50;

/** How old the last fetch may be before a reading fetches again, so a console polling each minute stays current. */
export const FETCH_EVERY_MS = 60_000;

/** A full commit sha. */
const SHA = /^[0-9a-f]{40}$/u;

/** The instant `scripts/docs-site.sh` writes (`date -u +%Y-%m-%dT%H:%M:%SZ`). */
const SCRIPT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

/** A squash-merged subject's trailing pull request number: `… (#<number>)`. */
const TRAILING_PR = /^(?<title>.*\S)\s+\(#(?<number>\d+)\)$/u;

/** The two remote spellings GitHub hands out: `https://github.com/o/r(.git)` and `git@github.com:o/r(.git)`. */
const GITHUB_REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:)(?<slug>[\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/u;

/** The field separator `git log --format` is given, a character no subject carries. */
export const LOG_FIELD = "\u001f";

/** The `git log` format {@link parseMainline} reads: sha, committer time, subject. */
export const MAINLINE_FORMAT = "%H%x1f%cI%x1f%s";

/** One upstream commit, as the sidebar lists it. */
export interface ConsoleCommit {
  readonly sha: string;
  /** The subject with its trailing `(#N)` removed when it had one. */
  readonly title: string;
  readonly committedIso: string;
  /** The pull request the squash merge names, with its link when the remote is a GitHub one. */
  readonly pullRequest: { readonly number: number; readonly url: string | undefined } | undefined;
  /**
   * Whether the commit changes what the desktop app is built from (`SHELL_PATHSPEC`, `./shellChanges.ts`) — the app
   * is rebuilt only by `slopweaver desktop install`, never on a landing, so these are the commits a running app can be
   * missing. `undefined` when that could not be read.
   */
  readonly changesShell: boolean | undefined;
  /**
   * Whether the commit changes the console page or its voice (`CONSOLE_PATHSPEC`, `./shellChanges.ts`) — what the owner sees
   * inside the app rather than the shell around it, so the release notes can say which changes are "in the app".
   * A path-based signal, not a dependency closure; `undefined` when that could not be read.
   */
  readonly changesConsole: boolean | undefined;
}

/** What `scripts/docs-site.sh`'s run record says about the server it started. */
export interface ConsoleRunRecord {
  readonly worktree: string;
  readonly pid: number;
  readonly port: number;
  readonly startedIso: string;
  /** Present only on a production record (`--serve`/`--refresh`); a dev record carries none of the three. */
  readonly production: { readonly sha: string; readonly slot: string } | undefined;
}

/** The server the run record names, and whether it is still the process it was recorded as. */
export type ServedConsole =
  | { readonly kind: "none" }
  | {
      readonly kind: "dev";
      readonly startedIso: string;
      readonly port: number;
      readonly live: boolean;
    }
  | {
      readonly kind: "production";
      readonly sha: string;
      readonly slot: string;
      readonly startedIso: string;
      readonly port: number;
      readonly live: boolean;
    };

/** A build a refresh round built and is holding for a live voice call (`waiting.json`). */
export interface HeldBuild {
  readonly sha: string;
  readonly pid: number;
  readonly sinceIso: string;
}

/** The whole report `checkout console --json` prints. */
export interface ConsoleBuildReport {
  readonly observedAtIso: string;
  /** The checkout the console serves from — the one the verb was run in. */
  readonly root: string;
  readonly served: ServedConsole;
  readonly head: { readonly sha: string } | undefined;
  readonly upstream:
    | {
        readonly ref: string;
        readonly sha: string;
        /** When a reading last fetched successfully, from its own stamp; `undefined` when none has. */
        readonly fetchedAtIso: string | undefined;
        /** Commits the upstream has that HEAD does not — what `checkout sync` would pull. */
        readonly behind: number;
        /** Commits HEAD has that the upstream does not; non-zero means the checkout has diverged. */
        readonly ahead: number;
      }
    | undefined;
  /** The upstream's newest first-parent commits, newest first; `truncated` when older ones exist beyond the limit. */
  readonly mainline: {
    readonly limit: number;
    readonly truncated: boolean;
    readonly commits: readonly ConsoleCommit[];
  };
  readonly rebuild: {
    /** Whether a refresh round is running now — building, or holding its swap for a call. */
    readonly running: boolean;
    readonly waiting: HeldBuild | undefined;
    /** Where a round writes its lines, so a stuck console names the file that says why. */
    readonly logPath: string;
  };
  /**
   * The installed desktop app and whether its source differs from the upstream tip's (`./installedApp.ts`) — read
   * with no upstream too, when it is compared with nothing, so a bundle that will not read is never silent.
   */
  readonly installedApp: InstalledApp;
  /** What could not be read or refreshed, each in a sentence; the reading above is still the best there was. */
  readonly problems: readonly string[];
}

/**
 * The name `scripts/docs-site.sh` gives one checkout's run record: its directory's basename and the first eight
 * hex digits of the SHA-1 of its absolute path (`$(basename "$root")-$(printf '%s' "$root" | shasum | cut -c1-8)`).
 *
 * @param root the checkout's absolute path, exactly as the script computes it
 * @returns the record's file stem, without `.json`
 */
export function consoleRecordKey({ root }: { root: string }): string {
  const digest = createHash("sha1").update(root).digest("hex");
  return `${basename(root)}-${digest.slice(0, 8)}`;
}

/**
 * The directory holding one checkout's fetch claims and `fetched.<upstream>` stamps. Keyed by the WHOLE digest of
 * its path, unlike the run record's eight hex digits: a stamp certifies one checkout's fetch, so two checkouts whose
 * short keys collide must never share one.
 *
 * @param root the checkout's absolute path
 * @returns the directory's name, beside the run record
 */
export function fetchClaimsDirName({ root }: { root: string }): string {
  return `${basename(root)}-${createHash("sha1").update(root).digest("hex")}.fetch-claims`;
}

/**
 * The name of the stamp a successful fetch writes in the claims directory, keyed by exactly what was fetched — the
 * remote and the refspec, whose destination is the tracking ref — so a stamp certifies one tracking ref filled from
 * one remote, and a branch re-pointed at another remote or ref since finds no stamp of its own. A lowercase hex
 * digest, not the names themselves: a case-insensitive filesystem folds `origin/Main` and `origin/main` onto one
 * file. Not a `.claim`, so no sweep removes it.
 *
 * @param remote the remote fetched, as git's branch config names it
 * @param refspec the refspec fetched, `+refs/heads/main:refs/remotes/origin/main`-shaped
 * @returns the stamp's file name
 */
export function fetchedStampName({ remote, refspec }: { remote: string; refspec: string }): string {
  return `fetched.${createHash("sha1").update(`${remote}\n${refspec}`).digest("hex")}`;
}

/**
 * The `for-each-ref` format naming a branch's upstream in one read, tab-separated: the tracking ref in full and
 * short, the remote it tracks and that remote's own ref.
 */
export const UPSTREAM_FORMAT = "%(upstream)%09%(upstream:short)%09%(upstream:remotename)%09%(upstream:remoteref)";

/** A branch's upstream, and how to fetch exactly it. */
export interface UpstreamSource {
  /** The tracking ref, short — `origin/main` — for display only. */
  readonly ref: string;
  /**
   * The tracking ref in full — `refs/remotes/origin/main` — which every read resolves: git resolves a SHORT name to
   * a tag or local branch of that name before the remote-tracking ref (Claude r3 on this change).
   */
  readonly trackingRef: string;
  /** The remote to fetch and the refspec moving exactly this tracking ref, or `undefined` for a local upstream. */
  readonly fetch: { readonly remote: string; readonly refspec: string } | undefined;
}

/**
 * A branch's upstream, read from git's own config through {@link UPSTREAM_FORMAT} — never split out of the tracking
 * ref's name: a remote may itself contain a slash, so `corp/team/main` can be remote `corp/team`'s `main` or remote
 * `corp`'s `team/main`. The refspec names the tracking ref as its destination, so a fetch
 * that succeeds has moved the very ref this reading compares against, whatever the remote's own fetch refspecs say.
 *
 * @param text the `for-each-ref` line for the branch HEAD is on, trimmed, so empty trailing fields may be absent
 * @returns the upstream, or `undefined` when the branch tracks nothing or git answered in another shape
 */
export function parseUpstreamSource({ text }: { text: string }): UpstreamSource | undefined {
  const fields = text.split("\t");
  const [trackingRef, ref, remote, remoteRef] = fields;
  if (fields.length > 4 || trackingRef === undefined || ref === undefined || trackingRef === "" || ref === "") {
    return undefined;
  }
  if (remote === undefined || remoteRef === undefined || remote === "." || remote === "" || remoteRef === "") {
    return { fetch: undefined, ref, trackingRef };
  }
  return { fetch: { refspec: `+${remoteRef}:${trackingRef}`, remote }, ref, trackingRef };
}

/**
 * Decode a docs-site run record.
 *
 * @param text the record file's contents
 * @returns the record, or `undefined` when it is not one — a production record missing its sha or slot included
 */
export function parseConsoleRunRecord({ text }: { text: string }): ConsoleRunRecord | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded)) {
    return undefined;
  }
  const { worktree, pid, port, startedIso, mode, sha, slot } = decoded;
  if (typeof worktree !== "string" || typeof startedIso !== "string" || !SCRIPT_ISO.test(startedIso)) {
    return undefined;
  }
  if (!Number.isInteger(pid) || !Number.isInteger(port) || typeof pid !== "number" || typeof port !== "number") {
    return undefined;
  }
  if (mode === undefined) {
    return { pid, port, production: undefined, startedIso, worktree };
  }
  if (mode !== "production" || typeof sha !== "string" || !SHA.test(sha) || typeof slot !== "string") {
    return undefined;
  }
  return { pid, port, production: { sha, slot }, startedIso, worktree };
}

/**
 * What the record says is serving, once its liveness has been checked.
 *
 * @param record the decoded record, or `undefined` when there is none
 * @param live whether the recorded pid is still the process that carries the recorded port
 * @returns the served console
 */
export function servedOf({ record, live }: { record: ConsoleRunRecord | undefined; live: boolean }): ServedConsole {
  if (record === undefined) {
    return { kind: "none" };
  }
  if (record.production === undefined) {
    return { kind: "dev", live, port: record.port, startedIso: record.startedIso };
  }
  return {
    kind: "production",
    live,
    port: record.port,
    sha: record.production.sha,
    slot: record.production.slot,
    startedIso: record.startedIso,
  };
}

/**
 * Decode `waiting.json` as a refresh round writes it.
 *
 * @param text the file's contents
 * @returns the held build, or `undefined` for anything that is not exactly that shape
 */
export function parseHeldBuild({ text }: { text: string }): HeldBuild | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded)) {
    return undefined;
  }
  const { sha, pid, sinceIso } = decoded;
  if (typeof sha !== "string" || !SHA.test(sha) || typeof sinceIso !== "string" || !SCRIPT_ISO.test(sinceIso)) {
    return undefined;
  }
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  return { pid, sha, sinceIso };
}

/**
 * The GitHub web address a remote points at, for linking a pull request number.
 *
 * @param remote `git remote get-url <name>`'s output
 * @returns `https://github.com/<owner>/<repo>`, or `undefined` for a remote that is not a GitHub one
 */
export function repositoryUrlOf({ remote }: { remote: string }): string | undefined {
  const slug = GITHUB_REMOTE.exec(remote.trim())?.groups?.["slug"];
  if (slug === undefined) {
    return undefined;
  }
  return `https://github.com/${slug}`;
}

/**
 * Split a squash-merged subject into its title and the pull request it names.
 *
 * @param subject the commit's subject line
 * @param repositoryUrl the GitHub web address, when the remote is one
 * @returns the title, and the pull request when the subject ends in `(#N)`
 */
export function titleAndPullRequest({
  subject,
  repositoryUrl,
}: {
  subject: string;
  repositoryUrl: string | undefined;
}): Pick<ConsoleCommit, "title" | "pullRequest"> {
  const groups = TRAILING_PR.exec(subject)?.groups;
  const title = groups?.["title"];
  const digits = groups?.["number"];
  if (title === undefined || digits === undefined) {
    return { pullRequest: undefined, title: subject };
  }
  const number = Number(digits);
  let url: string | undefined;
  if (repositoryUrl !== undefined) {
    url = `${repositoryUrl}/pull/${digits}`;
  }
  return { pullRequest: { number, url }, title };
}

/**
 * Decode `git log --first-parent -n <limit + 1> --format=${MAINLINE_FORMAT}`: one commit per line, newest first.
 * The one extra line asked for is what says older commits exist, without carrying them.
 *
 * @param text the log's stdout
 * @param repositoryUrl the GitHub web address, for pull request links
 * @param limit how many commits the report carries
 * @returns the commits and whether the list was cut, or `undefined` when any line is not a commit
 */
export function parseMainline({
  text,
  repositoryUrl,
  limit,
}: {
  text: string;
  repositoryUrl: string | undefined;
  limit: number;
}): { readonly commits: readonly ConsoleCommit[]; readonly truncated: boolean } | undefined {
  const lines = text.split("\n").filter((line) => line !== "");
  const commits: ConsoleCommit[] = [];
  for (const line of lines) {
    const [sha, committedIso, subject, ...rest] = line.split(LOG_FIELD);
    if (sha === undefined || !SHA.test(sha) || committedIso === undefined || subject === undefined) {
      return undefined;
    }
    if (rest.length > 0 || Number.isNaN(Date.parse(committedIso))) {
      return undefined;
    }
    commits.push({
      changesConsole: undefined,
      changesShell: undefined,
      committedIso,
      sha,
      ...titleAndPullRequest({ repositoryUrl, subject }),
    });
  }
  return { commits: commits.slice(0, limit), truncated: commits.length > limit };
}

/**
 * Whether a reading should fetch before it compares: the last fetch is older than {@link FETCH_EVERY_MS}, dated
 * after now, or there has never been one.
 *
 * @param fetchedAtMs the last successful fetch's stamp, `undefined` when no reading has fetched
 * @returns true to fetch
 */
export function fetchDue({ nowMs, fetchedAtMs }: { nowMs: number; fetchedAtMs: number | undefined }): boolean {
  // A stamp from the future means the clock went back: its age proves nothing, so fetch.
  if (fetchedAtMs === undefined || fetchedAtMs > nowMs) {
    return true;
  }
  return nowMs - fetchedAtMs >= FETCH_EVERY_MS;
}

/** How many minutes a claim is kept before it is swept: long past any reading's twenty-second life. */
const CLAIM_KEEP_BUCKETS = 10;

/**
 * The fetch claims a reading may compete for and must respect, by the minute a claim is for.
 *
 * A claim is a file created exclusively and NEVER removed while it can still matter, which is what makes it safe
 * where a lock that is released or reclaimed is not: two readings that both judged one lock stale could each
 * delete the other's. One claim per minute bucket means one fetch per bucket; the
 * previous bucket's claim is what stops two fetches either side of a bucket's edge.
 *
 * A claim is swept only once it is {@link CLAIM_KEEP_BUCKETS} minutes old, not the moment its bucket has passed:
 * a reading that took its claim and then stalled still reads the one before it, and sweeping that one early let a
 * stalled reading fetch again seconds after another had. The residue, stated: files cannot
 * exclude a reading paused for longer than a minute between marking its claim and fetching — the next minute's
 * reading no longer honours that claim, and both fetch. The console's route kills its child at twenty
 * seconds (`site/lib/liveVerbs.ts`), so only a process stopped by hand gets there, and what it costs is one extra
 * `git fetch`, which git's own ref locks serialise. A clock set back re-enters minutes whose claims are still kept,
 * so fetching can wait until the clock passes them; the sidebar says "not known" meanwhile, because a
 * fetch stamped after now is refused as proof (`site/lib/buildStanding.ts`), so what it costs is freshness, never truth.
 *
 * @param nowMs the reading's clock
 * @returns the claim to take, the one to respect, and the bucket below which every claim is swept
 */
export function fetchClaims({ nowMs }: { nowMs: number }): {
  readonly take: string;
  readonly previous: string;
  readonly sweepBelow: number;
} {
  const bucket = Math.floor(nowMs / FETCH_EVERY_MS);
  return {
    previous: `${String(bucket - 1)}.claim`,
    sweepBelow: bucket - CLAIM_KEEP_BUCKETS,
    take: `${String(bucket)}.claim`,
  };
}

/** What a claim's holder wrote once it decided: it fetched (or tried to), or it held off. Empty until then. */
export const CLAIM_FETCHED = "fetch";
export const CLAIM_SKIPPED = "skip";

/**
 * Whether the previous bucket's claim holds this one off. Only a claim that fetched counts — or one whose holder has
 * not written its decision yet, which may be about to — and only while it is under a minute old. A claim that held
 * off never counts: were it to, one failed fetch would hold off the next claim, which would hold off the next, and
 * no reading would fetch again. So under a fetch that keeps failing, every other minute
 * still tries.
 *
 * @param text the previous claim's contents, `undefined` when there is none
 * @param atMs its modification time, `undefined` when there is none
 * @param nowMs the reading's clock
 * @returns true to hold off
 */
export function previousClaimHolds({
  text,
  atMs,
  nowMs,
}: {
  text: string | undefined;
  atMs: number | undefined;
  nowMs: number;
}): boolean {
  if (text === undefined || atMs === undefined || text === CLAIM_SKIPPED) {
    return false;
  }
  return nowMs - atMs < FETCH_EVERY_MS;
}

/**
 * The minute bucket a claim file's name is for.
 *
 * @param name a file name in the claims directory
 * @returns the bucket, or `undefined` for a name that is not a claim
 */
export function claimBucketOf({ name }: { name: string }): number | undefined {
  const match = /^(?<bucket>\d+)\.claim$/u.exec(name);
  const digits = match?.groups?.["bucket"];
  if (digits === undefined) {
    return undefined;
  }
  return Number(digits);
}

/**
 * Whether a process's argument line is still the server a run record names — the recycled-pid guard
 * `record_live` in `scripts/docs-site.sh` applies, which this must agree with.
 *
 * @param args `ps -o args= -p <pid>`'s output, `undefined` when the pid is gone
 * @param port the port the record names
 * @returns true when the process carries that port
 */
export function carriesPort({ args, port }: { args: string | undefined; port: number }): boolean {
  if (args === undefined) {
    return false;
  }
  return new RegExp(`(?:--port|-p) ${String(port)}(?:\\s|$)`, "u").test(args);
}

/**
 * Whether a process's argument line is a refresh round of `scripts/docs-site.sh` — the recycled-pid guard for
 * `refresh.pid` and `waiting.json`, which name a round rather than a server. A round is exactly
 * `bash <script> --refresh-round` (`locked_round`), so the argv must be exactly those three: a recycled pid that
 * merely MENTIONS the script, an editor open on it or a process passing it as an argument, is not one. A pid recycled into exactly that argv is the residue. A path with a space splits wrongly and reads
 * as no round, the safe direction — the sidebar then claims nothing is held.
 *
 * @param args `ps -o args= -p <pid>`'s output, `undefined` when the pid is gone
 * @returns true when it is still a refresh round
 */
export function isRefreshRound({ args }: { args: string | undefined }): boolean {
  if (args === undefined) {
    return false;
  }
  const [shell, script, flag, ...rest] = args.trim().split(/\s+/u);
  return (
    rest.length === 0 &&
    (shell === "bash" || shell?.endsWith("/bash") === true) &&
    (script === "docs-site.sh" || script?.endsWith("/docs-site.sh") === true) &&
    flag === "--refresh-round"
  );
}
