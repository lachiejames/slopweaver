/**
 * Reading which build the console serves — the effectful shell of `./consoleBuild.ts`.
 *
 * Every git call goes through `gitEnv()` (`../lib/gitRepo.ts` says why), and every read that fails becomes a
 * sentence in `problems`, never a zero or a throw: the sidebar would rather say "main as of 4 minutes ago, the
 * fetch failed" than claim a build is the latest on evidence it never had.
 *
 * ## The fetch, and why it is throttled across processes
 *
 * "Is this the latest build" means the latest on the upstream, and nothing else in this repository fetches on a
 * clock — `checkout sync` runs when a supervisor tick or a hand asks. So a reading fetches the one remote its
 * branch tracks when its last SUCCESSFUL fetch is a minute old or more. That instant is the upstream's own `fetched.<digest>`
 * stamp this reader writes beside its claims once a fetch exits zero — never `FETCH_HEAD`, which git touches even on a fetch
 * that fails, so its age would call a stale ref freshly fetched. The console polls once a
 * minute from every open tab, and several tabs' readings can land together and all see a stale stamp, so a fetch
 * needs this minute's claim — a file created exclusively in a directory beside the run record and never released,
 * so no reading can remove another's (`fetchClaims`) — and the winner re-checks the stamp after taking it. A
 * reading that loses the race compares against the ref already on disk and says so. A fetch only refreshes
 * remote-tracking refs — no local branch, index or working tree moves.
 */
import { join } from "node:path";

import { cachePaths } from "../cacheHome.js";
import { runningCheckoutRoot } from "../lib/gitRepo.js";
import { stateHomePaths } from "../stateHome.js";
import {
  CLAIM_FETCHED,
  CLAIM_SKIPPED,
  type ConsoleBuildReport,
  carriesPort,
  consoleRecordKey,
  fetchClaims,
  fetchClaimsDirName,
  fetchDue,
  fetchedStampName,
  isRefreshRound,
  MAINLINE_FORMAT,
  MAINLINE_LIMIT,
  parseConsoleRunRecord,
  parseHeldBuild,
  parseMainline,
  parseUpstreamSource,
  previousClaimHolds,
  repositoryUrlOf,
  servedOf,
  UPSTREAM_FORMAT,
  type UpstreamSource,
} from "./consoleBuild.js";
import { type ConsoleBuildDeps, productionConsoleBuildDeps } from "./consoleBuildDeps.js";
import { parseAheadBehind } from "./freshness.js";
import { readInstalledApp } from "./installedAppRead.js";
import { markMainlinePathChanges } from "./shellChanges.js";

/**
 * The stamp a successful fetch of this upstream writes, inside the claims directory. One file per remote and refspec,
 * so a fetch of one never vouches for another the branch was re-pointed at since, and its age is one stat — a shared
 * stamp read for its name, then its time, could pair one upstream's name with another's fetch landing in between.
 *
 * @param claimsDir the claims directory beside the run record
 * @param source the upstream this reading compares against
 * @returns the stamp's path, or `undefined` for a local upstream, which is never fetched and so never fresh
 */
function stampOf({ claimsDir, source }: { claimsDir: string; source: UpstreamSource }): string | undefined {
  return source.fetch === undefined ? undefined : join(claimsDir, fetchedStampName(source.fetch));
}

/**
 * When this upstream was last fetched successfully, by its own stamp's modification time.
 *
 * @param claimsDir the claims directory beside the run record
 * @param source the upstream this reading compares against
 * @returns epoch milliseconds, or `undefined` when it never was, or cannot be (a local upstream)
 */
function fetchedAtOf({
  claimsDir,
  deps,
  source,
}: {
  claimsDir: string;
  deps: ConsoleBuildDeps;
  source: UpstreamSource;
}): number | undefined {
  const stamp = stampOf({ claimsDir, source });
  return stamp === undefined ? undefined : deps.mtimeMs({ path: stamp });
}

/**
 * Fetch the upstream's remote when the last fetch is a minute old, under a cross-process claim (`fetchClaims`).
 *
 * @param claimsDir the claims directory beside the run record, which also holds the last success's stamp
 * @param source the branch's upstream, as git's config names it
 * @returns a problem sentence when the fetch did not happen, or `undefined` when it did or was not due
 */
