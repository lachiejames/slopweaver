/**
 * Walking the supervisor chain's spans: each chair's owner turns, and the messages other sessions sent it, read off
 * its own record — a Claude chair's transcript, a Codex chair's rollout. `./intakeRead.ts` holds the readers that
 * judge what this walk returns.
 *
 * ## The floor, per link
 *
 * A supervisor owns the owner's turns from the moment it took the pin until its successor did, so each
 * link's transcript is read between those two instants. That is why a resumed session's earlier life does
 * not leak in, and why a session left open after handing over does not claim turns its successor answered.
 * An explicit `--since` raises every link's floor.
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

import { compareIsoInstants } from "#lib/date.js";
import { findTranscript } from "../transcripts/source.js";
import {
  type ChainSpan,
  type ChairTenure,
  CODEX_CHAIR_PEER_TRAFFIC_UNREAD,
  ownerWindow,
  type SupervisorLink,
  unwalkedTenureGaps,
} from "./chain.js";
import { chairReadGaps, readChairTranscript } from "./chairTranscript.js";
import { instantBefore, instantNotBefore, readRecordedCodexChair } from "./codexChairRead.js";
import type { ChairTraffic } from "./inbound.js";
import type { IntakeLeg, OwnerTurn } from "./intake.js";
import { pinAsLink } from "./intakeScope.js";
import { supervisorSessionLabel, type VisibleSupervisorSession } from "./session.js";
import { linkKey } from "./supervisorLink.js";

/** One link's turns and traffic, or the reason its transcript could not be walked. */
export interface WalkedSpan {
  /** The chair walked, by host and id. */
  readonly session: VisibleSupervisorSession;
  readonly leg: IntakeLeg;
  readonly turns: readonly OwnerTurn[];
  readonly chair: ChairTraffic;
  /** Why the walk failed, or "" when it succeeded. */
  readonly why: string;
  /** What a walk that succeeded still could not show: lines that would not parse, turns no anchor names alone. */
  readonly gaps: readonly string[];
  /**
   * Why a chair whose owner turns read still holds unread peer messages — a Codex chair's
   * {@link CODEX_CHAIR_PEER_TRAFFIC_UNREAD} — or "" when its traffic was read with its turns.
   */
  readonly peerGap: string;
  /**
   * The end of the chair's latest tenure, `undefined` while open. Read off the tenures, never the span: `orderChain`
   * collapses A → B → A to A's earliest link, whose span ends at B's pin while A's later tenure runs on.
   */
  readonly untilIso: string | undefined;
}

/**
 * The owner window of the chain, its spans walked, and what a caller needs to walk the chairs it dropped.
 *
 * @internal — the shape {@link walkOwnerWindow} returns and {@link lateWrittenChairs} takes back.
 */
export interface WalkedOwnerWindow {
  readonly allSpans: readonly ChainSpan[];
  readonly links: readonly SupervisorLink[];
  readonly ordered: readonly SupervisorLink[];
  readonly projectsDir: string;
  readonly spans: readonly ChainSpan[];
  readonly tenures: ReadonlyMap<string, readonly ChairTenure[]>;
  readonly walked: readonly WalkedSpan[];
}

/**
 * Whether an owner turn's instant falls inside one of the chair's tenures, at or after the floor, compared to every
 * fractional digit either side writes: a rollout turn inside the same millisecond as a successor's pin is the
 * predecessor's. A bound that will not parse bounds nothing, so a pin with a damaged instant keeps its turns rather
 * than silently dropping them all.
 */
function inAnyTenure({
  timestamp,
  floor,
  tenures,
}: {
  timestamp: string;
  floor: string;
  tenures: readonly ChairTenure[];
}): boolean {
  return (
    instantNotBefore({ bound: floor, timestamp }) &&
    tenures.some(
      (tenure) =>
        instantNotBefore({ bound: tenure.fromIso, timestamp }) && instantBefore({ bound: tenure.untilIso, timestamp }),
    )
  );
}

/**
 * Walk a Codex chair: its owner turns off its rollout, kept when they fall inside ANY of its tenures from the floor.
 * Unlike a Claude transcript, which is walked for its first stretch only, the rollout is one file read whole, so a
 * thread that retook the chair has every stretch read and no later one left as a gap. Its peer traffic stays unread
 * and says so.
 */
function walkCodexSpan({
  base,
  links,
  floor,
}: {
  base: Omit<WalkedSpan, "gaps" | "peerGap" | "turns" | "why">;
  links: readonly SupervisorLink[];
  floor: string;
}): WalkedSpan {
  const read = readRecordedCodexChair({ links, session: base.session, sinceIso: floor, untilIso: undefined });
  if (read.isErr()) {
    return { ...base, gaps: [], peerGap: "", turns: [], why: `${read.error.code}: ${read.error.message}` };
  }
  const turns = read.value.filter((turn) =>
    inAnyTenure({ floor, tenures: base.chair.tenures, timestamp: turn.timestamp }),
  );
  return {
    ...base,
    gaps: [],
    leg: { ...base.leg, turns: turns.length },
    peerGap: CODEX_CHAIR_PEER_TRAFFIC_UNREAD,
    turns,
    why: "",
  };
}

