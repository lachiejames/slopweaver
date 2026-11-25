/**
 * Which Claude Code session a parking seat IS, and what `session close-done` may do with it — pure.
 *
 * Rule: a parked session leaves the fleet immediately; it is closed, its state tracked, and it is resumed
 * when wanted. A seat is parked
 * when it looks frozen and runs no shell that will complete. The screen says the first half; this module binds
 * the seat to the ONE registry session running in its workspace's process tree, so the checkpoint is written for
 * the session that actually holds the run and never for a stranger in the same directory.
 *
 * Four facts bind it, each failing closed:
 *
 * - exactly one registry record's pid sits in the workspace's process tree, and no registry file this build
 *   refused could matter — a refused file on a running pid, in the tree or out of it, or with no pid, keeps it;
 * - that pid runs the very process the record names, `procStart` against a fresh `ps -o lstart=` listing
 *   (`../fleet/liveSeat.ts`), so a recycled pid is not the session;
 * - the record's own status reads `idle` — Claude Code publishes `busy` mid-turn and `shell` while a background
 *   shell runs (measured on this fleet), and either is a working seat;
 * - no OTHER live process runs that session, anywhere on the machine.
 */
import { lstartMs } from "#lib/lstart.js";

import { isLiveSeat } from "../fleet/liveSeat.js";
import type { RowPullRequests } from "../hand/rowPullRequest.js";
import type { RunEvent } from "../handover/ledger.js";
import { activeParkedCheckpoint } from "../handover/parked.js";
import type { ParkedEvent } from "../handover/parkedEvent.js";
import { parkHolder } from "../handover/parkPolicy.js";
import type { RunWriter } from "../handover/runOwner.js";
import { nextWriter } from "../handover/runWriterStep.js";
import type { SupervisorHost, VisibleSessionHost } from "../supervisor/session.js";
import type { SessionRecord } from "./liveSessions.js";

/** The one session a seat runs, or why it cannot be named. */
export type SeatIdentity =
  | {
      readonly kind: "identified";
      /** Which visible host's evidence bound it: Claude's registry, or Codex's screen and open files (`./codexParkSeat.ts`). */
      readonly host: VisibleSessionHost;
      /** The Claude Code session id, or the Codex thread id. */
      readonly sessionId: string;
      readonly pid: number;
      /** When its process started, from `procStart`, to the second. */
      readonly startedIso: string;
      /** The registry's own `idle` / `busy` / `shell`; a Codex seat is `idle` only on its own composer at rest. */
      readonly status: string;
    }
  | { readonly kind: "unidentified"; readonly why: string };

/**
 * Why a seat names no Claude Code session when the registry read clean and no record's pid sits in its tree — the
 * one Claude answer after which `close-done` asks Codex's evidence instead.
 */
export const NO_CLAUDE_SESSION_IN_TREE = "no Claude Code session runs in its process tree";

/** A refused registry file name's leading pid — `12345.json: why` — or `undefined` when it carries none. */
const REFUSED_PID = /^(\d+)\.json:/u;

/**
 * The one Claude Code session running in a workspace, bound to its process.
 *
 * @param records every registry record that read
 * @param refused every registry file that did not, as `<name>: why`
 * @param treePids every pid in the workspace's process tree
 * @param starts each running pid's start stamp, from one `ps` listing under `TZ=UTC LC_ALL=C`
 * @returns the session, or why it cannot be named
 */
export function identifyParkSeat({
  records,
  refused,
  treePids,
  starts,
}: {
  records: readonly SessionRecord[];
  refused: readonly string[];
  treePids: readonly number[];
  starts: ReadonlyMap<number, string>;
}): SeatIdentity {
  const pids = new Set(treePids);
  const unreadable = refusedMayBeSeat({ pids, refused, starts });
  if (unreadable !== undefined) {
    return {
      kind: "unidentified",
      why: `a registry file this build could not read may be its session (${unreadable})`,
    };
  }
  const inTree = records.filter((record) => pids.has(record.pid));
  const [only] = inTree;
  if (only === undefined) {
    return { kind: "unidentified", why: NO_CLAUDE_SESSION_IN_TREE };
  }
  if (inTree.length > 1) {
    return {
      kind: "unidentified",
      why: `${String(inTree.length)} Claude Code sessions run in its process tree (${inTree.map((record) => record.sessionId).join(", ")})`,
    };
  }
  if (!isLiveSeat({ record: only, starts })) {
    return {
      kind: "unidentified",
      why: `pid ${String(only.pid)} is not the interactive process its registry record names`,
    };
  }
  const twins = liveTwinPids({ only, records, starts });
  if (twins !== undefined) {
    return { kind: "unidentified", why: `session ${only.sessionId} also runs as pid ${twins}` };
  }
  const startedIso = lstartToIso({ text: only.procStart! });
  if (startedIso === undefined) {
    return { kind: "unidentified", why: `its process start "${only.procStart!}" does not read as a time` };
  }
  return {
    host: "claude-code",
    kind: "identified",
    pid: only.pid,
    sessionId: only.sessionId,
    startedIso,
    status: only.status,
  };
}