function fetchWhenDue({
  cwd,
  deps,
  claimsDir,
  nowMs,
  source,
}: {
  cwd: string;
  deps: ConsoleBuildDeps;
  claimsDir: string;
  nowMs: number;
  source: UpstreamSource;
}): string | undefined {
  const upstream = source.ref;
  const stamp = stampOf({ claimsDir, source });
  if (source.fetch === undefined || stamp === undefined) {
    return `the upstream ${upstream} names no remote, so nothing was fetched`;
  }
  if (!fetchDue({ fetchedAtMs: deps.mtimeMs({ path: stamp }), nowMs })) {
    return undefined;
  }
  const { remote, refspec } = source.fetch;
  const claims = fetchClaims({ nowMs });
  const another = `another reading fetched ${remote} inside the last minute, so this one compares against the refs on disk`;
  const taken = join(claimsDir, claims.take);
  if (!deps.claim({ path: taken })) {
    return another;
  }
  deps.sweepClaims({ below: claims.sweepBelow, dir: claimsDir });
  // A fetch under the last bucket's claim, under a minute ago, is one this would repeat across the bucket's edge.
  const previous = join(claimsDir, claims.previous);
  if (previousClaimHolds({ atMs: deps.mtimeMs({ path: previous }), nowMs, text: deps.readText({ path: previous }) })) {
    deps.markClaim({ decision: CLAIM_SKIPPED, path: taken });
    return another;
  }
  // Re-checked once the claim is held: a fetch that finished a moment ago already refreshed the refs.
  if (!fetchDue({ fetchedAtMs: deps.mtimeMs({ path: stamp }), nowMs })) {
    deps.markClaim({ decision: CLAIM_SKIPPED, path: taken });
    return undefined;
  }
  // Marked BEFORE the fetch, so a failed one still counts as a try: no reading starts another within a minute of it.
  deps.markClaim({ decision: CLAIM_FETCHED, path: taken });
  const failed = deps.fetch({ cwd, refspec, remote });
  if (failed !== undefined) {
    return `could not fetch ${upstream} (${failed}) — compared against the refs already on disk`;
  }
  deps.stampFetched({ path: stamp, upstream });
  return undefined;
}

/**
 * What the run record for this checkout says is serving, and whether it still is.
 *
 * @param recordPath the record's path
 * @param root the checkout the verb stands in, which the record must name
 * @returns the served console, and a problem when the record is there but unreadable or for another checkout
 */
function readServed({ deps, recordPath, root }: { deps: ConsoleBuildDeps; recordPath: string; root: string }): {
  served: ConsoleBuildReport["served"];
  problem: string | undefined;
} {
  const text = deps.readText({ path: recordPath });
  if (text === undefined) {
    return { problem: undefined, served: servedOf({ live: false, record: undefined }) };
  }
  const record = parseConsoleRunRecord({ text });
  if (record === undefined) {
    return { problem: `the run record ${recordPath} is not one docs-site.sh writes`, served: { kind: "none" } };
  }
  if (record.worktree !== root) {
    return { problem: `the run record ${recordPath} names ${record.worktree}, not ${root}`, served: { kind: "none" } };
  }
  const live = carriesPort({ args: deps.processArgs({ pid: record.pid }), port: record.port });
  return { problem: undefined, served: servedOf({ live, record }) };
}

/**
 * Whether a reading names a console that is serving now.
 *
 * @returns true for a recorded console whose process still carries its port
 */
function servesLive({ served }: { served: ConsoleBuildReport["served"] }): boolean {
  return served.kind !== "none" && served.live;
}

/**
 * The build held for a live call, believed only while the round that wrote it is still running.
 *
 * @param holdDir the round's hold directory beside the run record
 * @returns the held build, or `undefined`
 */
function readHeld({
  deps,
  holdDir,
}: {
  deps: ConsoleBuildDeps;
  holdDir: string;
}): ConsoleBuildReport["rebuild"]["waiting"] {
  const text = deps.readText({ path: join(holdDir, "waiting.json") });
  if (text === undefined) {
    return undefined;
  }
  const held = parseHeldBuild({ text });
  if (held === undefined || !isRefreshRound({ args: deps.processArgs({ pid: held.pid }) })) {
    return undefined;
  }
  return held;
}

/**
 * Whether the round `refresh.pid` names is still running.
 *
 * @param pidPath the `refresh.pid` beside the run record
 * @returns true while a round is building or holding
 */
function readRunning({ deps, pidPath }: { deps: ConsoleBuildDeps; pidPath: string }): boolean {
  const text = deps.readText({ path: pidPath });
  if (text === undefined || !/^\d+\s*$/u.test(text)) {
    return false;
  }
  return isRefreshRound({ args: deps.processArgs({ pid: Number(text.trim()) }) });
}

