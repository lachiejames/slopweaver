/**
 * Which turn a completed message answered, and so which tool answers were its source: the turn-attribution half of
 * `./callFidelity.ts`. A tool line names its turn; a line from before that existed, and a typed reply whose `wrote`
 * line never landed, are read by time window instead, and a window two turns could have filled is called ambiguous
 * rather than given to either.
 */
import type { CallRecord } from "./callRecord.js";
import type { TalkSurface } from "./talkSurface.js";

/** One message the thinking model completed, on either surface. */
export interface Completed {
  readonly atIso: string;
  readonly id: string;
  readonly turnId: string | undefined;
  readonly text: string;
  readonly surface: TalkSurface;
  /** Where the owner read it, for a typed reply; a voiced message's anchor comes from its voice pair. */
  readonly anchor: string | undefined;
}

/**
 * The instant a message's turn began reading: its start note, else just after the message before its turn's run of
 * messages (a line stamped with that message's own instant is that message's, never the next one's; a turn's later
 * message keeps what it read before its earlier one), else the call's open. Only an unbroken run
 * reaches back, so a window never spans another turn's message.
 *
 * @param one the message
 * @param earlier every message completed before it, oldest first
 * @returns the window's first instant, epoch milliseconds
 */
export function turnStartMs({
  call,
  one,
  earlier,
}: {
  call: CallRecord;
  one: Completed;
  earlier: readonly Completed[];
}): number {
  if (one.turnId !== undefined) {
    const started = call.notes.find((note) => startedTurn({ note }) === one.turnId);
    if (started !== undefined) {
      return Date.parse(started.atIso);
    }
  }
  let at = earlier.length - 1;
  while (one.turnId !== undefined && at >= 0 && earlier[at]!.turnId === one.turnId) {
    at -= 1;
  }
  const before = earlier[at];
  if (before === undefined) {
    return Date.parse(call.openedIso);
  }
  return Date.parse(before.atIso) + 1;
}

/**
 * Whether a line is one the console's Codex turn wrote: only its lines start or end a turn, so another tool's detail
 * that reads like one never does.
 */
function isCodexLine({ note }: { note: CallRecord["notes"][number] }): boolean {
  return note.kind === "tool" && note.name === "codex";
}

/**
 * The turn a line ends, if it is an end line: `turn <id> completed|interrupted|failed`, with `: <failure>` after it as
 * `site/components/voice/planWiringLines.ts`'s `codexTurnLine` writes one, or ` — <failure>`.
 */
function endedTurn({ note }: { note: CallRecord["notes"][number] }): string | undefined {
  const ended = /^turn (\S+) (?:completed|interrupted|failed)(?:$|: | — )/u.exec(note.detail);
  if (!isCodexLine({ note }) || ended === null) {
    return undefined;
  }
  return ended[1]!;
}

/** The turn a line starts, if it is a start line. */
function startedTurn({ note }: { note: CallRecord["notes"][number] }): string | undefined {
  const started = /^turn (\S+) started$/u.exec(note.detail);
  if (!isCodexLine({ note }) || started === null) {
    return undefined;
  }
  return started[1]!;
}

/**
 * The turns running as each line landed, in the call file's own order: a line stamped in the same millisecond as
 * another turn's end is read before or after it as it was written, never by its stamp.
 */
function runningAsEachLanded({ call }: { call: CallRecord }): ReadonlyMap<object, readonly string[]> {
  const running = new Set<string>();
  const landed = new Map<object, readonly string[]>();
  for (const note of call.notes) {
    landed.set(note, [...running]);
    const started = startedTurn({ note });
    if (started !== undefined) {
      running.add(started);
    }
    const ended = endedTurn({ note });
    if (ended !== undefined) {
      running.delete(ended);
    }
  }
  return landed;
}

/**
 * The turns running at a message's instant, by id, walking the lifecycle lines in the call file's order: a start in
 * that very millisecond counts as landed and an end in it does not, since a reply comes before its turn's end line
 *.
 */
function runningAt({ call, atMs }: { call: CallRecord; atMs: number }): readonly string[] {
  const running = new Set<string>();
  for (const note of call.notes) {
    const lineMs = Date.parse(note.atIso);
    const started = startedTurn({ note });
    if (started !== undefined && lineMs <= atMs) {
      running.add(started);
    }
    const ended = endedTurn({ note });
    if (ended !== undefined && lineMs < atMs) {
      running.delete(ended);
    }
  }
  return [...running];
}