/**
 * Every other record that may be the same session running live elsewhere.
 *
 * The journal's holder pid cannot bind the seat: a `--resume` relaunch keeps the session and journals no new pid
 * (measured — every live holder's journalled pid was dead). So the session must run in THIS process
 * and no other live one, or a checkpoint written for it could release a twin still working elsewhere. Disproving a
 * twin needs PROOF it is another process — a start stamp that disagrees — so a running pid with none counts as one.
 *
 * @param only the one in-tree record already bound as the seat
 * @returns the twins' pids joined for a refusal, or `undefined` when there is none
 */
function liveTwinPids({
  only,
  records,
  starts,
}: {
  only: SessionRecord;
  records: readonly SessionRecord[];
  starts: ReadonlyMap<number, string>;
}): string | undefined {
  const twins = records.filter(
    (record) => record.sessionId === only.sessionId && record.pid !== only.pid && !provenNotRunning({ record, starts }),
  );
  if (twins.length === 0) {
    return undefined;
  }
  return twins.map((record) => String(record.pid)).join(", ");
}

/**
 * The first refused registry file that may be this seat's session: one naming no pid, or a pid in its tree or
 * running anywhere — a running one may be this session twice. Only a dead pid's file is inert.
 *
 * @returns that file's `<name>: why` entry, or `undefined` when every refused file is a dead pid's
 */
function refusedMayBeSeat({
  pids,
  refused,
  starts,
}: {
  pids: ReadonlySet<number>;
  refused: readonly string[];
  starts: ReadonlyMap<number, string>;
}): string | undefined {
  return refused.find((entry) => {
    const pid = REFUSED_PID.exec(entry)?.[1];
    return pid === undefined || pids.has(Number(pid)) || starts.has(Number(pid));
  });
}

/**
 * Whether a registry record is PROVEN not to describe a running process: its pid runs nothing, or runs a process
 * whose start stamp disagrees with the record's own.
 *
 * @returns false whenever the record could still be running
 */
function provenNotRunning({ record, starts }: { record: SessionRecord; starts: ReadonlyMap<number, string> }): boolean {
  const running = starts.get(record.pid);
  if (running === undefined) {
    return true;
  }
  return record.procStart !== undefined && record.procStart.trim() !== running;
}

/**
 * A `ps -o lstart=` stamp taken under `TZ=UTC LC_ALL=C`, as an ISO instant (`#lib/lstart.ts` reads it).
 *
 * @param text the stamp, e.g. `Fri Oct  9 11:36:11 2026`
 * @returns the instant to the second, or `undefined` when the text is not such a stamp or names no real instant
 */
