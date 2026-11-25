/**
 * The effectful edge of the intake check: which transcripts the supervisor CHAIN is made of, and the owner
 * turns — and the messages other sessions sent — in all of them.
 *
 * ## Which sessions are "the supervisor"
 *
 * Every session that has held the pin, from the chain journal (`./chain.ts` carries the measurement that
 * forced it). The pin record (`../sessions/supervisorPin.ts`) names only the CURRENT holder and is replaced
 * on every takeover, so reading it alone made a week of predecessors invisible while the clause read clean.
 * It is still read here — the live session is a link the journal may not have caught, and a pin the
 * live-session registry cannot confirm is still reported rather than swallowed — but it is one link, not the
 * scope.
 *
 * ## The floor, per link
 *
 * A supervisor owns the owner's turns from the moment it took the pin until its successor did, so each
 * link's transcript is read between those two instants. That is why a resumed session's earlier life does
 * not leak in, and why a session left open after handing over does not claim turns its successor answered.
 * An explicit `--since` raises every link's floor; a caller naming ONE session gets that transcript alone,
 * whole unless it also names a floor.
 *
 * Peer messages are read from the same floor but with NO ceiling: a message landing on a chair after its
 * successor took the pin is exactly what `./inbound.ts` exists to carry, so cutting it off at the span's end
 * would drop the finding. Both are gathered in ONE pass over each transcript.
 *
 * ## Which transcripts the peer read adds
 *
 * `ownerWindow` drops a chair whose successor pinned before the floor (bar a Codex chair that retook it), which
 * is right for owner turns and wrong for peer messages: a retired chair keeps receiving reports addressed to its name, and those are the finding.
 * So a chair the owner window dropped is still walked for peer traffic when its transcript was last written at
 * or after the floor — a file untouched since before the floor cannot hold a message after it, and the check
 * is one `stat`, so the sweep does not open every transcript the chain has ever had.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import type { HandoverDoc } from "../handover/doc.js";
import { findTranscript } from "../transcripts/source.js";
import {
  type ChainCoverage,
  type ChainSpan,
  type ChairTenure,
  CODEX_CHAIR_UNREAD,
  chainReachesSince,
  chairTenures,
  ownerWindow,
  type SupervisorLink,
  unwalkedTenureGaps,
} from "./chain.js";
import { readSupervisorChainEvents } from "./chainStore.js";
import { chairReadGaps, readChairTranscript } from "./chairTranscript.js";
import { type ChairTraffic, judgeInbound } from "./inbound.js";
import {
  INTAKE_GRACE_MS,
  type IntakeLeg,
  type IntakeMark,
  type IntakeReport,
  type OwnerTurn,
  type RowAnchors,
  witnessTurns,
} from "./intake.js";
import { pinAsLink, resolveIntakeScope } from "./intakeScope.js";
import { supervisorSessionKey, supervisorSessionLabel, type VisibleSupervisorSession } from "./session.js";
import { linkKey } from "./supervisorLink.js";

/** The pointer-bearing fields of every board row. */
function rowAnchorsOf({ docs }: { docs: readonly HandoverDoc[] }): readonly RowAnchors[] {
  return docs.map((doc) => ({ anchor: doc.anchor, settlementWitness: doc.settlementWitness, slug: doc.slug }));
}

/** One link's turns and traffic, or the reason its transcript could not be walked. */
interface WalkedSpan {
  readonly leg: IntakeLeg;
  readonly turns: readonly OwnerTurn[];
  readonly chair: ChairTraffic;
  /** Why the walk failed, or "" when it succeeded. */
  readonly why: string;
  /** What a walk that succeeded still could not show: lines that would not parse, turns no anchor names alone. */
  readonly gaps: readonly string[];
  /**
   * The end of the chair's latest tenure, `undefined` while open. Read off the tenures, never the span: `orderChain`
   * collapses A → B → A to A's earliest link, whose span ends at B's pin while A's later tenure runs on.
   */
  readonly untilIso: string | undefined;
}

/**
 * Walk one span of the chain between the instant it took the pin and the instant its successor did.
 *
 * @param projectsDir `~/.claude/projects`
 * @param span the link and the instant its successor took over
 * @param sinceIso the caller's floor, which raises the link's own
 * @returns the leg with its turns and traffic, or the leg with the reason it could not be read
 */
