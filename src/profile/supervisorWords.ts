/**
 * The owner's turns to the supervisor across the whole pinned chain, for `slopweaver profile words` — read so that what it
 * could not read is SAID, which the intake read beside it (`../supervisor/intakeRead.ts`) does not need to do.
 *
 * Three things differ from that read, each because a list claiming to be the owner's words owes them:
 *
 * - **The journal's own failures are problems.** `readSupervisorChainJournal` reports a journal that will not read
 *   and every line that will not decode, where the sweeps' readers turn both into an empty chain.
 * - **A chair is read over each interval it held the pin, not over one span.** `orderChain` keeps one link per
 *   session, so for A → B → A it ends A at B and walks B to now — A's second tenure is lost and B's later turns
 *   kept. Here every tenure is its own interval and a turn is kept only inside one of them.
 * - **A tenure ends at the next DIFFERENT session's link, whatever its source.** `chairTenures` leaves a scan-opened
 *   tenure open forever, which is right for the peer-message check it serves (a wrongly carried message is the arm
 *   that fails loudly) and wrong here: 86 pre-journal chairs would each overlap every window, so every query would
 *   look up every one of their transcripts.
 *
 * A chair whose tenures all fall outside the window is never looked up, so an old chair whose transcript is gone is
 * not a problem on every query; one inside the window whose transcript will not read is.
 */
import { lstatSync } from "node:fs";
import { join } from "node:path";

import { isAbsentError } from "#lib/presentFile.js";

import { readSupervisorPin } from "../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../stateHome.js";
import {
  CHAIN_RESCAN_COMMAND,
  CODEX_CHAIR_UNREAD,
  chainReachesSince,
  linkKey,
  type SupervisorLink,
} from "../supervisor/chain.js";
import { readSupervisorChainJournal } from "../supervisor/chainStore.js";
import { readChairTranscript } from "../supervisor/chairTranscript.js";
import type { OwnerTurn } from "../supervisor/intake.js";
import { sameSupervisorSession, supervisorSessionLabel, type VisibleSupervisorSession } from "../supervisor/session.js";
import { parseTurnPointer } from "../transcripts/pointer.js";

/** One interval one session held the pin. */
export interface WordsTenure {
  readonly session: VisibleSupervisorSession;
  readonly fromIso: string;
  /** When a different session next took over, or `undefined` for the chair holding it now. */
  readonly untilIso: string | undefined;
}

/** One transcript to read once, over the span of its tenures the window reaches. */
export interface TenureRead {
  readonly session: VisibleSupervisorSession;
  readonly fromIso: string;
  readonly untilIso: string | undefined;
  readonly tenures: readonly WordsTenure[];
}

/**
 * Whether a pinned session's `scan` link opens a tenure of its own. A scan is the instant the session invoked the
 * supervisor skill, so one that sits just before that session's own pin is the same tenure and the pin dates it
 * better. One with another session's link between it and that pin is an EARLIER tenure the pin did not record —
 * dropping it, as `chairTenures` does, loses every turn the owner typed into that chair before it was displaced (scan A,
 * then B pins, then A pins).
 */
function scanOpensTenure({
  link,
  sorted,
  index,
}: {
  link: SupervisorLink;
  sorted: readonly SupervisorLink[];
  index: number;
}): boolean {
  const later = sorted.slice(index + 1);
  const ownPinLater = later.some((each) => each.source === "pin" && linkKey({ link: each }) === linkKey({ link }));
  const next = later.find((each) => linkKey({ link: each }) !== linkKey({ link }) || each.source === "pin");
  return ownPinLater && next !== undefined && linkKey({ link: next }) !== linkKey({ link });
}

/**
 * Every interval each session held the pin, oldest first. A session with any `pin` link is placed by those, plus any
 * scan of it that another session's link separates from a later pin of its own; a second link by the session already holding
 * the pin extends its tenure. A `scan` link is dated from its session's FIRST record (`chainScan.ts`), not the turn
 * that invoked the supervisor skill, so a scan-placed tenure also holds what the owner typed into that session before it
 * took the chair — still the owner's typed words, only listed a few minutes early as supervisor ones.
 *
 * @param links every link, in any order
 * @returns the tenures, oldest first
 */
