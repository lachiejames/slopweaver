/**
 * How the park half of `session close-done` LOOKS at a seat — its screen, its one Claude Code session and its run's
 * journal, read together — and the second look that must agree with the first before anything is acted on. The
 * acting half is `./closeDonePark.ts`; this one reads and judges, and writes nothing.
 */
import type { RowPullRequests } from "../../../hand/rowPullRequest.js";
import type { ParsedLedger, RunEvent } from "../../../handover/ledger.js";
import { PARK_SCREEN_LINES, type ParkedEvent } from "../../../handover/parkedEvent.js";
import { type ParkSeatRefusal, parkSeatRefusal, refusalShows } from "../../../handover/parkPolicy.js";
import type { RunWriter } from "../../../handover/runOwner.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { standingSessionInForce, standingSessionLine } from "../../../handover/standingSession.js";
import { ownershipAmbiguousLines } from "../../../handover/unknownKind.js";
import { flattenProcessTreePids } from "../../../live/standing/processes.js";
import type { CodexThreadObserver } from "../../../measurement/codexSessions.js";
import type { CloseDonePlanItem } from "../../../sessions/closeDone.js";
import type { CloseDoneOutcome } from "../../../sessions/closeDoneOutcome.js";
import { readCodexParkSeat } from "../../../sessions/codexParkSeat.js";
import type { SessionScan } from "../../../sessions/liveSessionStore.js";
import {
  identifyParkSeat,
  NO_CLAUDE_SESSION_IN_TREE,
  type ParkAction,
  parkActionOf,
  type SeatIdentity,
} from "../../../sessions/parkSeat.js";
import type { VisibleSessionHost } from "../../../supervisor/session.js";
import type { CloseDoneDeps } from "./closeDone.js";

/** A run seat with no done evidence, live in cmux. */
export type ParkCandidate = CloseDonePlanItem & { readonly kind: "park-candidate" };

/**
 * What the park half needs beyond the sweep's own deps: the registry, the process listing, Codex's open files and
 * the run's own pull requests.
 */
export interface ParkSeatDeps {
  /** Claude Code's session registry, scanned. */
  readonly registry: () => SessionScan;
  /** Each running pid's start stamp under `TZ=UTC LC_ALL=C`, or why `ps` gave none. */
  readonly starts: () => { readonly starts: ReadonlyMap<number, string> } | { readonly why: string };
  /**
   * A fresh read of Codex's open files, taken once per look — asked only for a seat with no Claude Code session in
   * its tree. Never one observer for the whole sweep: a cached scan would let the last look reuse the first look's
   * holder, so a thread moved outside the tree since would still close the seat.
   */
  readonly codexThreads: () => CodexThreadObserver;
  /**
   * Every pull request on the run's own branches, read from GitHub — asked only for a seat every local read already
   * proved at rest, right before its checkpoint or close, so a sweep with nothing to park makes no GitHub call.
   */
  readonly ownPullRequests: (args: { readonly slug: string }) => Promise<RowPullRequests>;
}

/** The sweep deps the park half reads — the shared ones and its own. */
export type ParkDeps = CloseDoneDeps & { readonly runsDir: string };

/** Every read a park decides on, taken together: the screen, the seat's session, its run's journal, the action. */
export interface Observation {
  readonly kind: "observed";
  readonly screen: string;
  readonly identity: SeatIdentity & { readonly kind: "identified" };
  readonly journal: ParsedLedger;
  readonly action: ParkAction;
}

/** A kept seat's outcome, when a read could not be had or did not prove it at rest. */
export interface Kept {
  readonly kind: "kept";
  readonly outcome: CloseDoneOutcome;
}

/**
 * Read the seat whole: its screen, then its journal, then its session bound against that SAME journal read. One
 * snapshot serves both the Codex binding and the action, so a thread named between two reads can never be absent
 * from the one and present in the other.
 *
 * @returns every read and the action they decide, or the kept outcome of the first read that did not prove it
 */
export async function observe({ deps, item }: { deps: ParkDeps; item: ParkCandidate }): Promise<Observation | Kept> {
  const atRest = await screenAtRest({ deps, item });
  if (atRest.kind === "kept") {
    return atRest;
  }
  const journal = readRunJournal({ runsDir: deps.runsDir, slug: item.row.slug });
  if (journal.isErr()) {
    return {
      kind: "kept",
      outcome: { item, kind: "park-kept", reason: "journal-unreadable", why: journal.error.message },
    };
  }
  const identity = await identify({ atRest, deps, events: journal.value.events, item });
  if (identity.kind === "unidentified") {
    return { kind: "kept", outcome: { item, kind: "park-kept", reason: "seat-unidentified", why: identity.why } };
  }
  const ambiguous = ownershipAmbiguousLines({ journal: journal.value });
  if (ambiguous.length > 0) {
    const why = `journal line(s) ${ambiguous.join(", ")} do not decode, so its holder cannot be proven`;
    return { kind: "kept", outcome: { item, kind: "park-kept", reason: "journal-unreadable", why } };
  }
  // The planner kept every standing seat it saw; this is the ruling recorded since, read off this look's own journal
  // read, so `reobserve` asks it again right before any checkpoint or close.
  const standing = standingSessionInForce({ events: journal.value.events, nowIso: deps.nowIso });
  if (standing !== undefined) {
    const why = standingSessionLine({ ruling: standing });
    return { kind: "kept", outcome: { item, kind: "park-kept", reason: "standing-session", why } };
  }
  const action = parkActionOf({ events: journal.value.events, identity, nowIso: deps.nowIso });
  return { action, identity, journal: journal.value, kind: "observed", screen: atRest.screen };
}

