/**
 * The real edges the stray-dev-server class has: a `lsof` for each candidate's working directory, the Claude
 * Code session registry for which worktrees still hold a live seat, and one board row per worktree that has a
 * server. `./devServers.ts` decides; nothing here decides anything.
 *
 * ## Why `lsof`, and why it is cheap enough to run every tick
 *
 * A `next-server` process's own argv carries NOTHING — measured, it is literally
 * `next-server (v15.5.25)`, with no path and no port. Its cwd is the only identity it has, and
 * `lsof -a -d cwd -p <csv> -Fn` over the candidates took **0.077 s** wall for four pids (repro:
 * `time /usr/sbin/lsof -a -d cwd -p <pids> -Fn`). The call is bounded to the pids that already matched
 * `next dev`/`next start`, never to the whole table.
 *
 * ## Why the session registry rather than a cmux workspace list
 *
 * The obvious reading of "its seat is gone" is cmux's own workspace list, and `slopweaver cmux list` is an
 * ASYNC socket round-trip — inside a verb that is synchronous by construction (`no-headless` bans the async
 * `node:child_process` API repo-wide, and `machine reap` is one `ps` snapshot and one `kill`). Claude Code's
 * own registry answers the same question synchronously and with a stronger property: `~/.claude/sessions/
 * <pid>.json` carries the session's `cwd`, and the session is live exactly when that pid is in the `ps`
 * snapshot this verb already took. A cmux tab whose session has exited is an open tab, not a seat.
 *
 * ## Why the docs-site run records are read at all
 *
 * "Its seat is gone" asks about the worktree a server SERVES, and a seat legitimately works in a worktree it
 * does not live in — which is how a reap came to kill a server a live session was reading, nine times in one
 * morning (`./devServers.ts` § "A seat does not only work in the worktree it LIVES in"). The only thing that
 * can say who asked for a server is a record written when it STARTED: its wrapper is reparented to launchd
 * within a second (measured), so there is no ancestry left to walk. `scripts/docs-site.sh` writes
 * that record, and {@link readLiveStarterRootPids} resolves it to the root pids whose starter is still live.
 *
 * Every reading here answers `undefined` when it could not be taken, and `./devServers.ts` switches that
 * criterion off rather than reading an empty result as "nothing is live" — its header says what that
 * distinction is worth.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { parseListeningPorts } from "../../browser/sessionReap.js";
import { cachePaths } from "../../cacheHome.js";
import { derivedRowState } from "../../handover/derivedRowState.js";
import { type HandoverDoc, isTerminalDocStatus, parseHandoverDoc } from "../../handover/doc.js";
import { readRunJournal } from "../../handover/runStore.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { defaultSessionsDir } from "../../measurement/sessions.js";
import { scanSessions } from "../../sessions/liveSessionStore.js";
import type { SessionRecord } from "../../sessions/liveSessions.js";
import { stateHomePaths } from "../../stateHome.js";
import { type ProcessRow, parseProcessRows } from "../standing/processes.js";
import { devServers, servingPids } from "./devServerCensus.js";
import { type StrayDevServer, strayDevServers } from "./devServers.js";
import { parseElapsedRows } from "./fleetLoad.js";
import { ownAncestry } from "./reap.js";

/** More stdout than an `lsof` over a handful of pids produces, so a read never dies of ENOBUFS. */
const MAX_BUFFER = 4 * 1024 * 1024;

/** How long the cwd read may block. One local snapshot — quick, or broken. */
const READ_TIMEOUT_MS = 10_000;

/**
 * Each pid's current working directory, as `lsof` reports it.
 *
 * A pid `lsof` could not answer for is simply absent from the map, which `./devServers.ts` treats as
 * unclassifiable and therefore leaves alone.
 *
 * @param pids the candidate pids — bounded to processes that already matched, never the whole table
 * @returns the cwd by pid, empty when the read failed entirely
 */
