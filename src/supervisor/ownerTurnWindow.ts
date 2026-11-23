/**
 * The owner's turns in a window, from two sources: the supervisor chain (`./intakeRead.ts`, every transcript that
 * has held the pin) and the `### RULINGS` rows of any state-doc archive touched inside the window.
 *
 * Two kinds of gap come back apart, because their readers differ. `unreadable` is what the takeover gate refuses on
 * (`../cli/commands/supervisor/ownerTurnsRun.ts`); `readerGaps` names a chain starting after the floor and each
 * Claude chair whose transcript would not read whole, which `talk history` discloses and the gate does not refuse on.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { archivedRulings, rulingArchiveDir } from "../handover/archivedRulings.js";
import { chainReachesSince } from "./chain.js";
import { readSupervisorChainJournal } from "./chainStore.js";
import { readSupervisorChainTurns } from "./intakeRead.js";
import { pinAsLink } from "./intakeScope.js";
import { collapseRulingCopies, type ReadableTurn, RULING_POINTER_PREFIX } from "./ownerTurnReceipts.js";
import { type ChainWindow, ownerWindowGaps } from "./ownerWindowGaps.js";

/**
 * The Claude Code directory a verb reads chair transcripts from: `~/.claude`, passed in rather than read inside the
 * window so a test can hand it a fixture instead of the machine's own transcripts.
 *
 * @returns its absolute path
 */
export function chairClaudeHome(): string {
  return join(homedir(), ".claude");
}

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/** Each `### RULINGS` row, addressed by its file and line, and what of the archive would not read. */
function rulingRows({ home, sinceMs }: { home: string; sinceMs: number }): {
  turns: readonly ReadableTurn[];
  problems: readonly string[];
} {
  const read = archivedRulings({ archiveDir: rulingArchiveDir({ home }), sinceMs });
  const turns = read.rows.map((row) => ({
    instantIso: row.instantIso,
    pointer: `${RULING_POINTER_PREFIX}${row.path}#${String(row.line)}`,
    source: "ruling" as const,
    text: row.text,
  }));
  return { problems: read.problems, turns };
}

/**
 * The owner's turns in the window, from the supervisor chain — the owner window only. The chain INTAKE read also
 * checks every chair the window dropped for peer traffic and scans the whole board for witnesses, and this
 * reader uses neither. `readSupervisorChainTurns` says what they cost the console voice.
 */
function chairTurns({ chain, claudeHome, home, sinceIso }: ChainWindow & { claudeHome: string }): {
  readonly turns: readonly ReadableTurn[];
  readonly unreadChairs: readonly string[];
} {
  const { turns, unreadChairs } = readSupervisorChainTurns({ chain, claudeHome, home, sinceIso });
  return {
    turns: turns.map((turn) => ({
      instantIso: turn.timestamp,
      pointer: turn.pointer,
      source: "chair" as const,
      text: turn.text,
    })),
    unreadChairs,
  };
}

/** Everything the reader found, and what it could not read. */
export interface OwnerTurnWindow {
  readonly turns: readonly ReadableTurn[];
  readonly sinceIso: string;
  /** What the gate refuses on: a journal, pin, ruling archive or Codex chair that would not read. */
  readonly unreadable: string | undefined;
  /**
   * What a reader discloses and the gate does not refuse on: a chain that starts after the floor, then each Claude
   * chair in the window whose transcript would not read whole.
   */
  readonly readerGaps: readonly string[];
}

/**
 * The gap when the chain, pin included, starts after the floor, or `undefined` when it reaches it. Nothing on disk
 * proves the earliest link was the first supervisor there was, so a later start is a stretch nobody read.
 */
function chainReachGap({
  chain,
  home,
  sinceIso,
}: Pick<ChainWindow, "chain" | "home" | "sinceIso">): string | undefined {
  const links = [...chain, ...pinAsLink({ home })].toSorted(
    (left, right) => Date.parse(left.pinnedAtIso) - Date.parse(right.pinnedAtIso),
  );
  if (chainReachesSince({ links, sinceIso })) {
    return undefined;
  }
  const earliest = links[0];
  if (earliest === undefined) {
    return `no supervisor chain is recorded, so no owner turn since ${sinceIso} was read`;
  }
  return `the supervisor chain starts at ${earliest.pinnedAtIso}, after the floor ${sinceIso}, so an owner turn before it was not read`;
}

/**
 * Read every turn of the owner's in the window.
 *
 * @param home the state home
 * @param claudeHome the Claude Code config directory whose `projects` holds each chair's transcript
 * @param nowIso the instant the window is measured back from
 * @param days how many days back to read
 * @returns the turns, the floor they were read from, and any read that failed
 */
export function readOwnerTurnWindow({
  home,
  claudeHome,
  nowIso,
  days,
}: {
  home: string;
  claudeHome: string;
  nowIso: string;
  days: number;
}): OwnerTurnWindow {
  const sinceMs = Date.parse(nowIso) - days * DAY_MS;
  const sinceIso = new Date(sinceMs).toISOString();
  const rulings = rulingRows({ home, sinceMs });
  // The chain is read STRICTLY: a line that will not decode could be a newer link closing an older Claude tenure, so
  // skipping it would read that Claude transcript past its tenure and call the window clean.
  const { links: chain, problems } = readSupervisorChainJournal({ home });
  const chairs = chairTurns({ chain, claudeHome, home, sinceIso });
  const turns = collapseRulingCopies({ turns: [...chairs.turns, ...rulings.turns] });
  // An archive that will not read, or a Codex chair no reader opens, could hold a turn never shown, so the gate
  // refuses rather than counting short. A Claude chair transcript that will not read stays out of
  // `unreadable`, which the gate refuses on, and travels in `readerGaps` for a reader to disclose; so does a chain
  // that starts after the floor, which the gate never refused on either.
  const unreadable =
    problems.length > 0
      ? `the supervisor chain journal would not read cleanly: ${problems.join("; ")}`
      : ownerWindowGaps({ chain, home, rulingProblems: rulings.problems, sinceIso });
  const reach = chainReachGap({ chain, home, sinceIso });
  const readerGaps = reach === undefined ? chairs.unreadChairs : [reach, ...chairs.unreadChairs];
  return { readerGaps, sinceIso, turns, unreadable };
}
