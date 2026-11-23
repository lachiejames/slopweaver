/**
 * One tool line of a call file (`./callRecord.ts`): what the voice's tool was, how it came out, the link a read opened,
 * and what the model was handed, every secret in it masked on the way in
 * (`./callSanitise.ts`), so a wrong spoken answer can be traced to what it read. What a line may say and how a file's
 * tool lines fold into the call's notes. Pure.
 */
import { z } from "zod";
import { isCallId } from "./callId.js";

/** The most characters a tool or relay line's detail may carry. */
export const CALL_DETAIL_CHARS = 600;

/**
 * The longest link a tool line may carry. A longer one reads as `null` — a link was opened, too long to carry — never
 * cut, since a cut link opens nothing, and never dropped, which would let an older link pass for the newest.
 */
const CALL_OPENED_CHARS = 2000;

/**
 * The most UTF-8 bytes of one tool's answer a tool line keeps — the console page's own tool cap
 * (`site/components/live/talkSession.ts`'s `TOOL_OUTPUT_MAX`, which `src/` cannot import), so every answer the model
 * was handed fits. One past it is never cut: a cut answer is not what the model read, so the field is dropped instead.
 */
export const CALL_TOOL_ANSWER_MAX_BYTES = 24 * 1024;

/**
 * A reopened call's opening-window step as the call file keeps it (`site/lib/talkPlanReopenReminder.ts`): which step,
 * the milliseconds since the window armed on the call's own elapsed clock, the window it was judged against, and the
 * call it recaps. One object so it is wholly usable or wholly absent; never the page's `ms`, which is tool latency.
 */
const reopenReminderShape = z.object({
  elapsedSinceArmedMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  phase: z.enum(["armed", "handed", "gave-way", "failed"]),
  previousCallId: z.string().refine((callId) => isCallId({ callId })),
  windowMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

/** A reopened call's opening-window step, as a tool line carries it. */
export type ReopenReminderMeasurement = z.output<typeof reopenReminderShape>;

/** A `tool` line's own fields; `callRecord.ts` adds the instant and write id every line carries. */
export const CALL_TOOL_FIELDS = {
  // What the model was handed, secrets masked. Absent on a call file written before the field existed; a non-string or one
  // past the cap — the masks' markers included — drops the field, never the line.
  answer: z
    .string()
    .refine((value) => Buffer.byteLength(value, "utf8") <= CALL_TOOL_ANSWER_MAX_BYTES)
    .optional()
    .catch(undefined),
  detail: z.string().transform((value) => value.slice(0, CALL_DETAIL_CHARS)),
  kind: z.literal("tool"),
  name: z.string().transform((value) => value.slice(0, 200)),
  // The link a read tool was called with (`site/lib/talkTools.ts`'s `openedLinkOf`), so the next call can open it
  // again: a rollover once lost the thread the owner had pasted. One that fails the shape reads as `null` like an
  // over-long one, never the line dropped, and never absent, which would let an older link pass for it.
  opened: z
    .string()
    .min(1)
    .transform((link) => (link.length > CALL_OPENED_CHARS ? null : link))
    .optional()
    .catch(null),
  refused: z.boolean(),
  // A reopened call's opening-window step, so its three seconds are read off the file as numbers, never
  // parsed out of `detail`. Absent on every other tool and before; one that fails the shape drops the field, never the
  // line.
  reopenReminder: reopenReminderShape.optional().catch(undefined),
  // The thinking-model turn that called it, so `talk fidelity` reads a message against what its own turn
  // read. Absent before, and on a tool no turn called; one that fails the shape drops the field, never the line.
  turnId: z.string().min(1).max(200).optional().catch(undefined),
};

/** The shape of one tool line, for its type. */
const toolLine = z.object(CALL_TOOL_FIELDS).extend({ atIso: z.string() });

/** A `tool` line, parsed. */
type ToolEntry = z.output<typeof toolLine>;

/** A tool line as the call recorded it. */
export interface CallToolNote {
  readonly kind: "tool";
  readonly atIso: string;
  readonly name: string;
  readonly detail: string;
  readonly refused: boolean;
  /**
   * The link a read tool was called with; `null` when it was too long to carry; `undefined` when it took none, or the
   * call predates the field.
   */
  readonly opened: string | null | undefined;
  /** What the model was handed, secrets masked; `undefined` when none was kept, or the call predates the field. */
  readonly answer: string | undefined;
  /** The thinking-model turn that called it; `undefined` when none did, or the call predates the field. */
  readonly turnId?: string | undefined;
  /** A reopened call's opening-window step; absent on every other tool, and on a call written before the field existed. */
  readonly reopenReminder?: ReopenReminderMeasurement;
}

/**
 * Whether two lines carry the same opening-window step: both none, or every value equal.
 *
 * @returns whether they are the same
 */
function sameReopenReminder({
  held,
  next,
}: {
  held: ReopenReminderMeasurement | undefined;
  next: ReopenReminderMeasurement | undefined;
}): boolean {
  if (held === undefined || next === undefined) {
    return held === next;
  }
  return (
    held.phase === next.phase &&
    held.elapsedSinceArmedMs === next.elapsedSinceArmedMs &&
    held.windowMs === next.windowMs &&
    held.previousCallId === next.previousCallId
  );
}

/**
 * Fold one tool line in, once: a batch the page tried again after the route had already appended it writes the same
 * line twice, and the same instant, name, detail, opened link and answer is that one line — two reads of different
 * links, or two reads that came back with different answers, are two: dropping one would destroy the very evidence an
 * answer is kept for. The one line sits where its LATER copy does, so file order still tells which of two reads in one
 * millisecond was the newer.
 *
 * @param notes the call's tool lines and relays so far, updated in place
 * @param entry the tool line, already parsed
 */
export function foldTool({
  notes,
  entry,
}: {
  notes: (CallToolNote | { readonly kind: "relay" })[];
  entry: ToolEntry;
}): void {
  const seen = notes.findIndex(
    (note) =>
      note.kind === "tool" &&
      note.atIso === entry.atIso &&
      note.name === entry.name &&
      note.detail === entry.detail &&
      note.opened === entry.opened &&
      note.answer === entry.answer &&
      note.turnId === entry.turnId &&
      sameReopenReminder({ held: note.reopenReminder, next: entry.reopenReminder }),
  );
  if (seen !== -1) {
    notes.splice(seen, 1);
  }
  // Only the opening window's own line carries its measurement; on any other tool the field is dropped.
  const measured = entry.reopenReminder;
  let reminder: { reopenReminder?: ReopenReminderMeasurement } = {};
  if (measured !== undefined && entry.name === "reopen-reminder") {
    reminder = { reopenReminder: measured };
  }
  notes.push({
    ...reminder,
    answer: entry.answer,
    atIso: entry.atIso,
    detail: entry.detail,
    kind: "tool",
    name: entry.name,
    opened: entry.opened,
    refused: entry.refused,
    turnId: entry.turnId,
  });
}