export function wordTenures({ links }: { links: readonly SupervisorLink[] }): readonly WordsTenure[] {
  const readable = links.filter((link) => !Number.isNaN(Date.parse(link.pinnedAtIso)));
  const pinned = new Set(readable.filter((link) => link.source === "pin").map((link) => linkKey({ link })));
  const sorted = readable.toSorted((left, right) => Date.parse(left.pinnedAtIso) - Date.parse(right.pinnedAtIso));
  const ordered = sorted.filter(
    (link, index) =>
      link.source === "pin" || !pinned.has(linkKey({ link })) || scanOpensTenure({ index, link, sorted }),
  );
  return ordered
    .filter((link, index) => index === 0 || linkKey({ link: ordered[index - 1]! }) !== linkKey({ link }))
    .map((link, index, opened) => ({
      fromIso: link.pinnedAtIso,
      session: link.session,
      untilIso: opened[index + 1]?.pinnedAtIso,
    }));
}

/** Whether one tenure shares any instant with the window. */
function overlaps({ tenure, since, until }: { tenure: WordsTenure; since: number; until: number }): boolean {
  const from = Date.parse(tenure.fromIso);
  const end = tenure.untilIso === undefined ? Number.POSITIVE_INFINITY : Date.parse(tenure.untilIso);
  return from < until && end > since;
}

/**
 * The transcripts a window needs, one per session: from the later of the floor and its first overlapping tenure, to
 * the earlier of the ceiling and its last — open when any of them is.
 *
 * @param tenures every tenure, oldest first
 * @param sinceIso the window's floor, inclusive
 * @param untilIso the window's ceiling, exclusive
 * @returns one read per session that held the pin inside the window, in the order each first did
 */
export function tenureReads({
  tenures,
  sinceIso,
  untilIso,
}: {
  tenures: readonly WordsTenure[];
  sinceIso: string;
  untilIso: string;
}): readonly TenureRead[] {
  const since = Date.parse(sinceIso);
  const until = Date.parse(untilIso);
  const inside = tenures.filter((tenure) => overlaps({ since, tenure, until }));
  const firsts = inside.filter(
    (tenure, index) =>
      inside.findIndex((other) => sameSupervisorSession({ left: other.session, right: tenure.session })) === index,
  );
  return firsts.map(({ session }) => {
    const own = inside.filter((tenure) => sameSupervisorSession({ left: tenure.session, right: session }));
    const from = Math.max(since, Date.parse(own[0]!.fromIso));
    const last = own.at(-1)!.untilIso;
    let end = until;
    if (last !== undefined) {
      end = Math.min(until, Date.parse(last));
    }
    return {
      fromIso: new Date(from).toISOString(),
      session,
      tenures: own,
      untilIso: new Date(end).toISOString(),
    };
  });
}

/**
 * Whether a turn falls inside one of its chair's tenures. A turn carrying no instant is kept, so the query states it
 * as undated rather than this read dropping it unseen.
 *
 * @param timestamp the turn's own instant
 * @param tenures its chair's tenures
 * @returns true when the turn was typed while that chair held the pin, or carries no instant
 */
export function insideTenures({ timestamp, tenures }: { timestamp: string; tenures: readonly WordsTenure[] }): boolean {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) {
    return true;
  }
  return tenures.some((tenure) => {
    const end = tenure.untilIso === undefined ? Number.POSITIVE_INFINITY : Date.parse(tenure.untilIso);
    return at >= Date.parse(tenure.fromIso) && at < end;
  });
}

/**
 * The live pin as a link, so a chair the journal never caught is still read — as `intakeRead.ts` folds it in. Its
 * reader answers nothing for a record that is there and will not read, because it serves a `PreToolUse` hook; here
 * that is a problem, since the chair it names may be the one the owner is typing into now.
 */
