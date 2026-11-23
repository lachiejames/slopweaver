/**
 * Which browser interaction sessions `machine reap` lets go of — judged by whether the session that OPENED
 * each one is still alive, and by whether any command can still act through it; never by how long ago it
 * was opened.
 *
 * ## The asks this answers
 *
 * The owner saw a Dock full of nine Chrome windows: agents open localhost and
 * provider tabs through `browser open` and never close them, and the owner could not tell which of the rest were
 * safe to close. MEASURED: `slopweaver browser sessions` listed 56 records with a URL and no
 * owner, 19 of them still held by a `cliDaemon.js` process, most on a localhost port whose dev server was
 * gone. The owner's mechanism: **ownership at open, liveness at reap, never age, never a promise.**
 *
 * A later screen held eleven blank Chrome windows. MEASURED: every one was held by
 * ONE live seat, one `browser open` per page it looked at over four hours, each untouched for
 * between 41 minutes and three hours, and each kept because its opener lived. Reproduce the listing with
 * `slopweaver browser sessions`. A live opener is not the same as a live SESSION.
 *
 * - **Never age from open.** A session some live seat opened three hours ago and still reads is the legit
 *   long-lived browser the owner wants kept: every command through it bumps `touchedAtIso`.
 * - **Idle expiry is the bound.** A session untouched for `INTERACTION_SESSION_TTL_MS` is one no later
 *   command may act through (`liveSession` answers `SESSION_IDLE`, and asks for a fresh `open`), so its
 *   window is held for nobody — its own opener included. A BACKGROUND session past that expiry is let go of
 *   whoever opened it. A FOREGROUND one (`browser present`, `SLOPWEAVER_BROWSER_FOREGROUND=1`) is a window
 *   opened to be shown to the owner and may be what they are looking at, so it stays under the opener rule alone.
 * - **Never a promise.** `browser close` stays the polite path, but a session that dies never says it is
 *   done, so a reap cannot rest on one.
 *
 * ## The verdicts, in the order they are decided
 *
 * 1. **Two records share a client name and a daemon carries it → keep**: the daemon cannot be attributed.
 * 2. **Owner dead** — its recorded pid is gone from the snapshot, or (with no pid recorded, and no daemon
 *    holding the tab — a `/clear` retires the id too, so a daemon-held one is unknown) no live session carries
 *    its id → close through the client when its daemon still holds the connection, else forget the record.
 * 3. **Background and idle past its expiry → close or forget** the same way, whoever its owner, because
 *    nothing can act through it.
 * 4. **Owner live → keep**, whatever its page. A live seat restarting its dev server must not lose its tab to
 *    the second the port was down.
 * 5. **Owner unknown** (a Codex host, a legacy record with no id, an unreadable registry) → close or forget
 *    only when its page is a localhost port with NOTHING listening, which no reader can still want. Every
 *    other unknown session is left alone and says why — an unknown owner is not a dead one.
 *
 * "Close" is the client's own `tab-close` + `detach`, exactly what `browser close` sends. "Forget" is for a
 * record whose `cliDaemon.js` process is already gone: nothing holds a CDP connection to its tab, so nothing
 * here can reach it, and the record only makes `browser sessions` lie. The tab, if Chrome still shows one, is
 * the kind Chrome labels "not connected to Playwright" — a window the owner can close by sight, and the report
 * counts them so the owner knows how many to expect.
 *
 * Pure: every reading is passed in, and a reading that could not be taken arrives `undefined` and switches
 * its criterion OFF rather than reading as "nothing live" — the same distinction
 * `../live/machine/devServers.ts` draws, for the same reason.
 */
import { INTERACTION_SESSION_TTL_MS, type InteractionSession } from "./interactionSession.js";

/** What a reap will do to one session. */
export type BrowserReapAction = "keep" | "close" | "forget";

/** Whether the opener is still there. */
export type OwnerLiveness = "live" | "dead" | "unknown";

/** One process in the snapshot, as much of it as this judgement reads. */
export interface ReapProcess {
  readonly pid: number;
  readonly argv: string;
}

/** One Claude Code registry row whose pid is in the snapshot. */
export interface LiveRegistryRow {
  readonly pid: number;
  readonly sessionId: string;
}

