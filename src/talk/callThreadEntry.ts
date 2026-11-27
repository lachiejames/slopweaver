/**
 * One entry of a call's thread journal — `$SLOPWEAVER_HOME/talk/threads/<callId>.jsonl` — as the console server
 * hands it over (the WIRE shape, mirrored by `site/lib/talkCallThreadWire.ts`, since `site/` never imports `src/`) and
 * as it is stored once sanitised (`./callThreadSanitise.ts`).
 *
 * The outer envelope is strict and the app-server's own params are kept as JSON whole: the generated Codex
 * `ThreadItem` type is not in this repository, and a local partial union would silently drop the next item variant
 * the app-server adds. What the journal is FOR is an audit of what the call's thinking thread was told, did and
 * read, so a field nobody here has named yet is kept rather than lost.
 */
import { z } from "zod";

import { isCallId } from "./callId.js";

/** The notifications the journal keeps: a turn's frames and every completed item, never a delta or a start. */
const CALL_THREAD_NOTIFICATION_METHODS = ["turn/started", "turn/completed", "item/completed"] as const;

const json = z.json();

/** Any JSON value, as zod reads one. */
export type JsonValue = z.infer<typeof json>;

/** A Codex id the app-server minted: non-empty, and bounded so a hostile one cannot carry a payload. */
const codexId = z.string().min(1).max(200);

const captureSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("thread-start-requested"), params: json, surface: z.enum(["voice", "typed"]) }),
  z.strictObject({ kind: z.literal("thread-started"), threadId: codexId }),
  z.strictObject({ kind: z.literal("notification"), method: z.enum(CALL_THREAD_NOTIFICATION_METHODS), params: json }),
  z.strictObject({
    arguments: z.string(),
    contentItems: z.array(json),
    kind: z.literal("tool-answer"),
    success: z.boolean(),
    threadId: codexId,
    tool: z.string().min(1).max(200),
    toolCallId: codexId,
    turnId: codexId.nullable(),
  }),
]);

const callIdSchema = z.string().refine((callId) => isCallId({ callId }), { message: "not a call id (a v4 UUID)" });

const wireSchema = z.strictObject({
  callId: callIdSchema,
  capture: captureSchema,
  receivedAtIso: z.iso.datetime(),
  version: z.literal(1),
  writeId: z.uuid(),
});

/** One entry as the console hands it over. */
export type CallThreadWireEntry = z.infer<typeof wireSchema>;

/** Why a stored entry's capture was replaced whole by a stand-in rather than kept. */
const CALL_THREAD_WITHHELD_REASONS = ["secret-survived-masking", "unfittable"] as const;

const storedSchema = z.strictObject({
  binaryStandIns: z.number().int().min(0),
  callId: callIdSchema,
  capture: json,
  // The desktop TEST instance's call or typed conversation (`slopweaver desktop e2e`), stamped by the append verb from
  // `--console-instance e2e`, never by the page; absent on the owner's, and on every line written before it existed.
  instance: z.literal("e2e").optional(),
  kind: z.enum(["thread-start-requested", "thread-started", "notification", "tool-answer"]),
  receivedAtIso: z.iso.datetime(),
  redactions: z.array(z.strictObject({ count: z.number().int().min(1), label: z.string().min(1) })),
  truncation: z
    .strictObject({
      originalBytes: z.number().int().min(0),
      truncatedBytes: z.number().int().min(0),
    })
    .nullable(),
  version: z.literal(1),
  withheld: z.strictObject({ labels: z.array(z.string()), reason: z.enum(CALL_THREAD_WITHHELD_REASONS) }).nullable(),
  writeId: z.uuid(),
});

/**
 * One entry as stored: the wire envelope, its capture after binary stand-ins, secret masking and size fitting, and
 * what each of those three did — so a reader always knows the stored capture is not byte-for-byte what crossed.
 */
export type StoredCallThreadEntry = z.infer<typeof storedSchema>;

/**
 * Read one value as a wire entry.
 *
 * @param value one parsed line of a staged batch
 * @returns the entry, or `undefined` when it is not one
 */
export function callThreadWireEntryOf({ value }: { value: unknown }): CallThreadWireEntry | undefined {
  const parsed = wireSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Read one value as a stored entry.
 *
 * @param value one parsed line of a journal file
 * @returns the entry, or `undefined` when it is not one
 */
export function storedCallThreadEntryOf({ value }: { value: unknown }): StoredCallThreadEntry | undefined {
  const parsed = storedSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