/**
 * The turn a reply naming none answered: the one unclaimed turn still running as it landed, whenever it started, since
 * a reply comes before its turn's end line, and any unclaimed turn with no lifecycle lines (a call file before them)
 * that its window's tool lines name. Two candidates, of either kind, cannot be told apart. A
 * turn that ended before the reply is never its answer's turn, so it is no candidate, even one that started in the
 * window. The
 * reply is placed by its stamp, not its place in the file, so a turn ending in its very millisecond is still a
 * candidate: the reply is then ambiguous and read against none, never given to the wrong turn.
 */
function replyTurnOf({
  call,
  inWindow,
  claimed,
  toMs,
}: {
  call: CallRecord;
  inWindow: readonly { readonly turnId?: string | undefined }[];
  claimed: ReadonlySet<string>;
  toMs: number;
}): { readonly own: string | undefined; readonly ambiguous: boolean } {
  const running = new Set(runningAt({ atMs: toMs, call }).filter((id) => !claimed.has(id)));
  // A turn that wrote a start line is judged by `running` alone, so one that ended before the reply is never named back
  // in; only a turn with no lifecycle lines at all (a call file before them) is read off the window.
  const lifecycled = new Set(
    call.notes.flatMap((note) => {
      const endedEarlier = Date.parse(note.atIso) < toMs ? endedTurn({ note }) : undefined;
      return [startedTurn({ note }), endedEarlier].filter((id) => id !== undefined);
    }),
  );
  const named = new Set(
    inWindow.flatMap((note) => (note.turnId === undefined || lifecycled.has(note.turnId) ? [] : [note.turnId])),
  );
  // Both kinds together: a running turn and a named one with no lifecycle lines are two candidates, never one.
  const candidates = new Set([...running, ...named]);
  return { ambiguous: candidates.size > 1, own: [...candidates][0] };
}

/**
 * A message's own turn's tool answers, and whether its window was ambiguous. A typed reply whose `wrote` line never
 * landed carries no turn id, so its window is read instead, and a named tool there counts only when no other message
 * claims its turn; two unclaimed turns, by an answer or as a candidate, cannot be told apart, so no tool counts. An
 * answer naming no turn, landed while another turn was running, is that turn's as likely, so it never counts either
 *.
 *
 * @param tools every answered tool line on the call
 * @param one the message
 * @param claimed the turns a completed message names, so never another reply's
 * @param fromMs the window's first instant
 * @param toMs the message's own instant, the window's last
 * @returns the tool answers counted as its turn's, and whether the window was ambiguous
 */
export function turnToolsOf<Tool extends { readonly atIso: string; readonly turnId?: string | undefined }>({
  call,
  tools,
  one,
  claimed,
  fromMs,
  toMs,
}: {
  call: CallRecord;
  tools: readonly Tool[];
  one: Completed;
  claimed: ReadonlySet<string>;
  fromMs: number;
  toMs: number;
}): { readonly turnTools: readonly Tool[]; readonly ambiguous: boolean } {
  const inWindow = tools.filter((note) => {
    const atMs = Date.parse(note.atIso);
    if (note.turnId === undefined) {
      return atMs >= fromMs && atMs <= toMs;
    }
    if (one.turnId === undefined) {
      return !claimed.has(note.turnId) && atMs >= fromMs && atMs <= toMs;
    }
    // Its own turn's, and only those that had landed: a later read of the same turn is not this message's source. A
    // message carries no place in the file, so a line in its very millisecond counts, however it was ordered (documented).
    return note.turnId === one.turnId && atMs <= toMs;
  });
  let own = one.turnId;
  if (own === undefined) {
    const reply = replyTurnOf({ call, claimed, inWindow, toMs });
    if (reply.ambiguous) {
      return { ambiguous: true, turnTools: [] };
    }
    own = reply.own;
  }
  // A line naming a turn counts only for that turn; one naming none only when no other turn was running as it landed,
  // started in the window or before it: otherwise it is that turn's as likely. Every tool is
  // one of the call's own lines, so it has a place in the file.
  // Where its own turn wrote a start line, one naming none counts only once that turn was running in the file's order,
  // so a line written just before the start in the same millisecond is outside it.
  const landed = runningAsEachLanded({ call });
  const ownStarts = own !== undefined && call.notes.some((note) => startedTurn({ note }) === own);
  const outside = (note: Tool): boolean => ownStarts && !landed.get(note)!.includes(own!);
  const untold = inWindow.filter(
    (note) => note.turnId === undefined && !outside(note) && !landed.get(note)!.every((id) => id === own),
  );
  const kept = inWindow.filter((note) =>
    note.turnId === undefined ? !outside(note) && !untold.includes(note) : note.turnId === own,
  );
  return { ambiguous: untold.length > 0, turnTools: kept };
}