/** Everything one reap judgement reads, each reading taken once by the caller. */
export interface BrowserReapInput {
  /** Every session record the home holds, with the page its last look was of (`null` when never read). */
  readonly sessions: readonly { readonly session: InteractionSession; readonly url: string | null }[];
  readonly processes: readonly ReapProcess[];
  /** The live registry rows, or `undefined` when the registry could not be read. */
  readonly liveRegistry: readonly LiveRegistryRow[] | undefined;
  /** Every TCP port something on this machine listens on, or `undefined` when that could not be read. */
  readonly listeningPorts: ReadonlySet<number> | undefined;
  /** The instant idle expiry is judged against, read once by the caller. */
  readonly nowIso: string;
}

/** One session, judged. */
export interface BrowserReapVerdict {
  readonly id: string;
  readonly clientSession: string;
  readonly url: string | null;
  readonly owner: OwnerLiveness;
  /** Why the owner was judged that way, in a phrase a report prints. */
  readonly ownerWhy: string;
  /** The `cliDaemon.js` processes holding this session's connection, empty when none does. */
  readonly daemonPids: readonly number[];
  readonly action: BrowserReapAction;
  /** Why this action, in a phrase a report prints. */
  readonly why: string;
  /**
   * The `touchedAtIso` an idle-expiry verdict was judged on, `null` for every other verdict. The executor re-reads
   * the record before acting and leaves it alone when a command has touched it since.
   */
  readonly idleJudgedOn: string | null;
}

/** The session id a record carries when no agent session named itself (`sessionShell.ts`'s `ownerSessionId`). */
const UNNAMED_SESSION = "unknown-session";

/** The host names that are this machine. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The `cliDaemon.js` processes holding one client session — measured as
 * `node …/playwright-core/lib/entry/cliDaemon.js slopweaver-<id8> --browser=chrome --extension`.
 *
 * Matched by POSITION, because what it returns may be signalled: `node` is the program, the playwright-core
 * daemon entry is its script, and the session name is that script's first argument, whole. A process that
 * merely CARRIES those words — a `grep`, an editor, a worker handed the path as an argument — is not a daemon.
 * Every match is carried rather than the first: two daemons under one name is a
 * state this cannot explain, and the executor refuses to signal either rather than guess.
 *
 * @param processes the snapshot
 * @param clientSession the name the client knows the session by
 * @returns the daemons' pids, empty when none holds the session
 */
export function daemonPidsOf({
  processes,
  clientSession,
}: {
  processes: readonly ReapProcess[];
  clientSession: string;
}): readonly number[] {
  return processes
    .filter((row) => {
      const [program, script, session] = row.argv.split(/\s+/u);
      const isNode = program === "node" || program?.endsWith("/node") === true;
      const isDaemon = script?.endsWith(DAEMON_ENTRY) === true;
      return isNode && isDaemon && session === clientSession;
    })
    .map((row) => row.pid);
}

/* The daemon's own script, as `ps` prints it under any checkout's `node_modules`. */
const DAEMON_ENTRY = "/playwright-core/lib/entry/cliDaemon.js";

/**
 * The loopback port a page is served on, when it is on this machine at all.
 *
 * @param url the page's address
 * @returns the port, or `null` for any page not on a loopback host or not parseable
 */
export function loopbackPortOf({ url }: { url: string }): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    return null;
  }
  if (parsed.port !== "") {
    return Number(parsed.port);
  }
  if (parsed.protocol === "https:") {
    return 443;
  }
  if (parsed.protocol === "http:") {
    return 80;
  }
  return null;
}

/**
 * Decode `lsof -nP -iTCP -sTCP:LISTEN -Fn`'s name lines into the set of ports something listens on.
 *
 * A listener on any address counts — `*:3000`, `127.0.0.1:3000` and `[::1]:3000` all serve `localhost:3000`
 * to somebody — so this can only ever UNDER-report a dead port, which is the safe direction.
 *
 * @param text the listing
 * @returns the listening ports
 */
export function parseListeningPorts({ text }: { text: string }): ReadonlySet<number> {
  const ports = new Set<number>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("n")) {
      continue;
    }
    const colon = line.lastIndexOf(":");
    if (colon < 0) {
      continue;
    }
    const port = Number(line.slice(colon + 1));
    if (Number.isInteger(port) && port > 0) {
      ports.add(port);
    }
  }
  return ports;
}

/**
 * Whether the session that opened one browser session is still alive, and why.
 *
 * A recorded pid decides first and alone, because it is the strongest reading: live while it is in the
 * snapshot, dead once it is not. No registry row is asked for, because every way of asking was wrong in the
 * direction that closes a live seat's tab: a session under another CLAUDE_CONFIG_DIR files its row where this
 * read never looks, and a program-name check misses `node …/cli.js`. A pid the
 * kernel recycled keeps a dead opener's tab until that process exits too, which costs a tab and never closes
 * one. No session id is compared either — `/clear` mints a new id in the same process, and the tab belongs to
 * the process the owner is watching. A legacy record with no pid falls back to its session id. A finished run is deliberately NOT a criterion: a live opener's tab is kept however
 * its run ended, and a parked seat's tab goes when the sweep closes the seat.
 *
 * @param session the record
 * @param processes the snapshot
 * @param liveRegistry the live registry rows, or `undefined` when unreadable
 * @returns the verdict and its phrase
 */
