/**
 * The call leg's evidence off disk, parsed: the desktop shell's event log, the serving console's plan-call lines, and
 * which call leases are live. Pure; `src/cli/commands/desktop/e2eCallEvidenceRead.ts` reads the bytes.
 *
 * **Never a silent skip.** A complete line that is not one its writer writes fails the parse, because a judge that
 * skipped it might be skipping the one line that proves the call ended. A line with no newline yet is not settled —
 * the writer may be mid-append — so it is left for the next read, never judged and never called malformed.
 *
 * The desktop log's shape is `desktop/src/overlayRecovery.ts`'s `DesktopEventEntry` and the plan line's is
 * `site/lib/talkPlanLog.ts`'s `planCallLogLine`; `src/` imports neither tree, so both are restated here. Keep them
 * in step.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallEvidenceError, E2eCallEvidenceErrors } from "./e2eCallErrors.js";

/** The call the voice's page last reported to the shell (`desktop/src/desktopBridge.ts`'s `OverlayCall`). */
const overlayCallSchema = z.strictObject({ planCallId: z.string().nullable(), transcriptCallId: z.string() });

/** One line of `~/Library/Logs/Slopweaver/desktop-events.jsonl`. */
const desktopEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    atIso: z.string(),
    call: overlayCallSchema.nullable(),
    exitCode: z.number(),
    kind: z.literal("renderer-gone"),
    reason: z.string(),
    reconnect: z.boolean().nullable(),
    window: z.literal("overlay"),
  }),
  z.strictObject({
    ageMs: z.number(),
    atIso: z.string(),
    kind: z.literal("recovery-taken"),
    transcriptCallId: z.string(),
  }),
  // The owner's own app writes these to the same file while a scenario runs (`desktop/src/consoleRestartHold.ts`).
  z.strictObject({
    atIso: z.string(),
    downMs: z.number(),
    kind: z.literal("console-outage"),
    outcome: z.enum(["held", "back", "raised"]),
    problem: z.string().nullable(),
  }),
  // A call ended for an update, and each change in what the shell decided about restarting it (`updatePlan.ts`).
  z.strictObject({
    atIso: z.string(),
    decision: z.enum([
      "handed",
      "expired",
      "call-live",
      "retry-hanging-up",
      "retry-overlay-not-listening",
      "retry-send-failed",
    ]),
    instance: z.enum(["own", "e2e"]),
    kind: z.literal("update-resume"),
    sinceIso: z.string(),
  }),
]);

/** One entry of the desktop shell's event log. */
export type E2eDesktopEvent = z.infer<typeof desktopEventSchema>;

/** One plan call opened or ended, as the serving console logged it. */
export interface E2ePlanCallLogEvent {
  readonly kind: "opened" | "ended";
  readonly callId: string;
  readonly atIso: string;
  /** Its place among the plan lines read, so an end and an open can be ordered. */
  readonly lineIndex: number;
  /** An end's reason, or an open's handshake outcome. */
  readonly reason: string;
}

/** The marker every plan-call line carries, among everything else the console's server prints. */
const PLAN_MARKER = " talk plan call ";

/** `<iso> talk plan call <id> opened: <outcome>` or `<iso> talk plan call <id> ended after <n>s: <reason>`. */
const PLAN_LINE = /^(\S+) talk plan call (\S+) (?:opened: (.*)|ended after \d+s: (.*))$/u;

/**
 * Split a read into its complete lines and the unterminated tail a writer may still be appending.
 *
 * @param text what was read
 * @returns the complete lines, in order, and the tail
 */
export function settledLines({ text }: { text: string }): { readonly lines: readonly string[]; readonly tail: string } {
  const cut = text.lastIndexOf("\n");
  if (cut === -1) {
    return { lines: [], tail: text };
  }
  return { lines: text.slice(0, cut).split("\n"), tail: text.slice(cut + 1) };
}

/**
 * Parse the desktop shell's event log, complete lines only. A blank line is no entry; anything else must be one.
 *
 * @param text the bytes appended since the scenario began
 * @returns every entry, or the first line that is not one
 */