export function readCwds({ pids }: { pids: readonly number[] }): ReadonlyMap<number, string> {
  const cwds = new Map<number, string>();
  if (pids.length === 0) {
    return cwds;
  }
  let text: string;
  try {
    text = execFileSync("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-Fn"], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      timeout: READ_TIMEOUT_MS,
    });
  } catch {
    return cwds;
  }
  return parseLsofCwds({ text });
}

/**
 * Every live process's working directory, or why the table could not be read — the one reading here that
 * spans the whole table, because `worktree prune` asks whether ANY process stands in a tree, and a pid list
 * it would bound the read to does not exist.
 *
 * Unlike {@link readCwds}, a failure is an error and never an empty map: an empty map reads as "nothing is
 * working anywhere", which is the reading that deletes a tree in use. Root-owned processes are simply absent
 * from `lsof`'s answer without failing it, and none of them is an agent of the owner's. MEASURED: exit 0,
 * under a second, 463 of 730 pids answered — `lsof -a -d cwd -Fn | grep -c '^p'` against `ps -ax -o pid= | wc -l`.
 *
 * @returns the cwd by pid, or the reason the table could not be read
 */
export function readEveryCwd(): Result<ReadonlyMap<number, string>> {
  try {
    const text = execFileSync("lsof", ["-a", "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      timeout: READ_TIMEOUT_MS,
    });
    return ok(parseLsofCwds({ text }));
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    return err([`lsof could not read every live process's working directory — ${why}`]);
  }
}

/**
 * Decode `lsof -Fn`'s field output: a `p<pid>` line, then that pid's `n<path>` line.
 *
 * Pure, and exported because the format is the thing worth a test — a field set whose `n` line arrives
 * before any `p` line belongs to no pid and is dropped rather than attributed to the previous one.
 *
 * @param text `lsof -a -d cwd -p <csv> -Fn`'s stdout
 * @returns the cwd by pid
 */
export function parseLsofCwds({ text }: { text: string }): ReadonlyMap<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      const parsed = Number(line.slice(1));
      pid = Number.isInteger(parsed) ? parsed : undefined;
      continue;
    }
    if (line.startsWith("n") && pid !== undefined) {
      cwds.set(pid, line.slice(1));
    }
  }
  return cwds;
}

/**
 * The worktrees a LIVE Claude Code session is sitting in — a registry row whose pid is in the snapshot.
 *
 * @param processes the `ps` snapshot this verb already took, which is what makes a registry row live
 * @param sessionsDir the session registry directory (defaults to `~/.claude/sessions`)
 * @returns one path per live session, or `undefined` when the registry itself could not be read — which
 *   switches the seat criterion off rather than reporting that nothing is live
 */
export function liveSeatWorktrees({
  processes,
  sessionsDir = defaultSessionsDir(),
}: {
  processes: readonly ProcessRow[];
  sessionsDir?: string;
}): readonly string[] | undefined {
  const records = liveSessionRecords({ processes, sessionsDir });
  if (records === undefined) {
    return undefined;
  }
  return records.map((record) => record.cwd);
}

/**
 * The live Claude Code sessions a browser session's recorded opener is judged against
 * (`../../browser/sessionReap.ts`) — STRICTER than the seat reading above, because what it feeds closes tabs.
 *
 * A registry file that would not decode is a session this reading cannot see, and "cannot see" would become
 * "dead" one step later. So a refused file whose pid (its file name) is in the snapshot switches the whole
 * reading off. A refused file for a pid that is gone hides nobody live and is ignored — otherwise one torn
 * file left by a crashed session would disable the class forever.
 *
 * @param processes the `ps` snapshot, which is what makes a registry row live
 * @param sessionsDir the session registry directory (defaults to `~/.claude/sessions`)
 * @returns one row per live session, or `undefined` when the registry could not be read in full
 */