export function ownerLiveness({
  session,
  processes,
  liveRegistry,
}: {
  session: InteractionSession;
  processes: readonly ReapProcess[];
  liveRegistry: readonly LiveRegistryRow[] | undefined;
}): { readonly owner: OwnerLiveness; readonly why: string } {
  const pid = session.owner === null ? null : session.owner.pid;
  if (pid !== null) {
    if (processes.some((row) => row.pid === pid)) {
      return { owner: "live", why: `its opener pid ${String(pid)} is alive` };
    }
    return { owner: "dead", why: `its opener pid ${String(pid)} is gone` };
  }
  if (liveRegistry === undefined) {
    return { owner: "unknown", why: "the Claude Code session registry could not be read" };
  }
  const sessionId = session.ownerSessionId;
  if (sessionId === "" || sessionId === UNNAMED_SESSION) {
    return { owner: "unknown", why: "no opener was recorded" };
  }
  if (liveRegistry.some((row) => row.sessionId === sessionId)) {
    return { owner: "live", why: `its opener session ${sessionId.slice(0, 8)} is alive` };
  }
  return { owner: "dead", why: `no live Claude Code session is ${sessionId.slice(0, 8)}` };
}

/**
 * Assemble the judgement's input from the stored records and the machine readings.
 *
 * @param stored every readable session record, with its last look
 * @param processes the one `ps` snapshot this judgement shares with whatever else the caller reads
 * @param readers the machine readings, each answering `undefined` when it could not be taken
 * @param nowIso the instant idle expiry is judged against
 * @returns the input {@link judgeBrowserSessions} reads
 */
export function gatherBrowserReapInput({
  stored,
  processes,
  readers,
  nowIso,
}: {
  stored: readonly { readonly session: InteractionSession; readonly observation: { readonly url: string } | null }[];
  processes: readonly ReapProcess[];
  readers: {
    readonly liveOwners: () => readonly LiveRegistryRow[] | undefined;
    readonly listeningPorts: () => ReadonlySet<number> | undefined;
  };
  nowIso: string;
}): BrowserReapInput {
  return {
    listeningPorts: readers.listeningPorts(),
    liveRegistry: readers.liveOwners(),
    nowIso,
    processes,
    sessions: stored.map(({ session, observation }) => ({
      session,
      url: observation === null ? null : observation.url,
    })),
  };
}

/**
 * How long a BACKGROUND session has sat idle, when that is past the expiry after which no command may act through it.
 *
 * Its own reading rather than `sessionIsLive`'s negation, because the two answer an unreadable timestamp in
 * opposite directions on purpose: a command refuses to act through a session it cannot date, while a reap that
 * cannot date one must not close it on that alone — an unreadable reading switches a criterion OFF here.
 *
 * @param session the record
 * @param nowIso the instant to judge against
 * @returns whole minutes idle, or `null` when it is foreground, still within its expiry, or cannot be dated
 */
export function expiredIdleMinutes({
  session,
  nowIso,
}: {
  session: InteractionSession;
  nowIso: string;
}): number | null {
  if (session.placement !== "background") {
    return null;
  }
  const touched = Date.parse(session.touchedAtIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(touched) || Number.isNaN(now)) {
    return null;
  }
  const idleMs = now - touched;
  if (idleMs < INTERACTION_SESSION_TTL_MS) {
    return null;
  }
  return Math.floor(idleMs / 60_000);
}

/**
 * The sessions one opener holds that have gone quiet past their expiry — what `browser open` lets go of before it
 * takes another window, so a seat holds no more than the sessions it used in the last fifteen minutes even between
 * two sweep ticks.
 *
 * @param sessions every stored record
 * @param ownerPid the opening Claude Code process (`CLAUDE_PID`); `null` on a host that records none, which owns nothing
 * @param nowIso the instant to judge expiry against
 * @returns the ids of that opener's background sessions past their idle expiry
 */