/**
 * Walk one span of the chain between the instant it took the pin and the instant its successor did.
 *
 * @param projectsDir `~/.claude/projects`
 * @param span the link and the instant its successor took over
 * @param sinceIso the caller's floor, which raises the link's own
 * @param links every chain link and the pin as one, where a Codex chair's recorded home is read
 * @returns the leg with its turns and traffic, or the leg with the reason it could not be read
 */
function walkSpan({
  projectsDir,
  span,
  sinceIso,
  tenures,
  links,
}: {
  projectsDir: string;
  span: ChainSpan;
  sinceIso: string | undefined;
  tenures: ReadonlyMap<string, readonly ChairTenure[]>;
  links: readonly SupervisorLink[];
}): WalkedSpan {
  // To every fractional digit, so a `--since` inside the pin's own millisecond but after it still raises the floor.
  const floor =
    sinceIso !== undefined && compareIsoInstants({ left: sinceIso, right: span.link.pinnedAtIso }) === 1
      ? sinceIso
      : span.link.pinnedAtIso;
  const { session } = span.link;
  const legId = supervisorSessionLabel({ session });
  const leg = { fromIso: floor, sessionId: legId, turns: 0 };
  // A link the tenure map does not hold (an instant that will not parse) is read for its own span alone.
  let chairTenureList: readonly ChairTenure[] = [{ fromIso: span.link.pinnedAtIso, untilIso: span.untilIso }];
  const recorded = tenures.get(linkKey({ link: span.link }));
  if (recorded !== undefined) {
    chairTenureList = recorded;
  }
  const chair: ChairTraffic = {
    chairSessionId: legId,
    fromIso: floor,
    inbound: [],
    results: [],
    sends: [],
    tenures: chairTenureList,
  };
  // The tenures always hold at least the span's own tenure, so the last one is there.
  const untilIso = chair.tenures.at(-1)!.untilIso;
  if (session.host === "codex") {
    return walkCodexSpan({ base: { chair, leg, session, untilIso }, floor, links });
  }
  const read = readChairTranscript({ projectsDir, sessionId: session.id, sinceIso: floor, untilIso: span.untilIso });
  if (read.isErr()) {
    return { chair, gaps: [], leg, peerGap: "", session, turns: [], untilIso, why: read.error.join("; ") };
  }
  return {
    session,
    chair: { ...chair, ...read.value.traffic },
    gaps: [...chairReadGaps({ read: read.value }), ...unwalkedTenureGaps({ sinceIso, span, tenures: chair.tenures })],
    leg: { ...leg, turns: read.value.turns.length },
    peerGap: "",
    turns: read.value.turns,
    untilIso,
    why: "",
  };
}

/**
 * The chairs the owner window dropped that can still hold a peer message inside it: walked for their traffic
 * only, never counted as legs or coverage, because their owner turns all fall before the floor.
 *
 * @param window the walked owner window, whose dropped spans these are
 * @param sinceIso the floor
 * @returns every walk, readable or not — the caller keeps the readable chairs and discloses the rest
 */
export function lateWrittenChairs({
  window,
  sinceIso,
}: {
  window: WalkedOwnerWindow;
  sinceIso: string | undefined;
}): readonly WalkedSpan[] {
  const { allSpans, links, projectsDir, spans, tenures } = window;
  return allSpans
    .filter((span) => !spans.includes(span) && writtenSince({ projectsDir, session: span.link.session, sinceIso }))
    .map((span) => walkSpan({ links, projectsDir, sinceIso, span, tenures }));
}

/**
 * The owner window of the chain, as `ownerWindow` builds it, with the spans it keeps walked.
 *
 * @param home the state home, where the pin record lives
 * @param claudeHome the directory holding Claude Code's own projects
 * @param chain every session that has held the supervisor pin, in any order
 * @param sinceIso the floor, or `undefined` to read the whole chain
 * @returns the window, every span it keeps walked
 */
export function walkOwnerWindow({
  home,
  claudeHome,
  chain,
  sinceIso,
}: {
  home: string;
  claudeHome: string;
  chain: readonly SupervisorLink[];
  sinceIso: string | undefined;
}): WalkedOwnerWindow {
  const pinned = pinAsLink({ home });
  const links = [...chain, ...pinned];
  const { allSpans, ordered, spans, tenures } = ownerWindow({ chain, pinned, sinceIso });
  const projectsDir = join(claudeHome, "projects");
  const walked = spans.map((span) => walkSpan({ links, projectsDir, sinceIso, span, tenures }));
  return { allSpans, links, ordered, projectsDir, spans, tenures, walked };
}

/**
 * Every readable chair's owner turns, ordered by `Date.parse` of each timestamp as the intake read always has.
 *
 * @param readable the walks that succeeded
 * @returns their owner turns, oldest first
 */
export function sortedTurnsOf({ readable }: { readable: readonly WalkedSpan[] }): readonly OwnerTurn[] {
  return readable
    .flatMap((item) => item.turns)
    .toSorted((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

/**
 * Whether a chair's transcript was last written at or after the floor — the one cheap question that decides
 * whether a chair the owner window dropped can still hold a peer message inside it.
 *
 * A transcript that cannot be found or stat'd is not walked: the owner-window read already reports an
 * unreadable link, and a retired chair with no file holds no message to carry. A retired Codex chair has no
 * Claude transcript to stat and its peer messages are not read, so it is never walked here; one still inside the
 * owner window is walked for its owner turns by `walkSpan`, its unread peer traffic disclosed there.
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