export function parseDesktopEventLog({
  text,
}: {
  text: string;
}): Result<readonly E2eDesktopEvent[], E2eCallEvidenceError> {
  const entries: E2eDesktopEvent[] = [];
  for (const [lineIndex, line] of settledLines({ text }).lines.entries()) {
    if (line.trim() === "") {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return err(E2eCallEvidenceErrors.malformedLine({ line, lineIndex, log: "desktop-events.jsonl" }));
    }
    const parsed = desktopEventSchema.safeParse(value);
    if (!parsed.success) {
      return err(E2eCallEvidenceErrors.malformedLine({ line, lineIndex, log: "desktop-events.jsonl" }));
    }
    entries.push(parsed.data);
  }
  return ok(entries);
}

/**
 * Parse the plan-call lines out of the console server's log, complete lines only. Every other line the server prints
 * is not this parser's; a line carrying the plan marker that is not a plan line fails.
 *
 * @param text the bytes appended since the scenario began
 * @returns every plan-call event, numbered in order, or the first marked line that is not one
 */
export function parsePlanCallLog({
  text,
}: {
  text: string;
}): Result<readonly E2ePlanCallLogEvent[], E2eCallEvidenceError> {
  const events: E2ePlanCallLogEvent[] = [];
  for (const [lineIndex, line] of settledLines({ text }).lines.entries()) {
    if (!line.includes(PLAN_MARKER)) {
      continue;
    }
    const match = PLAN_LINE.exec(line);
    if (match === null) {
      return err(E2eCallEvidenceErrors.malformedLine({ line, lineIndex, log: "the console log" }));
    }
    const [, atIso, callId, opened, ended] = match;
    if (opened !== undefined) {
      events.push({ atIso: atIso!, callId: callId!, kind: "opened", lineIndex: events.length, reason: opened });
    } else {
      events.push({ atIso: atIso!, callId: callId!, kind: "ended", lineIndex: events.length, reason: ended! });
    }
  }
  return ok(events);
}

/** One lease's fields the leg reads. */
const leaseSchema = z.object({ callId: z.string(), untilMs: z.number() });

/**
 * The ids of the leases live now. A lease that does not parse holds nothing, exactly as `./buildStamp.ts`'s
 * `liveCallLeases` counts it, so the two never disagree about whether a call is up.
 *
 * @param leases each lease file's text
 * @param nowMs the clock to judge them by
 * @returns the live leases' ids, sorted
 */
export function liveLeaseIdsOf({ leases, nowMs }: { leases: readonly string[]; nowMs: number }): readonly string[] {
  const live: string[] = [];
  for (const text of leases) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      continue;
    }
    const parsed = leaseSchema.safeParse(value);
    if (parsed.success && parsed.data.untilMs > nowMs) {
      live.push(parsed.data.callId);
    }
  }
  return live.toSorted();
}

/**
 * How many lease files do not parse as a lease. {@link liveLeaseIdsOf} counts one as no call; the on-call hold cannot,
 * since a lease it cannot read may be the owner's call.
 *
 * @param leases each lease file's text
 * @returns the count of those that are not a lease
 */
export function malformedLeaseCount({ leases }: { leases: readonly string[] }): number {
  return leases.filter((text) => {
    try {
      return !leaseSchema.safeParse(JSON.parse(text)).success;
    } catch {
      return true;
    }
  }).length;
}

/**
 * The plan calls that opened, in log order.
 *
 * @param events the plan-call events read
 * @returns each opened call's id
 */
export function openedPlanCalls({ events }: { events: readonly E2ePlanCallLogEvent[] }): readonly string[] {
  return events.filter((event) => event.kind === "opened").map((event) => event.callId);
}

/**
 * Whether every named plan call has an end line.
 *
 * @param events the plan-call events read
 * @param callIds the calls that must have ended
 * @returns the ids still without one
 */
export function unendedPlanCalls({
  events,
  callIds,
}: {
  events: readonly E2ePlanCallLogEvent[];
  callIds: readonly string[];
}): readonly string[] {
  const ended = new Set(events.filter((event) => event.kind === "ended").map((event) => event.callId));
  return callIds.filter((id) => !ended.has(id));
}