/**
 * The upstream of the branch HEAD is on, in one `for-each-ref` read of git's own config.
 *
 * @param root the checkout
 * @returns the upstream, or `undefined` on a detached HEAD or a branch tracking nothing
 */
function readUpstreamSource({ deps, root }: { deps: ConsoleBuildDeps; root: string }): UpstreamSource | undefined {
  const branch = deps.git({ args: ["symbolic-ref", "--quiet", "HEAD"], cwd: root });
  if (branch === undefined) {
    return undefined;
  }
  const line = deps.git({ args: ["for-each-ref", `--format=${UPSTREAM_FORMAT}`, branch], cwd: root });
  return line === undefined ? undefined : parseUpstreamSource({ text: line });
}

/**
 * The web address of the upstream's remote, for linking its pull requests.
 *
 * @param root the checkout
 * @param source the upstream, whose remote git's config named
 * @returns the repository's URL, or `undefined` for a local upstream or a remote that is not a GitHub one
 */
function readRepositoryUrl({
  deps,
  root,
  source,
}: {
  deps: ConsoleBuildDeps;
  root: string;
  source: UpstreamSource;
}): string | undefined {
  if (source.fetch === undefined) {
    return undefined;
  }
  const remote = deps.git({ args: ["remote", "get-url", source.fetch.remote], cwd: root });
  return remote === undefined ? undefined : repositoryUrlOf({ remote });
}

/**
 * The upstream half: fetch when due, then the tracking ref's sha, its drift from HEAD, and its newest commits.
 *
 * @param root the checkout
 * @param claimsDir the fetch claims directory beside the run record
 * @param problems collects every read that failed
 * @returns the upstream and mainline fields of the report
 */
function readUpstream({
  claimsDir,
  deps,
  nowMs,
  problems,
  root,
}: {
  claimsDir: string;
  deps: ConsoleBuildDeps;
  nowMs: number;
  problems: string[];
  root: string;
}): Pick<ConsoleBuildReport, "upstream" | "mainline"> {
  const emptyMainline = { commits: [], limit: MAINLINE_LIMIT, truncated: false };
  const source = readUpstreamSource({ deps, root });
  if (source === undefined) {
    problems.push("this checkout's branch tracks no upstream, so there is no latest build to compare with");
    return { mainline: emptyMainline, upstream: undefined };
  }
  const { ref } = source;
  const fetched = fetchWhenDue({ claimsDir, cwd: root, deps, nowMs, source });
  if (fetched !== undefined) {
    problems.push(fetched);
  }
  // The stamp is read BEFORE the ref: a stamp is written only after its fetch moved the ref, so any stamp this reads
  // belongs to a fetch the ref read below already reflects. Read after, a concurrent fetch finishing in between would
  // date the old tip with the new fetch's time.
  const fetchedAtMs = fetchedAtOf({ claimsDir, deps, source });
  // Everything after this reads the tip by its sha, never the ref again: a fetch landing between two reads of the
  // ref would describe two tips in one reading. The FULL name, never the short one a tag or
  // local branch of the same name would win.
  const sha = deps.git({ args: ["rev-parse", source.trackingRef], cwd: root });
  if (sha === undefined) {
    problems.push(`${ref} could not be resolved`);
    return { mainline: emptyMainline, upstream: undefined };
  }
  const fetchedAtIso = fetchedAtMs === undefined ? undefined : new Date(fetchedAtMs).toISOString();
  const drift = deps.git({ args: ["rev-list", "--left-right", "--count", `${sha}...HEAD`], cwd: root });
  const counts = drift === undefined ? undefined : parseAheadBehind({ text: drift });
  if (counts === undefined) {
    problems.push(`${ref} could not be compared with HEAD`);
    return { mainline: emptyMainline, upstream: undefined };
  }
  const upstream = { ahead: counts.ahead, behind: counts.behind, fetchedAtIso, ref, sha };
  const mainline = readMainline({ deps, problems, root, sha, source });
  if (mainline === undefined) {
    return { mainline: emptyMainline, upstream };
  }
  return { mainline, upstream };
}

/**
 * The upstream tip's newest commits, each marked with which of them change the app — `undefined`, with the problem
 * named, when its history cannot be read.
 *
 * @param sha the upstream tip, read once by the caller so every read here describes the same one
 * @param source the upstream, for its name and its remote's URL
 * @param problems collects every read that failed
 * @returns the mainline window, or `undefined` when the history could not be read
 */
