/**
 * The reader for `talk calls --json` — the console voice's earlier calls, as they were written down while they ran
 * (`src/talk/callStore.ts`), so a call that dropped is still readable in the call widget's session details tray
 * (`../voice/VoiceSession.tsx`).
 *
 * A sibling of `./read.ts`, and every rule that file's module doc states governs this one: refuse rather than
 * substitute, never DROP a row. What follows states only what is different: a line's `final` is the one field the
 * page draws differently — `false` is speech the call dropped in the middle of, drawn as "(cut off)".
 */

import { type Bag, bags, bool, isBag, str, strings } from "../../lib/bag";
import { OWNER_SPEAKER } from "../../lib/chatThread";

/** One stretch of speech on an earlier call. */
export interface TalkCallLine {
  readonly id: string;
  readonly who: typeof OWNER_SPEAKER | "voice";
  readonly text: string;
  /** Whether the call closed it; `false` is speech it dropped in the middle of. */
  readonly final: boolean;
}

/** One earlier call. */
export interface TalkCallRow {
  readonly callId: string;
  readonly openedIso: string;
  /** How it ended, in the verb's own words — or that no end was recorded. */
  readonly end: string;
  readonly lines: readonly TalkCallLine[];
  /** How many relays it made. */
  readonly relays: number;
}

/** What the section draws. */
export interface TalkCalls {
  readonly calls: readonly TalkCallRow[];
  /** Call files the verb could not read, each with why. */
  readonly unreadable: readonly string[];
}

/**
 * One segment off the wire.
 *
 * @param segment the segment's bag
 * @returns the line, or `undefined` when a field is missing
 */
function lineOf({ segment }: { segment: Bag }): TalkCallLine | undefined {
  const id = str({ bag: segment, key: "id" });
  const who = str({ bag: segment, key: "who" });
  const text = str({ bag: segment, key: "text" });
  const final = bool({ bag: segment, key: "final" });
  if (id === undefined || text === undefined || final === undefined || (who !== OWNER_SPEAKER && who !== "voice")) {
    return undefined;
  }
  return { final, id, text, who };
}

/**
 * One call off the wire.
 *
 * @param call the call's bag
 * @returns the row, or `undefined` when a field or a segment is unreadable
 */
function callOf({ call }: { call: Bag }): TalkCallRow | undefined {
  const callId = str({ bag: call, key: "callId" });
  const openedIso = str({ bag: call, key: "openedIso" });
  const end = str({ bag: call, key: "end" });
  const segments = bags({ bag: call, key: "segments" });
  const notes = bags({ bag: call, key: "notes" });
  if (
    callId === undefined ||
    openedIso === undefined ||
    end === undefined ||
    segments === undefined ||
    notes === undefined
  ) {
    return undefined;
  }
  const lines: TalkCallLine[] = [];
  for (const segment of segments) {
    const line = lineOf({ segment });
    if (line === undefined) {
      return undefined;
    }
    lines.push(line);
  }
  const relays = notes.filter((note) => str({ bag: note, key: "kind" }) === "relay").length;
  return { callId, end, lines, openedIso, relays };
}

/**
 * Project `talk calls --json` into the earlier-calls section.
 *
 * @returns every call newest first, in the verb's own order, or `undefined` when one is unreadable
 */
export function readTalkCalls(payload: unknown): TalkCalls | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const wire = bags({ bag: payload, key: "calls" });
  const unreadable = strings({ bag: payload, key: "unreadable" });
  if (wire === undefined || unreadable === undefined) {
    return undefined;
  }
  const calls: TalkCallRow[] = [];
  for (const call of wire) {
    const row = callOf({ call });
    if (row === undefined) {
      return undefined;
    }
    calls.push(row);
  }
  return { calls, unreadable };
}
