/**
 * WHICH messages a read returns — and the one sentence a partial return is obliged to print.
 *
 * ## Why this is a selection and not a diff
 *
 * The obvious design is to persist a snapshot per read and set-diff two of them, so a re-read can report
 * added, changed AND deleted messages. That was specified, pre-mortemed, and cut: every one of its defects
 * — an expiring baseline, a pointer that moves backwards under concurrency, a persistence outcome a boolean
 * cannot express — was a consequence of persisting state at all. With no state none of them arise.
 *
 * What is left is deliberately weaker and honest about it. `--since` takes a Slack timestamp the caller
 * already has (every read prints every message's `ts`), and this module answers one question: which
 * messages were posted after it. It cannot see an edit or a deletion above that timestamp, and the cost of
 * that is paid by {@link describeSelection}, whose sentence is not optional.
 *
 * MEASURED before accepting the trade, so it is on the record rather than assumed: 13.07% of threaded
 * messages in the owner's corpus carry an `edited` object (9,560 of 73,138). Edits are not rare. What is
 * unmeasurable from a corpus that stores one timestamp per record is how many land in the gap BETWEEN two
 * reads of one thread, which is the only case this misses. The owner accepted that risk explicitly.
 *
 * ## Timestamps are compared as two integers, never as one float
 *
 * A Slack `ts` such as `1785114398.557099` needs 16 significant digits, which is at the edge of what a
 * double represents exactly. `Number(a) > Number(b)` can therefore call two adjacent messages equal. The
 * seconds and the fraction are each small enough to be exact, so they are compared as a pair.
 *
 * Pure: no clock, no filesystem, no network.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type SlackSelectionError, SlackSelectionErrors } from "./selectionErrors.js";
import type { VisibleSlackMessage } from "./types.js";

/**
 * A raw Slack `ts`: whole seconds, a dot, and a fraction of one to nine digits.
 *
 * Two bounds, each chosen rather than inherited, and the exact widths matter because a review pass
 * challenged both:
 *
 *  - **Not exactly six**, though all 307,747 real timestamps in the owner's corpus carry exactly six. Width
 *    is not what this check is FOR — it catches prose, a date, or the dot-stripped `p1785114398557099` form
 *    out of a permalink, and all of those still fail. Insisting on six would additionally reject a real
 *    Slack timestamp of another width, which is the one input guaranteed to be legitimate: the anchor is
 *    always copied out of Slack's own output.
 *  - **Capped at nine, deliberately, and this is a real limit rather than "any width".** Nanosecond
 *    precision is already three orders finer than anything Slack has been observed to emit, and an
 *    unbounded `\d+` would accept a five-hundred-digit string as a timestamp. A pass objected that a
 *    ten-digit fraction is refused; that is the intended answer, not a defect. {@link isAfter} compares
 *    correctly at ANY width regardless — the cap governs what is ACCEPTED, not what can be compared.
 */
const SLACK_TS = /^\d+\.\d{1,9}$/;

/**
 * Whether a string is a Slack timestamp.
 *
 * Exported so the CLI can refuse a malformed `--since` BEFORE spending a Slack read, which is how every
 * other input to this verb already behaves — and so the rule has one definition rather than a copy in the
 * argument parser that can drift from the one doing the comparing.
 *
 * @param value the candidate timestamp
 * @returns true when it is `<seconds>.<six digits>`
 */
export function isSlackTimestamp({ value }: { value: string }): boolean {
  return SLACK_TS.test(value);
}

/**
 * Split a timestamp into whole seconds and its fractional digits.
 *
 * The fraction stays a STRING and is never truncated. An earlier version clipped it to six digits, which
 * is what every one of 307,747 real Slack timestamps in the owner's corpus actually carries — and an
 * adversarial review pass produced the counterexample anyway: against a clipped comparison,
 * `…398.5570991` is strictly after `…398.557099` and was reported as equal, so the message was silently
 * dropped. Unreachable through Slack today; a silently dropped message is the worst failure class here, and
 * "the provider has always done X" is the assumption this repository keeps paying for.
 *
 * @param ts the Slack timestamp
 * @returns its whole seconds and its fractional digits, both verbatim as digit strings
 */
function timestampParts({ ts }: { ts: string }): { seconds: string; fraction: string } {
  const dot = ts.indexOf(".");
  if (dot < 0) {
    return { fraction: "", seconds: ts };
  }
  return { fraction: ts.slice(dot + 1), seconds: ts.slice(0, dot) };
}