export function ownExpiredSessionIds({
  sessions,
  ownerPid,
  nowIso,
}: {
  sessions: readonly { readonly session: InteractionSession }[];
  ownerPid: number | null;
  nowIso: string;
}): ReadonlySet<string> {
  if (ownerPid === null) {
    return new Set();
  }
  return new Set(
    sessions
      .filter(({ session }) => session.owner?.pid === ownerPid)
      .filter(({ session }) => expiredIdleMinutes({ nowIso, session }) !== null)
      .map(({ session }) => session.id),
  );
}

/**
 * Judge every session: keep, close or forget, each with the reason a report prints.
 *
 * @param input the readings, each taken once
 * @returns one verdict per session, in the order given
 */
export function judgeBrowserSessions({ input }: { input: BrowserReapInput }): readonly BrowserReapVerdict[] {
  const sharing = new Map<string, number>();
  for (const { session } of input.sessions) {
    const counted = sharing.get(session.clientSession);
    sharing.set(session.clientSession, counted === undefined ? 1 : counted + 1);
  }
  return input.sessions.map(({ session, url }) =>
    judgeOneSession({ input, session, sharers: sharing.get(session.clientSession)!, url }),
  );
}

/* Judge one session against the shared readings; `sharers` is how many records carry its client name. */
function judgeOneSession({
  input,
  session,
  sharers,
  url,
}: {
  input: BrowserReapInput;
  session: InteractionSession;
  sharers: number;
  url: string | null;
}): BrowserReapVerdict {
  const daemonPids = daemonPidsOf({ clientSession: session.clientSession, processes: input.processes });
  const { owner, ownerWhy } = attributedOwner({ daemonPids, input, session });
  const base = {
    clientSession: session.clientSession,
    daemonPids,
    id: session.id,
    idleJudgedOn: null,
    owner,
    ownerWhy,
    url,
  };
  const letGo: BrowserReapAction = daemonPids.length === 0 ? "forget" : "close";
  // The client name is the id's first eight characters, so two records can share one, and a daemon carrying it
  // then belongs to either: none of them is acted on through it.
  if (sharers > 1 && daemonPids.length > 0) {
    return {
      ...base,
      action: "keep",
      why: `${String(sharers)} records share ${session.clientSession}, so its daemon cannot be attributed to one`,
    };
  }
  if (owner === "dead") {
    return { ...base, action: letGo, why: ownerWhy };
  }
  // Whoever opened it, a background session past its idle expiry is one no command may act through any more
  // (eleven such windows were once held open by one live seat).
  const idleMinutes = expiredIdleMinutes({ nowIso: input.nowIso, session });
  if (idleMinutes !== null) {
    return {
      ...base,
      action: letGo,
      idleJudgedOn: session.touchedAtIso,
      why: `idle ${String(idleMinutes)}m, past its ${String(INTERACTION_SESSION_TTL_MS / 60_000)}-minute expiry, so no command can act through it`,
    };
  }
  if (owner === "live") {
    return { ...base, action: "keep", why: ownerWhy };
  }
  // Only an owner NOTHING could identify — the registry read fine and the record names no one it could find —
  // is judged by its page. An owner that is unknown because the registry could not be read may be a live
  // one, and an unreadable reading never widens what is reaped.
  const port = url === null ? null : loopbackPortOf({ url });
  const portsSay = input.listeningPorts !== undefined && input.liveRegistry !== undefined;
  if (port !== null && portsSay && !input.listeningPorts.has(port)) {
    return { ...base, action: letGo, why: `nothing listens on localhost:${String(port)} any more` };
  }
  return { ...base, action: "keep", why: `owner unknown (${ownerWhy}), so it is left alone` };
}

/*
 * Who opened a session, and why that is the reading. A record from before openers were recorded names only a
 * conversation id, and `/clear` retires that id while the process that opened the tab lives on — so its absence may
 * be an exit or a /clear, and nothing here tells them apart. A tab a daemon still holds is therefore not closed on it;
 * one no daemon holds is only a file, and forgetting it closes nothing.
 */
function attributedOwner({
  daemonPids,
  input,
  session,
}: {
  daemonPids: readonly number[];
  input: BrowserReapInput;
  session: InteractionSession;
}): { readonly owner: OwnerLiveness; readonly ownerWhy: string } {
  const judged = ownerLiveness({ liveRegistry: input.liveRegistry, processes: input.processes, session });
  const clearedOrGone = judged.owner === "dead" && session.owner === null && daemonPids.length > 0;
  if (clearedOrGone) {
    return {
      owner: "unknown",
      ownerWhy: `${judged.why}, and a record with no opener pid cannot tell a /clear from an exit`,
    };
  }
  return { owner: judged.owner, ownerWhy: judged.why };
}