export function readLiveBrowserOwners({
  processes,
  sessionsDir = defaultSessionsDir(),
}: {
  processes: readonly ProcessRow[];
  sessionsDir?: string;
}): readonly { readonly pid: number; readonly sessionId: string }[] | undefined {
  const scan = scanSessions({ sessionsDir });
  if (scan.unreadable !== undefined) {
    return undefined;
  }
  const alive = new Set(processes.map((row) => row.pid));
  const hidesALiveSession = scan.refused.some((refusal) => alive.has(Number.parseInt(refusal, 10)));
  if (hidesALiveSession) {
    return undefined;
  }
  return scan.records
    .filter((record) => alive.has(record.pid))
    .map((record) => ({ pid: record.pid, sessionId: record.sessionId }));
}

/**
 * Every TCP port something on this machine listens on — whether a localhost page still has a server.
 *
 * One `lsof` over the listening sockets, whatever the process: a session's page may be served by anything,
 * not only a docs dev server. MEASURED, 31 listening sockets (repro:
 * `lsof -nP -iTCP -sTCP:LISTEN -Fn`).
 *
 * @returns the ports, or `undefined` when the listing could not be taken
 */
export function readListeningPorts(): ReadonlySet<number> | undefined {
  try {
    const text = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fn"], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      timeout: READ_TIMEOUT_MS,
    });
    return parseListeningPorts({ text });
  } catch {
    return undefined;
  }
}

/*
 * Every registry row whose pid is in the snapshot — the one reading both seat questions are asked of.
 *
 * It is scanned once per QUESTION, not once per verb: `machine reap` injects `liveWorktrees` and
 * `liveStarterRootPids` as two separate seams, so a tick reads the registry twice. That is ~38 files of a few
 * hundred bytes each on this machine and it is not worth a shared reading that would have to be threaded
 * through both seams — but it is two reads, not one, and a caller measuring tick cost should know it.
 */
function liveSessionRecords({
  processes,
  sessionsDir,
}: {
  processes: readonly ProcessRow[];
  sessionsDir: string;
}): readonly SessionRecord[] | undefined {
  const scan = scanSessions({ sessionsDir });
  if (scan.unreadable !== undefined) {
    return undefined;
  }
  const alive = new Set(processes.map((row) => row.pid));
  return scan.records.filter((record) => alive.has(record.pid));
}

/** What one `scripts/docs-site.sh` run record says about who started a server. */
export interface DocsSiteStarter {
  /** The recorded server's own pid — the yarn wrapper, which is `devServers.ts`'s `rootPid`. */
  readonly rootPid: number;
  /** The Claude Code session that ran the start, or `undefined` when nothing recorded one. */
  readonly starterPid: number | undefined;
  /** That session's id, which is what makes a recycled starter pid detectable. */
  readonly starterSessionId: string | undefined;
}

/**
 * Decode one docs-site run record.
 *
 * Pure, and exported because the format is the thing worth a test: a record written before the starter fields
 * existed decodes with both of them absent, which protects nothing, and that is the deliberate answer rather
 * than a guess at who started it.
 *
 * @param text the record file's contents
 * @returns what it says about the starter, or `undefined` when it is not a record with a numeric `pid`
 */
export function parseDocsSiteStarter({ text }: { text: string }): DocsSiteStarter | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded)) {
    return undefined;
  }
  const rootPid = decoded["pid"];
  if (typeof rootPid !== "number") {
    return undefined;
  }
  const starterPid = decoded["starterPid"];
  const starterSessionId = decoded["starterSessionId"];
  return {
    rootPid,
    starterPid: typeof starterPid === "number" ? starterPid : undefined,
    starterSessionId: typeof starterSessionId === "string" ? starterSessionId : undefined,
  };
}

/**
 * Which recorded servers were started by a session that is STILL LIVE.
 *
 * Pure, and the whole judgement of the reading: a starter counts only when the live registry row at that pid
 * carries the same session id the record named. A pid alone would be enough right up to the moment the kernel
 * recycles one, and then it would keep a dead seat's server alive forever under another session's name.
 *
 * @param starters one entry per readable docs-site run record
 * @param liveSessions the registry rows whose pid is in the process snapshot
 * @returns the root pids a live session started
 */