function readMainline({
  deps,
  problems,
  root,
  sha,
  source,
}: {
  deps: ConsoleBuildDeps;
  problems: string[];
  root: string;
  sha: string;
  source: UpstreamSource;
}): ConsoleBuildReport["mainline"] | undefined {
  const { ref } = source;
  const log = deps.git({
    args: ["log", "--first-parent", "-n", String(MAINLINE_LIMIT + 1), `--format=${MAINLINE_FORMAT}`, sha],
    cwd: root,
  });
  const repositoryUrl = readRepositoryUrl({ deps, root, source });
  const mainline = log === undefined ? undefined : parseMainline({ limit: MAINLINE_LIMIT, repositoryUrl, text: log });
  if (mainline === undefined) {
    problems.push(`${ref}'s history could not be read`);
    return undefined;
  }
  const { truncated } = mainline;
  const window = { deps, limit: MAINLINE_LIMIT, problems, ref, root, sha, truncated };
  const commits = markMainlinePathChanges({ ...window, commits: mainline.commits });
  return { commits, limit: MAINLINE_LIMIT, truncated };
}

/**
 * Read which build the console for the checkout at `cwd` serves, against that checkout and its upstream.
 *
 * @param cwd where the verb stands; the console runs it from its own `site/`, so this is the serving checkout
 * @param cacheRoot the cache root holding `docs-site/` (`src/cacheHome.ts`), this process's own when omitted
 * @param homeDocsSite where the records lived under the home before they moved, read while the cache root holds
 * no record for this checkout; this process's own home's when omitted
 * @param nowMs the reading's clock, for the fetch throttle and the stamp
 * @param deps the seams; the real ones unless a test supplies its own
 * @returns the report — always, with every read that failed named in `problems`
 */
export function readConsoleBuild({
  cwd,
  cacheRoot,
  homeDocsSite = stateHomePaths().homeDocsSite,
  nowMs,
  deps = productionConsoleBuildDeps(),
}: {
  cwd: string;
  cacheRoot?: string;
  homeDocsSite?: string;
  nowMs: number;
  deps?: ConsoleBuildDeps;
}): ConsoleBuildReport {
  const root = runningCheckoutRoot({ cwd });
  const current = cachePaths(cacheRoot === undefined ? {} : { root: cacheRoot }).docsSite;
  const key = consoleRecordKey({ root });
  // A console the OLD script started stays recorded under the home until the new script next runs and moves it
  // (`scripts/docs-site.sh`'s `migrate_legacy_state`), so its record, refresh and hold are read there whenever the
  // cache root names no live console and the home's either names a live one or is the only record (a stopped post-move server's record must not hide the live one an old checkout started after it). The
  // fetch claims are this reading's own, so stay put. The home is read FIRST: records only ever move from it to
  // the cache root, so one moving between the two reads is seen in the second.
  const homeRecorded = deps.readText({ path: `${join(homeDocsSite, key)}.json` }) !== undefined;
  const fromHome = readServed({ deps, recordPath: `${join(homeDocsSite, key)}.json`, root });
  const cacheRecorded = deps.readText({ path: `${join(current, key)}.json` }) !== undefined;
  const fromCache = readServed({ deps, recordPath: `${join(current, key)}.json`, root });
  const homeOnly = !cacheRecorded && homeRecorded;
  const homeServes = !servesLive({ served: fromCache.served }) && (servesLive({ served: fromHome.served }) || homeOnly);
  const stem = join(homeServes ? homeDocsSite : current, key);
  const claimsDir = join(current, fetchClaimsDirName({ root }));
  const problems: string[] = [];
  const { served, problem } = homeServes ? fromHome : fromCache;
  if (problem !== undefined) {
    problems.push(problem);
  }
  const headSha = deps.git({ args: ["rev-parse", "HEAD"], cwd: root });
  if (headSha === undefined) {
    problems.push("HEAD could not be read");
  }
  const { upstream, mainline } = readUpstream({ claimsDir, deps, nowMs, problems, root });
  const installedApp = readInstalledApp({ deps, problems, root, upstream });
  return {
    head: headSha === undefined ? undefined : { sha: headSha },
    installedApp,
    mainline,
    observedAtIso: new Date(nowMs).toISOString(),
    problems,
    rebuild: {
      logPath: `${stem}.refresh.log`,
      running: readRunning({ deps, pidPath: `${stem}.refresh.pid` }),
      waiting: readHeld({ deps, holdDir: `${stem}.hold` }),
    },
    root,
    served,
    upstream,
  };
}