/**
 * The LAST look before acting: every read taken again and the action recomputed, which must name the same
 * action for the same process incarnation. A turn started, a claim journalled or a `cmux reseat` of the same
 * session since the first look stops the act here.
 *
 * @param first the first look, which this one must agree with
 * @returns the last look, or the kept outcome naming what moved
 */
export async function reobserve({
  deps,
  first,
  item,
}: {
  deps: ParkDeps;
  first: Observation;
  item: ParkCandidate;
}): Promise<Observation | Kept> {
  const last = await observe({ deps, item });
  if (last.kind === "kept") {
    return last;
  }
  const was = first.identity;
  const now = last.identity;
  const sameSeat = sameIdentity({ now, was });
  if (!sameSeat || last.action.kind !== first.action.kind) {
    const why = `first ${was.host} ${was.sessionId} pid ${String(was.pid)} → ${first.action.kind}, last ${now.host} ${now.sessionId} pid ${String(now.pid)} → ${last.action.kind}`;
    return { kind: "kept", outcome: { item, kind: "park-kept", reason: "seat-moved", why } };
  }
  const before = lookStamp({ look: first });
  const after = lookStamp({ look: last });
  if (before !== after) {
    const why = `the run moved between looks: ${before} → ${after}`;
    return { kind: "kept", outcome: { item, kind: "park-kept", reason: "seat-moved", why } };
  }
  return last;
}

/**
 * A park's place in its run journal, counted from 1 — the journal only grows, so this names ONE checkpoint where its
 * instant alone does not: a later park stamped the same instant, in a new cycle or the same one, sits elsewhere.
 *
 * @param checkpoint a park `parkActionOf` derived off `events` itself, so it is one of them
 * @returns its ordinal among the decoded events
 */
export function checkpointOrdinal({
  checkpoint,
  events,
}: {
  checkpoint: ParkedEvent;
  events: readonly RunEvent[];
}): number {
  return events.indexOf(checkpoint) + 1;
}

/**
 * A run journal's whole size: every decoded event and every line that did not decode, a forgiven unknown kind
 * included — a newer checkout's line naming nothing this build reads is still a change.
 *
 * @returns how many lines the journal holds
 */
export function journalSize({ journal }: { journal: Pick<ParsedLedger, "events" | "unreadable"> }): number {
  return journal.events.length + journal.unreadable.length;
}

/**
 * One look's action as a comparable line: a holder that re-claimed, a park replaced by another one, or any line at all
 * landing between the two looks changes it.
 *
 * @returns the stamp
 */
function lookStamp({ look }: { look: Observation }): string {
  const events = `${String(journalSize({ journal: look.journal }))} journal lines`;
  const action = look.action;
  if (action.kind === "record") {
    return `${events}, holder ${holderStamp({ holder: action.holder })}`;
  }
  if (action.kind === "close-only") {
    const ordinal = checkpointOrdinal({ checkpoint: action.checkpoint, events: look.journal.events });
    return `${events}, parked ${action.checkpoint.atIso} as journal event ${String(ordinal)}`;
  }
  return `${events}, keep ${action.reason}`;
}

/**
 * Whether two looks named the same process incarnation of the same session on the same host — a Codex thread and a
 * Claude session sharing an id string are different seats.
 *
 * @returns true only when host, session or thread id, pid and process start all agree
 */
export function sameIdentity({
  now,
  was,
}: {
  now: SeatIdentity & { readonly kind: "identified" };
  was: SeatIdentity & { readonly kind: "identified" };
}): boolean {
  return (
    now.host === was.host && now.sessionId === was.sessionId && now.pid === was.pid && now.startedIso === was.startedIso
  );
}

/**
 * Every field a holder's claim carries, as one comparable line — a re-claim or resume under the SAME session
 * between the two looks changes its pid or its instant even when its session, host and tree do not.
 *
 * @returns the stamp
 */
function holderStamp({ holder }: { holder: RunWriter }): string {
  return [holder.sessionId, String(holder.pid), holder.atIso, String(holder.worktree), String(holder.host)].join(" ");
}

/** A screen proven at rest under one host's own patterns, and which host's composer proved it. */
export interface AtRest {
  readonly kind: "at-rest";
  readonly screen: string;
  readonly host: VisibleSessionHost;
}