export function liveStarterRootPidsOf({
  starters,
  liveSessions,
}: {
  starters: readonly DocsSiteStarter[];
  liveSessions: readonly SessionRecord[];
}): ReadonlySet<number> {
  const sessionIdByPid = new Map(liveSessions.map((record) => [record.pid, record.sessionId]));
  const protectedPids = new Set<number>();
  for (const starter of starters) {
    if (starter.starterPid === undefined || starter.starterSessionId === undefined) {
      continue;
    }
    if (sessionIdByPid.get(starter.starterPid) === starter.starterSessionId) {
      protectedPids.add(starter.rootPid);
    }
  }
  return protectedPids;
}

/**
 * The root pids whose docs-site run record names a live session — criterion 1's second half.
 *
 * @param processes the `ps` snapshot, which is what makes a registry row live
 * @param home the Slopweaver state home whose legacy `docs-site/` is also read
 * @param cacheRoot the cache root holding the current `docs-site/`, this process's own when omitted
 * @param sessionsDir the session registry directory (defaults to `~/.claude/sessions`)
 * @returns the protected root pids, or `undefined` when the records or the registry could not be read at all
 *   — which switches the whole seat criterion off rather than leaving its worktree half to fire alone
 */
export function readLiveStarterRootPids({
  processes,
  home,
  cacheRoot,
  sessionsDir = defaultSessionsDir(),
}: {
  processes: readonly ProcessRow[];
  home?: string;
  cacheRoot?: string;
  sessionsDir?: string;
}): ReadonlySet<number> | undefined {
  const liveSessions = liveSessionRecords({ processes, sessionsDir });
  if (liveSessions === undefined) {
    return undefined;
  }
  // The records live under the cache root; the home's legacy directory is read too, because a server started before
  // the move recorded itself there and is protected exactly as long as its session lives. The home is read FIRST:
  // records only ever move from it to the cache root, so one moving between the two reads is seen in the second.
  const fromHome = startersIn({ dir: stateHomePaths(home === undefined ? {} : { home }).homeDocsSite });
  const fromCache = startersIn({ dir: cachePaths(cacheRoot === undefined ? {} : { root: cacheRoot }).docsSite });
  if (fromHome === undefined || fromCache === undefined) {
    return undefined;
  }
  return liveStarterRootPidsOf({ liveSessions, starters: fromHome.concat(fromCache) });
}

/* Every decodable starter recorded in one docs-site directory, or `undefined` when it could not be listed. */
function startersIn({ dir }: { dir: string }): readonly DocsSiteStarter[] | undefined {
  let names: readonly string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch (error: unknown) {
    // ENOENT is a directory no docs site was ever served from, which is a MEASURED empty set: no server can
    // have been recorded there, so none is protected. Any other failure is a reading that was not taken.
    if (isRecord(error) && error["code"] === "ENOENT") {
      return [];
    }
    return undefined;
  }
  const starters: DocsSiteStarter[] = [];
  for (const name of names) {
    const starter = readStarter({ path: join(dir, name) });
    if (starter !== undefined) {
      starters.push(starter);
    }
  }
  return starters;
}