function walkSpan({
  projectsDir,
  span,
  sinceIso,
  tenures,
}: {
  projectsDir: string;
  span: ChainSpan;
  sinceIso: string | undefined;
  tenures: ReadonlyMap<string, readonly ChairTenure[]>;
}): WalkedSpan {
  const floor =
    sinceIso !== undefined && Date.parse(sinceIso) > Date.parse(span.link.pinnedAtIso)
      ? sinceIso
      : span.link.pinnedAtIso;
  const { session } = span.link;
  const legId = supervisorSessionLabel({ session });
  const leg = { fromIso: floor, sessionId: legId, turns: 0 };
  const chair: ChairTraffic = {
    chairSessionId: legId,
    fromIso: floor,
    inbound: [],
    results: [],
    sends: [],
    tenures: tenures.get(linkKey({ link: span.link })) ?? [{ fromIso: span.link.pinnedAtIso, untilIso: span.untilIso }],
  };
  // The tenures always hold at least the span's own fallback tenure, so the last one is there.
  const untilIso = chair.tenures.at(-1)!.untilIso;
  if (session.host === "codex") {
    return { chair, gaps: [], leg, turns: [], untilIso, why: CODEX_CHAIR_UNREAD };
  }
  const read = readChairTranscript({ projectsDir, sessionId: session.id, sinceIso: floor, untilIso: span.untilIso });
  if (read.isErr()) {
    return { chair, gaps: [], leg, turns: [], untilIso, why: read.error.join("; ") };
  }
  return {
    chair: { ...chair, ...read.value.traffic },
    gaps: [...chairReadGaps({ read: read.value }), ...unwalkedTenureGaps({ sinceIso, span, tenures: chair.tenures })],
    leg: { ...leg, turns: read.value.turns.length },
    turns: read.value.turns,
    untilIso,
    why: "",
  };
}

/**
 * The chairs the owner window dropped that can still hold a peer message inside it: walked for their traffic
 * only, never counted as legs or coverage, because their owner turns all fall before the floor.
 *
 * @param allSpans every span the chain holds
 * @param spans the spans the owner window kept
 * @param projectsDir `~/.claude/projects`
 * @param sinceIso the floor
 * @param tenures every chair's pin intervals
 * @returns every walk, readable or not — the caller keeps the readable chairs and discloses the rest
 */
function lateWrittenChairs({
  allSpans,
  spans,
  projectsDir,
  sinceIso,
  tenures,
}: {
  allSpans: readonly ChainSpan[];
  spans: readonly ChainSpan[];
  projectsDir: string;
  sinceIso: string | undefined;
  tenures: ReadonlyMap<string, readonly ChairTenure[]>;
}): readonly WalkedSpan[] {
  return allSpans
    .filter((span) => !spans.includes(span) && writtenSince({ projectsDir, session: span.link.session, sinceIso }))
    .map((span) => walkSpan({ projectsDir, sinceIso, span, tenures }));
}

/**
 * The owner window of the chain, as `ownerWindow` builds it, with the spans it keeps walked.
 */
function walkOwnerWindow({
  home,
  claudeHome,
  chain,
  sinceIso,
}: {
  home: string;
  claudeHome: string;
  chain: readonly SupervisorLink[];
  sinceIso: string | undefined;
}): {
  readonly allSpans: readonly ChainSpan[];
  readonly ordered: readonly SupervisorLink[];
  readonly projectsDir: string;
  readonly spans: readonly ChainSpan[];
  readonly tenures: ReadonlyMap<string, readonly ChairTenure[]>;
  readonly walked: readonly WalkedSpan[];
} {
  const { allSpans, ordered, spans, tenures } = ownerWindow({ chain, pinned: pinAsLink({ home }), sinceIso });
  const projectsDir = join(claudeHome, "projects");
  const walked = spans.map((span) => walkSpan({ projectsDir, sinceIso, span, tenures }));
  return { allSpans, ordered, projectsDir, spans, tenures, walked };
}