export function lstartToIso({ text }: { text: string }): string | undefined {
  const ms = lstartMs({ text });
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

/** Why `close-done` leaves a seat with no done evidence open. */
export type ParkKeepReason =
  /** Its registry status is `busy` or `shell` — a turn or a background shell runs. */
  | "seat-working"
  /** Its screen shows a turn, a queued line or background work running. */
  | "screen-working"
  /** Its screen proves nothing at rest — no Claude Code footer last. */
  | "screen-unreadable"
  /** Its session cannot be named — see the identity's `why`. */
  | "seat-unidentified"
  /** No session holds the run, and none parked it. */
  | "run-unowned"
  /** Its session is not the one holding the run. */
  | "seat-not-holder"
  /** Its session let the run go, released or parked, and this seat's process started after that — a reseat. */
  | "seat-not-predecessor"
  /** Its run journal could not be read, or moved under the sweep. */
  | "journal-unreadable"
  /** Its last look before acting disagreed with its first — another process, session or action. */
  | "seat-moved"
  /** The Slack draft register could not be read as complete. */
  | "drafts-unreadable"
  /** The run is parked already, but its checkpoint lacks a draft the seat still holds — closing would drop it. */
  | "drafts-unrecorded"
  /**
   * Its row carries the owner's standing-session ruling, in force on the park half's own fresh journal read — recorded
   * after the sweep planned (`../handover/standingSession.ts`).
   */
  | "standing-session"
  /** Its run's own branch has an OPEN pull request — landing it is the seat's work, never a park. */
  | "own-pull-request"
  /** Whether its run's own branch has an open pull request could not be read, so it may. */
  | "own-pull-request-unreadable";

/** The keep reasons that are simply the working fleet, printed as no line. */
export const QUIET_PARK_KEEPS: ReadonlySet<ParkKeepReason> = new Set<ParkKeepReason>([
  "seat-working",
  "screen-working",
  "own-pull-request",
]);

/**
 * Why an at-rest seat stays open on its run's own pull request, or `undefined` when nothing on GitHub holds it.
 *
 * The worker contract makes a seat's own pull request — its CI, a rebase, a red fix, and the landing — the seat's
 * work: only a clock or ANOTHER branch's pull request is idle time that closes it. An idle screen cannot tell those
 * apart, so a seat holding for the lap seat's GO read as parked. MEASURED: `session close-done` parked
 * one seat twice in an hour while it was NEXT on the lap lock, so the GO reached nobody. Any open pull request counts, a draft included — undrafting it is the seat's too (rule 1).
 * Anything short of a whole read keeps the seat: a pull request left unseen is the destructive direction.
 *
 * @param answer every pull request on the run's branches, or why they could not be read
 * @returns the keep, or `undefined` when the read was whole and found none open
 */
export function ownPullRequestKeep({
  answer,
}: {
  answer: RowPullRequests;
}): { readonly reason: ParkKeepReason; readonly why: string } | undefined {
  if (answer.kind === "not-asked") {
    return { reason: "own-pull-request-unreadable", why: "its own pull requests were not asked for" };
  }
  if (answer.kind === "unread") {
    return { reason: "own-pull-request-unreadable", why: `its own pull requests did not read — ${answer.why}` };
  }
  const open = answer.pulls.filter((pull) => pull.state === "OPEN");
  if (open.length === 0) {
    return undefined;
  }
  const named = open.map((pull) => pull.url).join(", ");
  return {
    reason: "own-pull-request",
    why: `its run's own pull request is open, and landing it is its work: ${named}`,
  };
}

/** What `close-done` does with an identified, at-rest seat. */
export type ParkAction =
  /** It holds the run: journal its checkpoint, then close it. */
  | { readonly kind: "record"; readonly holder: RunWriter }
  /** The run is parked already and this seat let it go before the park, left open: close it, journal nothing. */
  | { readonly kind: "close-only"; readonly checkpoint: ParkedEvent }
  | { readonly kind: "keep"; readonly reason: ParkKeepReason };

/** One second, the precision `lstart` carries. */
const LSTART_PRECISION_MS = 1000;

/** The kinds that seat a session on a run or let it go — the ones `../handover/runOwner.ts` folds ownership from. */
const OWNERSHIP_KINDS: ReadonlySet<RunEvent["kind"]> = new Set<RunEvent["kind"]>([
  "launched",
  "resumed",
  "claimed",
  "released",
  "parked",
]);

/**
 * The instant this session FIRST let the run go after its last seating — the earliest `released` or `parked`
 * naming it since its last `launched`, `resumed` or `claimed` — or `undefined` when its last ownership line seats
 * it, or none names it. The earliest, because a later let-go line of its own moves no ownership the first did not
 * already move, and taking it would admit a process booted between the two. A line of any
 * other kind carrying its id (`gated`, say) moves no ownership, so it never hides a release.
 *
 * Host AND id, off the run owner fold's own step (`nextWriter`, `../handover/runWriterStep.ts`), walked over every
 * line and reset at each `started` as `currentCycle` resets it (Codex 4d r3). A seating line belongs to the writer
 * it seats — a hostless `resumed` keeps a host only when the run's writer was that same session. A `released` or
 * `parked` line belongs to the writer it CLEARS, and a stale one that clears no writer (it names a session that no
 * longer held the run) is nobody's let-go, so it never closes a seat. Only the seat's own host's lines count, so a
 * Claude writer's park never reads as the let-go of a Codex thread sharing its id.
 *
 * @param host the seat's host, whose lines alone are its own
 * @returns the let-go instant
 */
function letGoIsoOf({
  events,
  host,
  sessionId,
}: {
  events: readonly RunEvent[];
  host: VisibleSessionHost;
  sessionId: string;
}): string | undefined {
  let writer: RunWriter | undefined;
  const own: RunEvent[] = [];
  for (const event of events) {
    if (event.kind === "started") {
      // A new cycle: an earlier cycle's lines say nothing about this one's holder.
      own.splice(0);
    }
    const before = event.kind === "started" ? undefined : writer;
    writer = nextWriter({ event, writer: before });
    if (!OWNERSHIP_KINDS.has(event.kind) || !("sessionId" in event) || event.sessionId !== sessionId) {
      continue;
    }
    const line = lineWriter({ after: writer, before, event, sessionId });
    if (line !== undefined && writerHost({ holder: line }) === host) {
      own.push(event);
    }
  }
  const letsGo = (event: RunEvent): boolean => event.kind === "released" || event.kind === "parked";
  const lastSeated = own.findLastIndex((event) => !letsGo(event));
  return own.slice(lastSeated + 1).find(letsGo)?.atIso;
}

/**
 * What to do with a seat whose session is named, against its run's journal.
 *
 * A run parked already is closed only when this seat is one that let it go before the park: its session's own last
 * journal line is that park, or a `released` the park came after (a writer that handed the run on and was left open
 * — measured, the chat-widget run's workspace:934), and a process whose whole start SECOND ends before
 * that let-go. `cmux reseat --resume` relaunches the same session id in a new process, so the id alone would close
 * a reseat that was just brought back. The same holds for a run its writer RELEASED with no park yet: that writer is
 * still its holder, so its seat records a checkpoint only when the process started before the release. A let-go
 * stamped after `nowIso` proves no order at all — a skewed clock or a hand-written line would otherwise make every
 * reboot look older than it — so it keeps the seat.
 *
 * @param events the run journal's events, in order
 * @param identity the seat's session, bound to its process
 * @param nowIso the instant of this look, which no let-go it trusts may be later than
 * @returns the action
 */
export function parkActionOf({
  events,
  identity,
  nowIso,
}: {
  events: readonly RunEvent[];
  identity: SeatIdentity & { readonly kind: "identified" };
  nowIso: string;
}): ParkAction {
  if (identity.status !== "idle") {
    return { kind: "keep", reason: "seat-working" };
  }
  const letGoIso = letGoIsoOf({ events, host: identity.host, sessionId: identity.sessionId });
  const holder = parkHolder({ events });
  if (holder !== undefined) {
    // Host AND id: a Claude session and a Codex thread sharing an id string are different writers, so a Codex seat
    // never records for a Claude claim that took the run after its launch (Codex 4d r3).
    if (holder.sessionId !== identity.sessionId || writerHost({ holder }) !== identity.host) {
      return { kind: "keep", reason: "seat-not-holder" };
    }
    // A RELEASED run's holder is the writer that let it go: only the seat it left open is that writer, never a
    // reboot of the same session after the release.
    if (letGoIso !== undefined && !startedBefore({ identity, iso: letGoIso, nowIso })) {
      return { kind: "keep", reason: "seat-not-predecessor" };
    }
    return { holder, kind: "record" };
  }
  const checkpoint = activeParkedCheckpoint({ events });
  if (checkpoint === undefined) {
    return { kind: "keep", reason: "run-unowned" };
  }
  if (letGoIso === undefined || Date.parse(letGoIso) > Date.parse(checkpoint.atIso)) {
    return { kind: "keep", reason: "seat-not-holder" };
  }
  return startedBefore({ identity, iso: letGoIso, nowIso })
    ? { checkpoint, kind: "close-only" }
    : { kind: "keep", reason: "seat-not-predecessor" };
}

/**
 * The host a writer ran on. A hostless line predates cross-host ownership, so it names Claude Code — the same reading
 * `./codexParkSeat.ts` takes when it refuses a hostless `launched` as a Codex thread.
 *
 * @returns the writer's host
 */
function writerHost({ holder }: { holder: RunWriter }): SupervisorHost {
  if (holder.host === undefined) {
    return HOSTLESS_WRITER_HOST;
  }
  return holder.host;
}

/** The host a hostless journal line names: every line before cross-host ownership was written by Claude Code. */
const HOSTLESS_WRITER_HOST: SupervisorHost = "claude-code";

/**
 * The writer one ownership line naming `sessionId` belongs to: the writer a seating line seats, or the writer a
 * let-go line clears. A let-go that clears nobody — its session no longer held the run — belongs to no writer.
 *
 * @param before the fold's writer just before the line
 * @param after the fold's writer just after it
 * @returns the line's writer, or `undefined` for a stale let-go
 */
function lineWriter({
  after,
  before,
  event,
  sessionId,
}: {
  after: RunWriter | undefined;
  before: RunWriter | undefined;
  event: RunEvent;
  sessionId: string;
}): RunWriter | undefined {
  if (event.kind !== "released" && event.kind !== "parked") {
    return after;
  }
  if (before?.sessionId === sessionId && after === undefined) {
    return before;
  }
  return undefined;
}
/**
 * Whether the seat's process started before an instant, by its whole `lstart` second, and that instant is not
 * later than now.
 *
 * @returns true only when the start second ends at or before the instant and the instant is not in the future
 */
function startedBefore({
  identity,
  iso,
  nowIso,
}: {
  identity: SeatIdentity & { kind: "identified" };
  iso: string;
  nowIso: string;
}): boolean {
  const at = Date.parse(iso);
  return at <= Date.parse(nowIso) && Date.parse(identity.startedIso) + LSTART_PRECISION_MS <= at;
}