/**
 * Compare two Slack timestamps at arbitrary supported widths.
 *
 * **No number is formed anywhere in this comparison**, and that is the whole design. Both halves are padded
 * to a common width and compared as digit strings: seconds left-padded (leading zeros do not change a
 * value), the fraction right-padded (trailing zeros do not either). Equal-length digit strings order
 * lexicographically exactly as they order numerically, at any width, with no point where a double begins to
 * round.
 *
 * Three separate review counterexamples landed on earlier versions of this function — a clipped fraction,
 * an inconsistent width, and seconds past `Number.MAX_SAFE_INTEGER` — and every one of them was a bound
 * this function had rather than a case it got wrong. It now has none, so there is no width at which it
 * degrades and nothing to re-derive the next time somebody asks.
 *
 * It is deliberately total over a WIDER domain than {@link isSlackTimestamp} accepts: the anchor is input
 * we choose to bound, whereas a message `ts` is whatever Slack sent and must always compare correctly.
 *
 * @param left the timestamp on the left side of the comparison
 * @param right the timestamp on the right side of the comparison
 * @returns -1 when left is earlier, 0 when equal, or 1 when later
 */
export function compareSlackTimestamps({ left, right }: { left: string; right: string }): -1 | 0 | 1 {
  const a = timestampParts({ ts: left });
  const b = timestampParts({ ts: right });
  const secondsWidth = Math.max(a.seconds.length, b.seconds.length);
  const aSeconds = a.seconds.padStart(secondsWidth, "0");
  const bSeconds = b.seconds.padStart(secondsWidth, "0");
  if (aSeconds !== bSeconds) {
    return aSeconds > bSeconds ? 1 : -1;
  }
  const fractionWidth = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(fractionWidth, "0");
  const bFraction = b.fraction.padEnd(fractionWidth, "0");
  if (aFraction === bFraction) {
    return 0;
  }
  return aFraction > bFraction ? 1 : -1;
}

/** Whether one timestamp is strictly after another. */
function isAfter({ ts, anchor }: { ts: string; anchor: string }): boolean {
  return compareSlackTimestamps({ left: ts, right: anchor }) > 0;
}

/**
 * What this read returned, and against what.
 *
 * A discriminated union rather than one shape with optional fields, so a full read cannot carry `--since`
 * vocabulary at all. The rejected design modelled a first read as a diff against an empty baseline, which
 * made every equation balance while announcing that 312 messages had been "added" when nothing had.
 */
export type ThreadSelection =
  | {
      readonly mode: "full";
      /** Messages returned — for a full read, the whole thread. */
      readonly returned: number;
    }
  | {
      readonly mode: "since";
      /** The timestamp the caller supplied. */
      readonly sinceTs: string;
      /** Messages posted after {@link sinceTs}. */
      readonly returned: number;
      /** Messages the caller already had, and which this read deliberately withheld. */
      readonly withheld: number;
      /**
       * Whether `sinceTs` is itself a message in THIS thread.
       *
       * False is not an error — everything newer is still returned — but it is worth saying, because the
       * likeliest cause is a timestamp carried across from a different thread, and the result would
       * otherwise look authoritative.
       */
      readonly anchorInThread: boolean;
    }
  | {
      readonly mode: "around";
      /** The message the permalink addressed and around which replies were selected. */
      readonly anchorTs: string;
      /** Replies requested on each side of the anchor. Zero means parent plus anchor only. */
      readonly around: number;
      /** Full messages returned, including the parent. */
      readonly returned: number;
      /** Older replies omitted before the returned reply window. */
      readonly withheldBefore: number;
      /** Newer replies omitted after the returned reply window. */
      readonly withheldAfter: number;
    };

/** The messages a read returns, paired with the account of what it did not. */
export interface SelectedThread {
  readonly messages: readonly VisibleSlackMessage[];
  readonly selection: ThreadSelection;
}

/**
 * Select the messages this read returns.
 *
 * The whole thread is always fetched and projected before this runs — the filter is applied to a complete
 * thread, never turned into a narrower network request. That is what keeps `completeness` honest: the
 * counts it derives still describe the whole thread, whatever this returns.
 *
 * @param messages the complete projected thread, parent first
 * @param sinceTs the caller's `--since` timestamp; absent means return everything
 * @returns the messages to return and the selection describing them
 */
export function selectMessagesSince({
  messages,
  sinceTs,
}: {
  messages: readonly VisibleSlackMessage[];
  sinceTs?: string | undefined;
}): SelectedThread {
  if (sinceTs === undefined) {
    return { messages, selection: { mode: "full", returned: messages.length } };
  }
  const returned = messages.filter((message) => isAfter({ anchor: sinceTs, ts: message.ts }));
  return {
    messages: returned,
    selection: {
      anchorInThread: messages.some((message) => message.ts === sinceTs),
      mode: "since",
      returned: returned.length,
      sinceTs,
      withheld: messages.length - returned.length,
    },
  };
}

/**
 * Select a bounded reply window while always retaining the thread parent and addressed message.
 *
 * The caller already fetched and projected the complete thread. This function only controls what enters
 * the model context and accounts for every omitted reply on the two sides independently.
 *
 * @param messages the complete projected thread, parent first
 * @param anchorTs the message the permalink addressed
 * @param around replies to retain on each side of the anchor
 * @returns the selected messages and exact residue, or `err` when the claimed anchor/thread is inconsistent
 */
