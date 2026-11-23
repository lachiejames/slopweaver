/**
 * The runs a session is inside right now, read off the two registers that already record them.
 *
 * ## Why two registers, and why both are read rather than one authored
 *
 * A board run names its branch the moment `handover start` opens it, and its doc names what the run is for.
 * A session on the ledger names its branch the moment `cmux spawn` opens it, and its latest note names
 * whatever the supervisor learned. Neither was written for this reader, which is the point: a session that
 * is genuinely working a pull request leaves that fact in one of them without anyone remembering to say so
 * here. A third list, kept for this purpose, would be a register nobody keeps.
 *
 * ## A dead holder's run is not in flight
 *
 * The board half asks whether the session that holds the run still exists, using the same verdict
 * {@link ./boardLeg} and `handover claim` read. A run whose holder is dead is an abandoned run — it may
 * still be on the board waiting on the owner, and the board leg says so — but nobody is inside its work, so it
 * cannot hold a row back. `unknown` is not death and keeps the run in flight, the same asymmetry every other
 * reader of that verdict keeps.
 *
 * Pure — no I/O, no clock. The caller reads the board, the journals and the ledger, and hands them over.
 */

import { absentAs } from "#lib/absent.js";
import type { HandoverDoc } from "../handover/doc.js";
import type { RunEvent } from "../handover/ledger.js";
import { runStateOf } from "../handover/ledger.js";
import type { WriterLiveness } from "../handover/runOwner.js";
import type { SessionItem } from "../sessions/session.js";
import type { InFlightRun } from "./standing.js";
import { anchorsIn } from "./standing.js";

/**
 * One board doc with everything this reader needs to say whether a session is inside it.
 *
 * `text` is the doc's whole file — front matter and body — because the anchors a run is about live in its
 * prose as much as in any one field. `holder` is required-but-possibly-undefined for the reason
 * {@link ./boardLeg.BoardEntry} gives: a caller that has not measured it has to say so.
 */
export interface BoardRunEntry {
  readonly doc: HandoverDoc;
  readonly text: string;
  readonly events: readonly RunEvent[];
  readonly holder: WriterLiveness | undefined;
}

/**
 * The in-flight run one board doc represents, or undefined when nobody is inside it.
 *
 * A run counts while its current cycle is `open` or `waiting-on-owner` and its holder is not known dead. The
 * branch is the journal's own `started` branch, falling back to the doc's declared `branch:` when the journal
 * recorded a blank one — a run opened from a detached checkout names no branch, and the doc still says which
 * one the work is on.
 *
 * @param entry the doc, its text, its journal and its holder's liveness
 * @returns the run, or undefined when it is closed, never started, or held by a dead session
 */
export function boardRunOf({ entry }: { entry: BoardRunEntry }): InFlightRun | undefined {
  const state = runStateOf({ events: entry.events });
  if (state.phase === "closed" || entry.holder?.kind === "dead") {
    return undefined;
  }
  const branch = [state.branch, entry.doc.branch].find((name) => name !== undefined && name.length > 0);
  const repo = repoNameOf({ path: entry.doc.repo });
  return {
    anchors: anchorsIn({ text: entry.text }),
    branch,
    slug: entry.doc.slug,
    ...(repo === undefined ? {} : { repo }),
  };
}

/**
 * The repository a doc's `repo:` path names, as its last segment — the name a pull request's slug ends in.
 *
 * @param path the doc's declared checkout path, or undefined when it declares none
 * @returns the last path segment, or undefined when there is no path or it ends in nothing
 */
export function repoNameOf({ path }: { path: string | undefined }): string | undefined {
  if (path === undefined) {
    return undefined;
  }
  const name = path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1);
  return name === undefined || name.length === 0 ? undefined : name;
}

/**
 * The in-flight run one session-ledger row represents, or undefined when the session is closed.
 *
 * The slug is the doc the session was spawned for when it had one, and the session key otherwise — a session
 * registered by a bare note has no doc, and its key is the only name it has.
 *
 * @param session one folded ledger row
 * @returns the run, or undefined when the session has been closed
 */
export function sessionRunOf({ session }: { session: SessionItem }): InFlightRun | undefined {
  if (session.status === "closed") {
    return undefined;
  }
  const branch = session.branch;
  return {
    anchors: session.latestNote === undefined ? [] : anchorsIn({ text: session.latestNote }),
    branch: branch === undefined || branch.length === 0 ? undefined : branch,
    sessionKey: session.sessionKey,
    slug: absentAs({ value: session.slug, whenAbsent: session.sessionKey }),
  };
}

/**
 * Every run a session is inside, from both registers.
 *
 * Board runs come first so a row joined to both names the run's slug rather than a session key, which is
 * the name the owner resumes it by.
 *
 * @param board every board doc with its journal and holder
 * @param sessions every folded session-ledger row
 * @returns the runs, in the order given
 */
export function inFlightRuns({
  board,
  sessions,
}: {
  board: readonly BoardRunEntry[];
  sessions: readonly SessionItem[];
}): readonly InFlightRun[] {
  const fromBoard = board.flatMap((entry) => {
    const run = boardRunOf({ entry });
    return run === undefined ? [] : [run];
  });
  const fromSessions = sessions.flatMap((session) => {
    const run = sessionRunOf({ session });
    return run === undefined ? [] : [run];
  });
  return [...fromBoard, ...fromSessions];
}
