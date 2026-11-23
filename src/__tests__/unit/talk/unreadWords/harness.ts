/*
 * What the `talk unread` word-selection test files share: the two call ids, the frontier a hand-built tail's
 * lines count on from, a segment of the owner's words, and the tail and read every case wraps them in. Every tail is
 * built by hand, so each case says exactly what the file held. They moved here when the pure half's tests were
 * split by behaviour.
 */
import type { CallOrigin } from "../../../../talk/callOrigin.js";
import type { CallEntry } from "../../../../talk/callRecord.js";
import type { CallFrontier, CallTail, UnreadRead } from "../../../../talk/unreadWords.js";

export const CALL = "a0000035-0000-4000-8000-000000000038";
export const OTHER = "a0000041-0000-4000-8000-000000000044";
export const FRONTIER: CallFrontier = { offset: 42, prefixSha256: "sha256:abc" };

/**
 * One transcribed segment spoken by the owner, final unless a case says otherwise.
 *
 * @returns the segment entry, stamped at the instant given
 */
export const said = ({
  id,
  atIso,
  text,
  final = true,
}: {
  id: string;
  atIso: string;
  text: string;
  final?: boolean;
}): Extract<CallEntry, { kind: "segment" }> =>
  ({ atIso, final, id, kind: "segment", text, who: "owner" }) satisfies CallEntry;

/**
 * A call's unread tail holding exactly these entries, each line's frontier counted on from {@link FRONTIER}.
 *
 * @returns the tail, with nothing seen, no relay and no origin before it unless a case names one
 */
export const tail = ({
  callId = CALL,
  entries,
  seenBefore = [],
  endedBefore = false,
  originBefore,
  seenOriginBefore = new Map(),
}: {
  callId?: string;
  entries: readonly CallEntry[];
  seenBefore?: readonly string[];
  endedBefore?: boolean;
  originBefore?: CallOrigin;
  seenOriginBefore?: ReadonlyMap<string, CallOrigin | undefined>;
}): CallTail => ({
  callId,
  endedBefore,
  finalBefore: [],
  originBefore,
  relaysBefore: [],
  seenOriginBefore,
  seenBefore,
  lines: entries.map((entry, index) => ({
    after: { offset: FRONTIER.offset + index, prefixSha256: `${FRONTIER.prefixSha256}${String(index)}` },
    entry,
    kind: "entry",
    sha256: `sha256:line-${String(index)}`,
  })),
  start: undefined,
});

/**
 * A read over these tails: a first read under the bootstrap floor when one is given, else one past a cursor.
 *
 * @returns the read, with nothing quarantined
 */
export const readOf = ({
  tails,
  bootstrapFloorIso,
}: {
  tails: readonly CallTail[];
  bootstrapFloorIso?: string;
}): UnreadRead => ({
  bootstrapFloorIso,
  cursor: bootstrapFloorIso === undefined ? { calls: {}, recordedAtIso: "2026-09-26T00:00:00.000Z" } : undefined,
  quarantined: [],
  tails,
});