function pinLink({ home }: { home: string }): {
  readonly links: readonly SupervisorLink[];
  readonly problems: readonly string[];
} {
  const pin = readSupervisorPin({ home });
  if (pin === undefined) {
    const path = stateHomePaths({ home }).supervisorPinJson;
    try {
      lstatSync(path);
    } catch (cause: unknown) {
      if (isAbsentError({ error: cause, path })) {
        return { links: [], problems: [] };
      }
    }
    return { links: [], problems: [`the supervisor pin record at ${path} would not read`] };
  }
  // A pin with no readable instant cannot open a tenure, so it fails closed as an unreadable pin does, rather than
  // being dropped later and leaving the journal's last chair open.
  // A Codex chair it names is still named, as unread, so the gap says whose words went unwalked.
  if (Number.isNaN(Date.parse(pin.pinnedAtIso))) {
    const path = stateHomePaths({ home }).supervisorPinJson;
    const problem = `the supervisor pin record at ${path} carries no readable pinnedAtIso`;
    if (pin.session.host !== "codex") {
      return { links: [], problems: [problem] };
    }
    const codex = `chair ${supervisorSessionLabel({ session: pin.session })} would not read: ${CODEX_CHAIR_UNREAD}`;
    return { links: [], problems: [problem, codex] };
  }
  const link: SupervisorLink = {
    pinnedAtIso: pin.pinnedAtIso,
    session: pin.session,
    source: "pin",
    workspaceId: pin.workspaceId,
    workspaceRef: pin.workspaceRef,
  };
  return { links: [link], problems: [] };
}

/**
 * What the placed chain could not see of the window: nothing at all, or everything before its first link.
 *
 * @param links every link placed, in any order
 * @param sinceIso the window's floor, inclusive
 * @returns one sentence, or none when the chain reaches the floor
 */
function coverageProblems({
  links,
  sinceIso,
}: {
  links: readonly SupervisorLink[];
  sinceIso: string;
}): readonly string[] {
  const oldestFirst = links.toSorted((a, b) => Date.parse(a.pinnedAtIso) - Date.parse(b.pinnedAtIso));
  if (chainReachesSince({ links: oldestFirst, sinceIso })) {
    return [];
  }
  const earliest = oldestFirst[0];
  if (earliest === undefined) {
    return [`no supervisor chain is recorded, so no supervisor turn was read — \`${CHAIN_RESCAN_COMMAND}\``];
  }
  return [
    `the supervisor chain starts at ${earliest.pinnedAtIso}, so no supervisor turn before it was read — \`${CHAIN_RESCAN_COMMAND}\``,
  ];
}

/** Every chair tenure the chain can vouch for, the links it placed, and every reason it could vouch for less. */
function placedTenures({ home }: { home: string }): {
  readonly links: readonly SupervisorLink[];
  readonly tenures: readonly WordsTenure[];
  readonly problems: readonly string[];
} {
  const journal = readSupervisorChainJournal({ home });
  const pin = pinLink({ home });
  const problems = [...journal.problems, ...pin.problems];
  // A line that would not decode may be the pin that ENDED a tenure, so the surviving links would widen the chair
  // before it over turns typed to its successor. With the journal in doubt only the live pin is placed:
  // its tenure starts at its own pin and runs to now, which no lost line can widen.
  let links = [...journal.links, ...pin.links];
  if (journal.problems.length > 0) {
    links = [...pin.links];
    problems.push("with the chain journal in doubt, only the chair holding the pin now was read — no chair before it");
  }
  // The live pin is written before its journal line, so an unreadable pin may be a hand-over the journal never got
  // the journal's last chair is then not known to hold the pin to now, and only closed tenures are read.
  // An ABSENT pin beside a journal is the same doubt: nothing says the journal's last chair still
  // holds it, so its open tenure is not read either.
  let tenures = wordTenures({ links });
  if (pin.problems.length > 0) {
    tenures = tenures.filter((tenure) => tenure.untilIso !== undefined);
    problems.push(
      "with the pin record unreadable, who holds the pin now is unknown, so the journal's last chair was not read from its last link on",
    );
  } else if (pin.links.length === 0 && links.length > 0) {
    tenures = tenures.filter((tenure) => tenure.untilIso !== undefined);
    problems.push(
      "with no pin record, nothing says the journal's last chair still holds the pin, so it was not read from its last link on",
    );
  }
  return { links, problems, tenures };
}

/**
 * Whether a turn typed into one session at one instant was typed to the chair, judged by the same tenures the list
 * reads — so the one-anchor form never prints a turn the list would leave out.
 *
 * @param home the state home, where the journal and pin record live
 * @param session the session the turn was typed into
 * @param timestamp the turn's own instant
 * @returns whether that session held the pin then, and every reason the chain could vouch for less
 */