/**
 * The screen read and judged, under Claude Code's patterns first and Codex's only when Claude's prove nothing.
 *
 * @returns the screen and the host whose composer it shows at rest, else the kept outcome saying why not
 */
export async function screenAtRest({ deps, item }: { deps: ParkDeps; item: ParkCandidate }): Promise<AtRest | Kept> {
  const screen = await deps.client.readScreen({
    scrollbackLines: PARK_SCREEN_LINES,
    target: { workspaceId: item.workspace.workspaceId },
  });
  if (screen.isErr()) {
    return {
      kind: "kept",
      outcome: { item, kind: "park-kept", reason: "screen-unreadable", why: screen.error.message },
    };
  }
  // The host is proven by the identity read that follows, never assumed from the screen: a Claude composer with no
  // Claude Code session in the tree, or a Codex one with no held Codex thread, is kept there.
  const refusalUnder = ({ host }: { host: VisibleSessionHost }): ParkSeatRefusal | undefined =>
    parkSeatRefusal({
      callerWorkspaceId: deps.ownWorkspaceId,
      holderHost: host,
      screen: screen.value,
      target: item.workspace,
    });
  const claude = refusalUnder({ host: "claude-code" });
  if (claude === undefined) {
    return { host: "claude-code", kind: "at-rest", screen: screen.value };
  }
  if (claude.kind !== "unreadable") {
    return { kind: "kept", outcome: { item, kind: "park-kept", reason: "screen-working" } };
  }
  const codex = refusalUnder({ host: "codex" });
  if (codex === undefined) {
    return { host: "codex", kind: "at-rest", screen: screen.value };
  }
  if (codex.kind !== "unreadable") {
    return { kind: "kept", outcome: { item, kind: "park-kept", reason: "screen-working" } };
  }
  return {
    kind: "kept",
    outcome: { item, kind: "park-kept", reason: "screen-unreadable", why: refusalShows({ refusal: claude }) },
  };
}

/**
 * The one session running in the seat's process tree, bound to its process: a Claude Code session through the
 * registry, and — only when that registry read clean and names none in the tree — a Codex thread through its
 * screen and its open files. A refused registry file or two Claude sessions is never bypassed by a Codex match.
 *
 * @param atRest the screen this look proved at rest, and the host whose composer proved it
 * @param events the run journal this look decides its action on, which alone names the Codex threads asked about
 * @returns the session, or why it cannot be named
 */
export async function identify({
  atRest,
  deps,
  events,
  item,
}: {
  atRest: AtRest;
  deps: ParkDeps;
  events: readonly RunEvent[];
  item: ParkCandidate;
}): Promise<SeatIdentity> {
  const tree = await deps.client.processTree({ workspaceId: item.workspace.workspaceId });
  if (tree.isErr()) {
    return { kind: "unidentified", why: `its process tree could not be read — ${tree.error.message}` };
  }
  const scan = deps.parkSeat.registry();
  if (scan.unreadable !== undefined) {
    return { kind: "unidentified", why: `the Claude Code session registry could not be read — ${scan.unreadable}` };
  }
  const listed = deps.parkSeat.starts();
  if ("why" in listed) {
    return { kind: "unidentified", why: `the process listing could not be taken — ${listed.why}` };
  }
  const treePids = flattenProcessTreePids({ roots: tree.value });
  const claude = identifyParkSeat({ records: scan.records, refused: scan.refused, starts: listed.starts, treePids });
  if (claude.kind === "identified") {
    return atRest.host === "claude-code"
      ? claude
      : { kind: "unidentified", why: "its screen shows a Codex composer, not Claude Code's, beside a Claude session" };
  }
  if (claude.why !== NO_CLAUDE_SESSION_IN_TREE) {
    return claude;
  }
  return identifyCodex({ deps, events, screen: atRest.screen, starts: listed.starts, treePids });
}

/**
 * The Codex thread a seat with no Claude Code session in its tree runs, off the look's own journal read and Codex's
 * open files (`../../../sessions/codexParkSeat.ts`).
 *
 * @returns the thread bound to its process, or why it is UNMEASURED
 */
function identifyCodex({
  deps,
  events,
  screen,
  starts,
  treePids,
}: {
  deps: ParkDeps;
  events: readonly RunEvent[];
  screen: string;
  starts: ReadonlyMap<number, string>;
  treePids: readonly number[];
}): SeatIdentity {
  const codex = readCodexParkSeat({
    events,
    observeThread: deps.parkSeat.codexThreads(),
    screen,
    starts,
    treePids,
  });
  switch (codex.kind) {
    case "identified":
      return codex.identity;
    case "working":
      return { kind: "unidentified", why: `its screen shows a Codex turn ${codex.state}` };
    case "unmeasured":
      return {
        kind: "unidentified",
        why: `${NO_CLAUDE_SESSION_IN_TREE}, and its Codex thread is UNMEASURED — ${codex.why}`,
      };
    default: {
      const unreachable: never = codex;
      return unreachable;
    }
  }
}