/** Every readable chair's owner turns, ordered by `Date.parse` of each timestamp as the intake read always has. */
function sortedTurnsOf({ readable }: { readable: readonly WalkedSpan[] }): readonly OwnerTurn[] {
  return readable
    .flatMap((item) => item.turns)
    .toSorted((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

/** The owner turns a chain read reached, and what of the chain it could not. */
export interface ChainTurns {
  readonly turns: readonly OwnerTurn[];
  /**
   * `chair <id>: <why>` for each Claude chair in the window whose transcript would not read, and for each readable one
   * that still left a line or a turn out; `ownerWindowGaps` names a Codex chair.
   */
  readonly unreadChairs: readonly string[];
}

/**
 * Only the owner's turns across the chain — the owner window {@link readSupervisorChainIntake} walks, with none of
 * what it adds on top: no chair the window dropped checked for peer traffic, no board or ledger to witness a
 * turn against.
 *
 * A reader that lists the owner's words and judges nothing needs no more, and the check it skips was the expensive
 * half: each chair the window dropped costs at least one transcript lookup, a linear search of the directories
 * that stops at the first match. With 320 chain links the console voice's `supervisor_history`
 * took 12.5-17.6 s against its 20 s tool budget; without that check and the board scan, and with a lookup
 * that no longer throws per miss, it took 3.3-5.9 s (`time slopweaver talk history --phrase "jumpcloud atlas"
 * --json`, five runs each).
 *
 * @param home the state home, where the pin record lives
 * @param claudeHome the directory holding Claude Code's own projects and sessions registries
 * @param chain every session that has held the supervisor pin, in any order
 * @param sinceIso the floor, or `undefined` to read the whole chain
 * @returns the owner's turns from every chair that could be read, in `sortedTurnsOf`'s order, and the chairs that could not
 */
export function readSupervisorChainTurns({
  home,
  claudeHome,
  chain,
  sinceIso,
}: {
  home: string;
  claudeHome: string;
  chain: readonly SupervisorLink[];
  sinceIso: string | undefined;
}): ChainTurns {
  const { walked } = walkOwnerWindow({ chain, claudeHome, home, sinceIso });
  return {
    turns: sortedTurnsOf({ readable: walked.filter((item) => item.why === "") }),
    unreadChairs: walked
      .filter((item) => item.why !== CODEX_CHAIR_UNREAD)
      .flatMap((item) =>
        (item.why === "" ? item.gaps : [item.why]).map((why) => `chair ${item.leg.sessionId}: ${why}`),
      ),
  };
}

/**
 * Read the WHOLE supervisor chain's intake: walk every session that held the pin in the window, and set
 * every turn from all of them against the board and the ledger, and every message other sessions sent them
 * against the chain's replies.
 *
 * Never throws and never goes quiet. A link whose transcript is gone becomes a stated gap in
 * {@link ChainCoverage} rather than a missing turn, and an empty chain is reported as covering nothing —
 * the two failures this whole check exists to make loud.
 *
 * @param home the state home, where the pin record lives
 * @param claudeHome the directory holding Claude Code's own projects and sessions registries
 * @param chain every session that has held the supervisor pin, in any order
 * @param sinceIso the floor, or `undefined` to read the whole chain
 * @param nowIso the instant the grace window is judged at
 * @param docs the board's rows
 * @param marks the intake ledger
 * @returns the finding, or why it could not be made
 */
export function readSupervisorChainIntake({
  home,
  claudeHome,
  chain,
  sinceIso,
  nowIso,
  docs,
  marks,
}: {
  home: string;
  claudeHome: string;
  chain: readonly SupervisorLink[];
  sinceIso: string | undefined;
  nowIso: string;
  docs: readonly HandoverDoc[];
  marks: readonly IntakeMark[];
}): IntakeReport {
  const { allSpans, ordered, projectsDir, spans, tenures, walked } = walkOwnerWindow({
    chain,
    claudeHome,
    home,
    sinceIso,
  });
  const readable = walked.filter((item) => item.why === "");
  const lateWalks = lateWrittenChairs({ allSpans, projectsDir, sinceIso, spans, tenures });
  const lateWritten = lateWalks.filter((item) => item.why === "");
  const coverage: ChainCoverage = {
    earliestIso: ordered[0]?.pinnedAtIso,
    linksKnown: ordered.length,
    reachesSince: chainReachesSince({ links: ordered, sinceIso }),
    // A retired chair walked only for peer traffic discloses its failure here too: a chair whose transcript
    // will not read holds messages nobody can see, and a silent drop is the shape this check exists to refuse.
    unreadable: [...walked, ...lateWalks]
      .filter((item) => item.why !== "")
      .map((item) => ({ claudeSessionId: item.leg.sessionId, untilIso: item.untilIso, why: item.why })),
    walked: readable.map((item) => item.leg.sessionId),
  };
  const turns = sortedTurnsOf({ readable });
  return {
    finding: witnessTurns({
      coverage,
      legs: readable.map((item) => item.leg),
      marks,
      nowIso,
      rows: rowAnchorsOf({ docs }),
      sinceIso,
      turns,
    }),
    inbound: judgeInbound({
      chairs: [...lateWritten, ...readable].map((item) => item.chair),
      graceMs: INTAKE_GRACE_MS,
      marks,
      nowIso,
    }),
    kind: "read",
  };
}

/**
 * Whether a chair's transcript was last written at or after the floor — the one cheap question that decides
 * whether a chair the owner window dropped can still hold a peer message inside it.
 *
 * A transcript that cannot be found or stat'd is not walked: the owner-window read already reports an
 * unreadable link, and a retired chair with no file holds no message to carry. A retired Codex chair has no
 * Claude transcript to stat, so it is never walked here; one still inside the owner window is already disclosed
 * as unreadable by `walkSpan`.
 *
 * @param projectsDir `~/.claude/projects`
 * @param session the chair, by host and id
 * @param sinceIso the floor; with none, every chair is already in the owner window
 * @returns true when the file changed at or after the floor
 */
function writtenSince({
  projectsDir,
  session,
  sinceIso,
}: {
  projectsDir: string;
  session: VisibleSupervisorSession;
  sinceIso: string | undefined;
}): boolean {
  const floor = sinceIso === undefined ? Number.NaN : Date.parse(sinceIso);
  if (session.host === "codex" || Number.isNaN(floor)) {
    return false;
  }
  const path = findTranscript({ projectsDir, sessionId: session.id });
  if (path.isErr()) {
    return false;
  }
  try {
    return statSync(path.value).mtimeMs >= floor;
  } catch {
    return false;
  }
}

/**
 * One session's real pin tenures, read off the chain journal and the pin record — what the single-session read
 * places peer messages against.
 *
 * A session neither ever recorded holding the pin has NO tenures, so every message it received sits outside
 * every recorded tenure and is CARRIED. A chair nobody
 * can place is "could not establish" and an integrity check fails CLOSED rather than soft, so a `--session` read of
 * a pre-journal or unplaceable chair reports its messages and exits non-zero by construction.
 *
 * @param home the state home, where the journal and pin record live
 * @param sessionId the session read alone
 * @returns its tenures, oldest first; EMPTY when nothing ever recorded it holding the pin
 */
function sessionTenures({ home, sessionId }: { home: string; sessionId: string }): readonly ChairTenure[] {
  const links = [...readSupervisorChainEvents({ home }), ...pinAsLink({ home })];
  return chairTenures({ links }).get(supervisorSessionKey({ session: { host: "claude-code", id: sessionId } })) ?? [];
}

/**
 * Read ONE supervisor session's intake — the pinned one, or a session the caller named.
 *
 * Kept alongside the chain read rather than folded into it: `--session <id>` is how a turn pointer is
 * checked against its own transcript, and that question is about one file whether or not it is a link.
 * Its peer messages are still placed against that session's real pin tenures from the chain journal, so a late
 * report on a retired chair reads as carried here exactly as it does in the chain read.
 *
 * @param home the state home
 * @param claudeHome the directory holding Claude Code's own projects and sessions registries
 * @param sessionId an explicit session, or `undefined` to follow the pin
 * @param sinceIso an explicit floor, or `undefined` for the scope's default
 * @param nowIso the instant the grace window is judged at
 * @param docs the board's rows
 * @param marks the intake ledger
 * @returns the finding, or why it could not be made
 */
export function readSupervisorIntake({
  home,
  claudeHome,
  sessionId,
  sinceIso,
  nowIso,
  docs,
  marks,
}: {
  home: string;
  claudeHome: string;
  sessionId: string | undefined;
  sinceIso: string | undefined;
  nowIso: string;
  docs: readonly HandoverDoc[];
  marks: readonly IntakeMark[];
}): IntakeReport {
  const scope = resolveIntakeScope({ claudeHome, home, sessionId, sinceIso });
  if (scope.isErr()) {
    return { kind: "unavailable", why: scope.error.message };
  }
  const read = readChairTranscript({
    projectsDir: join(claudeHome, "projects"),
    sessionId: scope.value.sessionId,
    sinceIso: scope.value.sinceIso,
    untilIso: undefined,
  });
  if (read.isErr()) {
    return { kind: "unavailable", why: read.error.join("; ") };
  }
  const leg = { fromIso: scope.value.sinceIso, sessionId: scope.value.sessionId, turns: read.value.turns.length };
  const chair: ChairTraffic = {
    chairSessionId: scope.value.sessionId,
    fromIso: scope.value.sinceIso,
    tenures: sessionTenures({ home, sessionId: scope.value.sessionId }),
    ...read.value.traffic,
  };
  return {
    finding: witnessTurns({
      coverage: {
        earliestIso: leg.fromIso,
        linksKnown: 1,
        reachesSince: true,
        unreadable: [],
        walked: [leg.sessionId],
      },
      legs: [leg],
      marks,
      nowIso,
      rows: rowAnchorsOf({ docs }),
      sinceIso: scope.value.sinceIso,
      turns: read.value.turns,
    }),
    inbound: judgeInbound({ chairs: [chair], graceMs: INTAKE_GRACE_MS, marks, nowIso }),
    kind: "read",
  };
}
