/**
 * How a transcript loss is said: which calls and turns some lines the route refused, or the queue dropped, belonged
 * to, and the tool-log line the page writes for them. Pure; `./transcriptSink.ts` decides when a loss happens.
 */

import type { QueuedLine } from "./talkTranscript";

/**
 * The tool-log line for lines the route refused or the queue dropped. A batch can answer after a dropped call has
 * ended — before its reconnect has begun, or once the new call shows — and the tool log is kept
 * across a reconnect, so a loss of no call open now says it is an earlier call's rather than reading as this one's.
 *
 * @param calls the calls the lost lines belonged to
 * @param live the call open now, `undefined` while none is
 * @param lines how many lines were lost
 * @param why the route's reason, or the queue's
 * @returns the line's detail
 */
export function refusedDetail({
  calls,
  live,
  lines,
  why,
}: {
  calls: readonly string[];
  live: string | undefined;
  lines: number;
  why: string;
}): string {
  const earlier = live === undefined || !calls.includes(live);
  const whose = earlier ? " of an earlier call" : "";
  return `${String(lines)} line(s)${whose} not written: ${why}`;
}

/**
 * The distinct calls some queued lines belong to.
 *
 * @returns each call id once, in the order first met
 */
export function callsOf({ lines }: { lines: readonly QueuedLine[] }): readonly string[] {
  return [...new Set(lines.map((line) => line.callId))];
}

/**
 * The turns some lost lines were speech of, as the history names them (`<callId>:<segmentId>`, `./chatThread.ts`): a
 * turn none of whose lines reached the file is one the next read cannot have, so the page keeps the copy it carries.
 *
 * @returns each turn once, in the order first met
 */
export function turnsOf({ lines }: { lines: readonly QueuedLine[] }): readonly string[] {
  return [
    ...new Set(
      lines.flatMap((queued) => (queued.line.kind === "segment" ? [`${queued.callId}:${queued.line.id}`] : [])),
    ),
  ];
}