function chairHeldAt({
  home,
  session,
  timestamp,
}: {
  home: string;
  session: VisibleSupervisorSession;
  timestamp: string;
}): {
  readonly held: boolean;
  readonly problems: readonly string[];
} {
  const placed = placedTenures({ home });
  const own = placed.tenures.filter((tenure) => sameSupervisorSession({ left: tenure.session, right: session }));
  const at = Date.parse(timestamp);
  const held = !Number.isNaN(at) && own.length > 0 && insideTenures({ tenures: own, timestamp });
  return { held, problems: placed.problems };
}

/**
 * Why a transcript anchor is not read as the owner's: a session that did not hold the supervisor pin when the turn was typed
 * can be typed into by another session, so the list leaves it out — and the one-anchor read and an attach must too.
 *
 * @param anchor any anchor; only a `transcript:` one is judged
 * @param atIso the instant the anchor's turn was typed
 * @param home the state home, where the journal and pin record live
 * @returns the reason, or `undefined` when the anchor is not a transcript turn or was typed to the chair
 */
export function outsideChairReason({
  anchor,
  atIso,
  home,
}: {
  anchor: string;
  atIso: string;
  home: string;
}): string | undefined {
  const pointer = parseTurnPointer({ text: anchor });
  if (pointer === undefined) {
    return undefined;
  }
  const chair = chairHeldAt({ home, session: { host: "claude-code", id: pointer.sessionId }, timestamp: atIso });
  if (chair.held) {
    return undefined;
  }
  const doubt = chair.problems.length > 0 ? ` (${chair.problems.join("; ")})` : "";
  return (
    `${anchor} was typed while that session did not hold the supervisor pin, so it is not read as the owner's — ` +
    `only a chair's turns inside its tenure are${doubt}`
  );
}

/**
 * The owner's turns to every chair that held the pin inside the window, each inside its own tenures, and every part of the
 * chain that would not read.
 *
 * @param home the state home, where the journal and pin record live
 * @param claudeHome the directory holding Claude Code's `projects`
 * @param sinceIso the window's floor, inclusive
 * @param untilIso the window's ceiling, exclusive
 * @returns the turns, unordered, and one sentence per thing not read
 */
export function readSupervisorWords({
  home,
  claudeHome,
  sinceIso,
  untilIso,
}: {
  home: string;
  claudeHome: string;
  sinceIso: string;
  untilIso: string;
}): { readonly turns: readonly OwnerTurn[]; readonly problems: readonly string[] } {
  const placed = placedTenures({ home });
  const problems = [...placed.problems, ...coverageProblems({ links: placed.links, sinceIso })];
  const { tenures } = placed;
  const projectsDir = join(claudeHome, "projects");
  const turns = tenureReads({ sinceIso, tenures, untilIso }).flatMap((read) => {
    if (read.session.host === "codex") {
      problems.push(`chair ${supervisorSessionLabel({ session: read.session })} would not read: ${CODEX_CHAIR_UNREAD}`);
      return [];
    }
    const walked = readChairTranscript({
      projectsDir,
      sessionId: read.session.id,
      sinceIso: read.fromIso,
      untilIso: read.untilIso,
    });
    if (walked.isErr()) {
      problems.push(
        `chair ${supervisorSessionLabel({ session: read.session })} would not read: ${walked.error.join("; ")}`,
      );
      return [];
    }
    // A line that would not parse carries no instant, so it may be a turn of the owner's inside the window.
    const lost = walked.value.traffic.undecoded;
    if (lost.length > 0) {
      problems.push(
        `chair ${supervisorSessionLabel({ session: read.session })}: ${String(lost.length)} line(s) would not parse (first: line ${String(lost[0]!.lineNumber)}, ${lost[0]!.why}), so a turn of the owner's may be among them`,
      );
    }
    // A turn no anchor can name alone is still the owner's, so it is named here rather than left out.
    const unnamed = walked.value.unaddressable.filter((turn) =>
      insideTenures({ tenures: read.tenures, timestamp: turn.timestamp }),
    );
    if (unnamed.length > 0) {
      problems.push(
        `chair ${supervisorSessionLabel({ session: read.session })}: ${String(unnamed.length)} turn(s) of the owner's have no anchor of their own (first: line ${String(unnamed[0]!.lineNumber)}, ${unnamed[0]!.why}), so they are not listed`,
      );
    }
    return walked.value.turns.filter((turn) => insideTenures({ tenures: read.tenures, timestamp: turn.timestamp }));
  });
  return { problems, turns };
}