export function selectMessagesAround({
  messages,
  anchorTs,
  around,
}: {
  messages: readonly VisibleSlackMessage[];
  anchorTs: string;
  around: number;
}): Result<SelectedThread, SlackSelectionError> {
  if (!Number.isSafeInteger(around) || around < 0) {
    return err(SlackSelectionErrors.invalidAround({ around }));
  }
  const [parent, ...replies] = messages;
  if (parent?.relation !== "parent") {
    return err(SlackSelectionErrors.noParentMessage());
  }
  if (anchorTs === parent.ts) {
    const returnedReplies = replies.slice(0, around);
    return ok({
      messages: [parent, ...returnedReplies],
      selection: {
        anchorTs,
        around,
        mode: "around",
        returned: returnedReplies.length + 1,
        withheldAfter: replies.length - returnedReplies.length,
        withheldBefore: 0,
      },
    });
  }
  const replyIndex = replies.findIndex((message) => message.ts === anchorTs);
  if (replyIndex < 0) {
    return err(SlackSelectionErrors.anchorNotFound({ anchorTs }));
  }
  const start = Math.max(0, replyIndex - around);
  const end = Math.min(replies.length, replyIndex + around + 1);
  const returnedReplies = replies.slice(start, end);
  return ok({
    messages: [parent, ...returnedReplies],
    selection: {
      anchorTs,
      around,
      mode: "around",
      returned: returnedReplies.length + 1,
      withheldAfter: replies.length - end,
      withheldBefore: start,
    },
  });
}

/**
 * Resolve the mutually exclusive full, since, and around selection modes through one typed entrance.
 *
 * @param messages the complete projected thread
 * @param anchorTs the message the permalink addressed
 * @param around optional reply radius selected by the visible agent
 * @param sinceTs optional prior-read timestamp
 * @returns the selected messages, or a refusal for contradictory controls
 */
export function selectThreadMessages({
  messages,
  anchorTs,
  around,
  sinceTs,
}: {
  messages: readonly VisibleSlackMessage[];
  anchorTs: string;
  around?: number | undefined;
  sinceTs?: string | undefined;
}): Result<SelectedThread, SlackSelectionError> {
  if (around !== undefined && sinceTs !== undefined) {
    return err(SlackSelectionErrors.mutuallyExclusive());
  }
  return around === undefined
    ? ok(selectMessagesSince({ messages, sinceTs }))
    : selectMessagesAround({ anchorTs, around, messages });
}

/**
 * The one-line reading of what this read returned, printed on EVERY read.
 *
 * On every read, including a full one, for the reason `document.ts` already prints its completeness line
 * unconditionally: a line that appears only in the partial case teaches a reader that its absence means
 * "you have everything", when it could equally mean nobody checked.
 *
 * @param selection what this read returned
 * @returns the header line
 */
export function selectionLine({ selection }: { selection: ThreadSelection }): string {
  if (selection.mode === "full") {
    return `returning all ${String(selection.returned)} message(s) — no thread bound was given`;
  }
  if (selection.mode === "around") {
    return (
      `around ${selection.anchorTs}: returning ${String(selection.returned)} full message(s); ` +
      `${String(selection.withheldBefore)} older and ${String(selection.withheldAfter)} newer replies withheld`
    );
  }
  const total = String(selection.returned + selection.withheld);
  if (selection.returned === 0) {
    return `since ${selection.sinceTs}: NO new messages — all ${total} already read and withheld`;
  }
  return (
    `since ${selection.sinceTs}: returning ${String(selection.returned)} of ${total} message(s), ` +
    `${String(selection.withheld)} withheld as already read`
  );
}

/**
 * What a `--since` read cannot see, stated so the reader does not have to infer it.
 *
 * This is the entire price of dropping the snapshot store, and it is why the sentence is generated here
 * rather than left to a caller: a subset a reader cannot distinguish from a whole thread is the exact
 * failure this verb exists to avoid, and the limitation is what makes them distinguishable.
 *
 * @param selection what this read returned
 * @returns one sentence per caveat, or an empty list for a full read, which has no caveat
 */
export function describeSelection({ selection }: { selection: ThreadSelection }): readonly string[] {
  if (selection.mode === "full") {
    return [];
  }
  if (selection.mode === "around") {
    return [
      `this read deliberately withheld ${String(selection.withheldBefore)} older and ` +
        `${String(selection.withheldAfter)} newer replies around ${selection.anchorTs}`,
    ];
  }
  const caveats = [
    `this read returned ONLY messages posted after ${selection.sinceTs}. A message above that timestamp ` +
      "which was edited or deleted since your last read is NOT shown here, and this read cannot detect " +
      "either. Re-read without --since to see the whole thread as it stands now",
  ];
  if (!selection.anchorInThread) {
    caveats.push(
      `--since ${selection.sinceTs} is not a message in this thread; everything newer than it was still ` +
        "returned, but check you did not carry a timestamp over from a different thread",
    );
  }
  return caveats;
}