/* One record file's starter, or `undefined` when it could not be read or did not decode. */
function readStarter({ path }: { path: string }): DocsSiteStarter | undefined {
  try {
    return parseDocsSiteStarter({ text: readFileSync(path, "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * The whole stray-dev-server reading, taken end to end: one `ps`, one `ps -o etime`, one bounded `lsof`
 * over the pids that matched, the session registry, and one board row per worktree that has a server.
 *
 * `slopweaver perf` calls this; `slopweaver machine reap` composes the same pieces through its own injected
 * seams, because it is the verb that signals and a test of it must never shell out at all.
 *
 * @param selfPid the calling process, whose whole ancestry is excluded (defaults to this process)
 * @returns the stray servers, or `undefined` when the process table itself could not be read — which is
 *   what keeps an unreadable machine from reporting a clean one
 */
export function readStrayDevServers({ selfPid = process.pid }: { selfPid?: number } = {}):
  readonly StrayDevServer[] | undefined {
  const table = snapshot({ args: ["-ax", "-o", "pid=,ppid=,args="] });
  if (table === undefined) {
    return undefined;
  }
  const processes = parseProcessRows({ text: table });
  const etime = snapshot({ args: ["-ax", "-o", "pid=,etime="] });
  const elapsedRows = etime === undefined ? [] : parseElapsedRows({ text: etime });
  const cwdByPid = readCwds({ pids: servingPids({ processes }) });
  const worktrees = [
    ...new Set(devServers({ cpuRows: [], cwdByPid, elapsedRows, processes }).map((server) => server.worktree)),
  ];
  return strayDevServers({
    input: {
      cpuRows: [],
      cwdByPid,
      elapsedRows,
      liveStarterRootPids: readLiveStarterRootPids({ processes }),
      liveWorktrees: liveSeatWorktrees({ processes }),
      processes,
      protectedPids: ownAncestry({ processes, selfPid }),
      terminalSlugs: terminalRowSlugs({ worktrees }),
    },
  }).stray;
}

/**
 * The process table as `pid ppid args`, or `undefined` when `ps` could not be read — never an empty table,
 * because every class that reads it treats an ABSENT process as dead, and an unreadable machine read as an
 * empty one would kill or forget everything.
 *
 * @returns the rows, or `undefined`
 */
export function readProcessTable(): readonly ProcessRow[] | undefined {
  const table = snapshot({ args: ["-ax", "-o", "pid=,ppid=,args="] });
  if (table === undefined) {
    return undefined;
  }
  return parseProcessRows({ text: table });
}

/*
 * One `ps` listing's stdout, or `undefined` when the read failed.
 *
 * The binary is a constant here rather than a parameter, so the sanctioned-seam entry in
 * `src/admit/coverage.ts` — "two read-only `ps` listings" — is true of the signature and not merely of the
 * two call sites above it, which a later caller could otherwise widen without touching that list.
 */
function snapshot({ args }: { args: readonly string[] }): string | undefined {
  try {
    return execFileSync("ps", [...args], { encoding: "utf8", maxBuffer: MAX_BUFFER, timeout: READ_TIMEOUT_MS });
  } catch {
    return undefined;
  }
}

/* One slug's board row, or `undefined` when there is no readable doc for it. */
function boardRow({ handovers, slug }: { handovers: string; slug: string }): HandoverDoc | undefined {
  const path = join(handovers, `${slug}.md`);
  try {
    return parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Which of the named worktrees' board rows are terminal — `done`, `cancelled` or `rejected` by the DERIVED
 * state, never by the authored `status:` line, which is the field that goes stale.
 *
 * Bounded to the slugs handed in (one doc and one journal each), never a whole-board scan: this runs on
 * every `perf` tick, and the board is hundreds of rows.
 *
 * @param worktrees the worktrees that actually have a dev server; each one's basename is its slug
 * @param home the Slopweaver state home holding `handovers/` and `runs/`
 * @returns the terminal slugs, or `undefined` when not one row could be read at all
 */
export function terminalRowSlugs({
  worktrees,
  home,
}: {
  worktrees: readonly string[];
  home?: string;
}): ReadonlySet<string> | undefined {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  const terminal = new Set<string>();
  let read = 0;
  for (const worktree of worktrees) {
    const slug = basename(worktree);
    const doc = boardRow({ handovers: paths.handovers, slug });
    if (doc === undefined) {
      // A worktree with no board row is ordinary — a scratch tree, or a row already archived. It simply
      // cannot satisfy this criterion, and says nothing about the other two.
      continue;
    }
    read += 1;
    const journal = readRunJournal({ runsDir: paths.runs, slug });
    const events = journal.isOk() ? journal.value.events : [];
    if (isTerminalDocStatus(derivedRowState({ doc, events }).status)) {
      terminal.add(slug);
    }
  }
  if (read === 0 && worktrees.length > 0) {
    return undefined;
  }
  return terminal;
}
