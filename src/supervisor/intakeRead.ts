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
 * Each link is read between the instant it took the pin and the instant its successor did, and a chair the owner
 * window dropped is still walked for peer traffic: `./chainSpanWalk.ts` is that walk. A caller naming ONE session
 * gets that transcript alone, whole unless it also names a floor.
 */
import { join } from "node:path";

import type { HandoverDoc } from "../handover/doc.js";
import { type ChainCoverage, type ChairTenure, chainReachesSince, chairTenures, type SupervisorLink } from "./chain.js";
import { lateWrittenChairs, sortedTurnsOf, type WalkedSpan, walkOwnerWindow } from "./chainSpanWalk.js";
import { readSupervisorChainEvents } from "./chainStore.js";
import { readChairTranscript } from "./chairTranscript.js";
import { type ChairTraffic, judgeInbound } from "./inbound.js";
import {
  INTAKE_GRACE_MS,
  type IntakeMark,
  type IntakeReport,
  type OwnerTurn,
  type RowAnchors,
  witnessTurns,
} from "./intake.js";
import { pinAsLink, resolveIntakeScope } from "./intakeScope.js";
import { supervisorSessionKey } from "./session.js";
import { readTypedIntake } from "./typedIntakeRead.js";

/** The pointer-bearing fields of every board row. */
function rowAnchorsOf({ docs }: { docs: readonly HandoverDoc[] }): readonly RowAnchors[] {
  return docs.map((doc) => ({ anchor: doc.anchor, settlementWitness: doc.settlementWitness, slug: doc.slug }));
}

/** The owner turns a chain read reached, and what of the chain it could not. */
export interface ChainTurns {
  readonly turns: readonly OwnerTurn[];
  /**
   * `chair <id>: <why>` for each Claude chair in the window whose transcript would not read, and for each readable one
   * that still left a line or a turn out — what a reader discloses.
   */
  readonly unreadChairs: readonly string[];
  /**
   * `chair codex:<id>: <CODE>: <why>` for each Codex chair in the window whose rollout would not read whole — what the
   * takeover gate refuses on, because no reader has a second look at a rollout the way a transcript gap is shown.
   */
  readonly refusedChairs: readonly string[];
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
    refusedChairs: walked
      .filter((item) => item.session.host === "codex" && item.why !== "")
      .map((item) => `chair ${item.leg.sessionId}: ${item.why}`),
    turns: sortedTurnsOf({ readable: walked.filter((item) => item.why === "") }),
    unreadChairs: walked
      .filter((item) => item.session.host !== "codex")
      .flatMap((item) =>
        (item.why === "" ? item.gaps : [item.why]).map((why) => `chair ${item.leg.sessionId}: ${why}`),
      ),
  };
}

/** What a chain read could and could not see, off the owner window's walks and the late-written chairs' walks. */
function coverageOf({
  ordered,
  sinceIso,
  walked,
  lateWalks,
}: {
  ordered: readonly SupervisorLink[];
  sinceIso: string | undefined;
  walked: readonly WalkedSpan[];
  lateWalks: readonly WalkedSpan[];
}): ChainCoverage {
  return {
    earliestIso: ordered[0]?.pinnedAtIso,
    linksKnown: ordered.length,
    reachesSince: chainReachesSince({ links: ordered, sinceIso }),
    // A retired chair walked only for peer traffic discloses its failure here too: a chair whose transcript
    // will not read holds messages nobody can see, and a silent drop is the shape this check exists to refuse.
    // A Codex chair whose owner turns read still discloses its unread peer traffic, so no message reads as answered.
    unreadable: [...walked, ...lateWalks]
      .filter((item) => item.why !== "" || item.peerGap !== "")
      .map((item) => ({
        claudeSessionId: item.leg.sessionId,
        untilIso: item.untilIso,
        why: item.why === "" ? item.peerGap : item.why,
      })),
    walked: walked.filter((item) => item.why === "").map((item) => item.leg.sessionId),
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
  const window = walkOwnerWindow({ chain, claudeHome, home, sinceIso });
  const readable = window.walked.filter((item) => item.why === "");
  const lateWalks = lateWrittenChairs({ sinceIso, window });
  const lateWritten = lateWalks.filter((item) => item.why === "");
  const coverage = coverageOf({ lateWalks, ordered: window.ordered, sinceIso, walked: window.walked });
  const rows = rowAnchorsOf({ docs });
  return {
    finding: witnessTurns({
      coverage,
      legs: readable.map((item) => item.leg),
      marks,
      nowIso,
      rows,
      sinceIso,
      turns: sortedTurnsOf({ readable }),
    }),
    inbound: judgeInbound({
      chairs: [...lateWritten, ...readable].map((item) => item.chair),
      graceMs: INTAKE_GRACE_MS,
      marks,
      nowIso,
    }),
    kind: "read",
    // The owner's typed console turns: a second source the chair's transcripts never hold (`./typedIntake.ts`).
    typed: readTypedIntake({ home, marks, nowIso, rows, sinceIso }),
  };
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
    typed: { kind: "excluded", why: "--session reads one chair's transcript; the typed console turns are the chain's" },
  };
}
