/**
 * The console's attempts to re-open a call that dropped under the owner, as the DROPPED call's own file records them — the
 * `reconnect` line of `./callRecord.ts`, how its steps fold, and how `talk calls` prints one.
 *
 * A reconnect after the 90-minute limit can try and not succeed, and nothing on disk would say why if the chain
 * lived only in the page (`site/lib/callReconnect.ts`). An attempt that never went live opens
 * no file of its own, so every step is written onto the call it was trying to bring back.
 *
 * Pure: no filesystem, no clock.
 */
import { z } from "zod";

/**
 * The most characters a reconnect step's reason may carry. A give-up names both the drop and the last attempt's
 * failure, so it is allowed past a closed line's 600; a reason past even this is cut, never refused.
 */
const RECONNECT_WHY_CHARS = 2_000;

const attemptNumber = z.number().int().positive();
const why = z.string().transform((value) => value.slice(0, RECONNECT_WHY_CHARS));

/** A lowercase v4 UUID — the call an attempt went live as. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * One step of the console reconnecting a call that dropped: an attempt scheduled after a wait, failed for its reason,
 * or went live as a new call. A scheduled attempt with nothing after it is the page going away while it waited, or
 * still waiting for the network. A reconnect repeats until it succeeds and writes no `total`; an
 * older record carries the attempts its chain allowed and may end `gave-up`, and still reads as written.
 */
export const reconnectEventSchema = z
  .discriminatedUnion("kind", [
    z.object({
      attempt: attemptNumber,
      delayMs: z.number().int().nonnegative(),
      kind: z.literal("scheduled"),
      total: attemptNumber.optional(),
    }),
    z.object({ attempt: attemptNumber, kind: z.literal("failed"), total: attemptNumber.optional(), why }),
    z.object({
      attempt: attemptNumber,
      kind: z.literal("live"),
      newCallId: z.string().regex(UUID_V4),
      total: attemptNumber.optional(),
    }),
    z.object({ kind: z.literal("gave-up"), total: attemptNumber, why }),
  ])
  .refine((event) => !("attempt" in event) || event.total === undefined || event.attempt <= event.total, {
    message: "an attempt past the chain's total",
  });

/** One reconnect step, as the dropped call recorded it. */
export interface CallReconnect {
  readonly atIso: string;
  readonly event: z.infer<typeof reconnectEventSchema>;
}

/**
 * Fold one reconnect step in, once: a line written before the page minted write ids and posted twice is the same
 * instant and the same step.
 *
 * @param reconnects the call's reconnect steps so far, updated in place
 * @param entry the step's line
 */
export function foldReconnect({ reconnects, entry }: { reconnects: CallReconnect[]; entry: CallReconnect }): void {
  const step = JSON.stringify(entry.event);
  const seen = reconnects.some((held) => held.atIso === entry.atIso && JSON.stringify(held.event) === step);
  if (!seen) {
    reconnects.push({ atIso: entry.atIso, event: entry.event });
  }
}

/**
 * One reconnect step as the line `talk calls` prints under the dropped call.
 *
 * @param reconnect the step
 * @returns its phrase, e.g. `reconnect 2 failed — <why>`, or `reconnect 2/5 …` for a record that carries a total
 */
export function reconnectPhrase({ reconnect }: { reconnect: CallReconnect }): string {
  const { event } = reconnect;
  const at = reconnect.atIso;
  switch (event.kind) {
    case "scheduled":
      return `${at}  reconnect ${attemptLabel({ event })} in ${String(event.delayMs)}ms`;
    case "failed":
      return `${at}  reconnect ${attemptLabel({ event })} failed — ${event.why}`;
    case "live":
      return `${at}  reconnect ${attemptLabel({ event })} live as call ${event.newCallId}`;
    case "gave-up":
      return `${at}  reconnect gave up — ${event.why}`;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/**
 * An attempt's number, out of its chain's total when the record carries one.
 *
 * @param event the attempt's step
 * @returns `2`, or `2/5` for a record written while a reconnect still gave up
 */
function attemptLabel({ event }: { event: { attempt: number; total?: number | undefined } }): string {
  if (event.total === undefined) {
    return String(event.attempt);
  }
  return `${String(event.attempt)}/${String(event.total)}`;
}
