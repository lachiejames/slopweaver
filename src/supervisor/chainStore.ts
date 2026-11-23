/**
 * Appending and reading the supervisor-chain journal — the effectful half of {@link ./chain}.
 *
 * Same shape as `./intakeStore.ts` beside it, for the same reasons: the READ side swallows its own I/O
 * failure, because a machine that has never taken a pin through a Slopweaver verb is the ordinary state of a
 * fresh install and an absent file must read as "no chain" rather than as a crash in the sweep; the WRITE
 * side reports, because a link nobody recorded is a supervisor nobody can audit. Owner-only permissions,
 * matching the session ledger beside it — a link names a live workspace.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { appendLines } from "#lib/appendSeparator.js";
import { isAbsentError, nonBlockingFileBytes } from "#lib/presentFile.js";
import { stateHomePaths } from "../stateHome.js";
import { orderChain, parseSupervisorChainJournal, parseSupervisorLinkLine, type SupervisorLink } from "./chain.js";

/** Owner-only permissions, matching `../sessions/sessionStore.ts`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The chain journal's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `sessions/supervisor-chain.jsonl`
 */
function supervisorChainPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).supervisorChainJsonl;
}

/**
 * The chain the journal holds, one link per session, oldest first.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the ordered chain; empty when the journal is absent or unreadable
 */
export function readSupervisorChain({ home }: { home?: string } = {}): readonly SupervisorLink[] {
  try {
    const text = readFileSync(supervisorChainPath(home === undefined ? {} : { home }), "utf8");
    return orderChain({ links: parseSupervisorChainJournal({ text }) });
  } catch {
    return [];
  }
}

/**
 * Every link the journal holds, UNORDERED and unmerged — each pin a session took, not one per session.
 *
 * {@link readSupervisorChain} keeps one link per session, which is right for walking each transcript once and
 * loses the intervals a chair held the pin: a session that took the pin back would read as retired. The
 * inbound check places messages against those intervals (`./chain.ts`'s `chairTenures`), so it reads this.
 * `orderChain` over this is exactly {@link readSupervisorChain}.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns every link; empty when the journal is absent or unreadable
 */
export function readSupervisorChainEvents({ home }: { home?: string } = {}): readonly SupervisorLink[] {
  try {
    return parseSupervisorChainJournal({
      text: readFileSync(supervisorChainPath(home === undefined ? {} : { home }), "utf8"),
    });
  } catch {
    return [];
  }
}

/**
 * The journal's lines, each decoded strictly: a line that is not UTF-8 is `undefined`, since a repaired one could
 * still parse as a link nobody wrote and claim coverage the chain never had.
 */
function strictUtf8Lines({ bytes }: { bytes: Buffer }): readonly (string | undefined)[] {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const lines: (string | undefined)[] = [];
  let start = 0;
  while (start <= bytes.length) {
    const newline = bytes.indexOf(0x0a, start);
    const end = newline === -1 ? bytes.length : newline;
    try {
      lines.push(decoder.decode(bytes.subarray(start, end)));
    } catch {
      lines.push(undefined);
    }
    start = end + 1;
  }
  return lines;
}

/**
 * Every link the journal holds, unordered and unmerged as {@link readSupervisorChainEvents} reads them — and, unlike
 * it, what the read could not take: a journal that is there and will not read, and every line that will not decode.
 *
 * A reader that claims to have read the owner's whole chain needs this. The swallowing readers stay as they are for the
 * sweeps that must never crash; an absent journal is still a fresh install here, not a problem.
 *
 * @param home the state home
 * @returns the links, and one sentence per thing that was not read
 */
export function readSupervisorChainJournal({ home }: { home: string }): {
  readonly links: readonly SupervisorLink[];
  readonly problems: readonly string[];
} {
  const path = supervisorChainPath({ home });
  let bytes: Buffer;
  try {
    // A FIFO at the path would block a plain read forever, so it is opened non-blocking and refused.
    bytes = nonBlockingFileBytes({ path });
  } catch (cause: unknown) {
    if (isAbsentError({ error: cause, path })) {
      return { links: [], problems: [] };
    }
    return { links: [], problems: [`the supervisor chain journal would not read: ${String(cause)}`] };
  }
  const lines = strictUtf8Lines({ bytes }).filter((line) => line === undefined || line.trim().length > 0);
  const links = lines
    .map((line) => (line === undefined ? undefined : parseSupervisorLinkLine({ line })))
    .filter((link): link is SupervisorLink => link !== undefined);
  if (links.length === lines.length) {
    return { links, problems: [] };
  }
  const skipped = lines.length - links.length;
  return { links, problems: [`${String(skipped)} line(s) of the supervisor chain journal do not parse`] };
}

/**
 * Append one link to the journal.
 *
 * Appending a session the journal already holds is harmless rather than guarded against: {@link orderChain}
 * keeps one link per session on the way out, and refusing the write here would mean READING the whole
 * journal on a `PreToolUse`-adjacent path to decide.
 *
 * @param link the link to record
 * @param home the state home (defaults to the resolved home)
 */
export function appendSupervisorLink({ link, home }: { link: SupervisorLink; home?: string }): void {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  mkdirSync(paths.sessions, { mode: DIR_MODE, recursive: true });
  appendLines({ mode: FILE_MODE, path: paths.supervisorChainJsonl, text: `${JSON.stringify(link)}\n` });
}
