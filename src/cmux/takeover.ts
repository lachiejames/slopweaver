/**
 * The successor-takeover sequence `slopweaver cmux takeover` runs — pure ordering and refusals, no socket.
 *
 * `docs/cmux-client/verbs-and-events.md` § 3 ("Taking over the pin") already named the five steps a successor supervisor runs
 * to replace a predecessor, and measured that successors were skipping the fifth: `ws:402` stayed open until
 * the owner asked by hand, and a successor did steps 1-4 and had not closed its predecessor minutes
 * later. This module is the cmux-side checks steps (a) and (c) need before anything destructive happens; which
 * predecessor gate (b) resolves, on either host, is `../supervisor/takeoverSeat.ts`'s. The CLI verb
 * (`../cli/commands/cmux/takeover.ts`) owns the socket calls, the live event drain that feeds gate (a)'s first
 * witness and the transcript read behind its second.
 *
 * ## Why gate (a) checks a tool call, not elapsed time
 *
 * `skills/supervisor/SKILL.md` § 7 arms `ScheduleWakeup` on the successor's very FIRST turn, and every real
 * takeover on record (a chair's doc → `ws:459`) ran steps 2-5 in that SAME
 * turn, minutes before the wakeup's own 1200s interval could have elapsed. So "the sweep wakeup fired" cannot
 * mean "a re-entry has already happened" — that would refuse every real takeover on record for twenty minutes.
 * What IS true and checkable at that moment is that the `ScheduleWakeup` tool itself was called, and gate (a)
 * accepts either of TWO witnesses of it — never the caller's own say-so:
 *
 * 1. **The hook event.** cmux emits an `agent.hook.PreToolUse` naming the tool when Claude Code runs the
 *    PreToolUse hook for it. This is the stronger witness: the runtime received the call. It is read first and
 *    passes on its own.
 * 2. **The transcript.** Claude Code persists every assistant turn to `~/.claude/projects/<dir>/<session>.jsonl`,
 *    and a turn that armed the sweep carries a `tool_use` block named `ScheduleWakeup`. This is the weaker
 *    witness — it proves the assistant EMITTED the call, not that the runtime accepted it — and it exists
 *    because the first one does not on every Claude Code: MEASURED: Claude Code 2.1.296 ran no
 *    PreToolUse hook for `ScheduleWakeup` at all (two arms, zero
 *    events), while 2.1.295 did (two events). Without it, no successor chair on 2.1.296
 *    could ever take the pin.
 *
 * The transcript leg is read only when the hook leg did not witness, it is bounded to THIS session's own file
 * (`CLAUDE_CODE_SESSION_ID` under the `HOME` that locates `~/.claude/projects` — the same ambient boundary
 * gate (a2) records owner-turn receipts against; a process whose environment was deliberately rewritten to
 * name another session's file, or another projects root, is outside it, as it is for every transcript read in
 * this repository), and it counts only a non-sidechain assistant record
 * at or after the session's own first timestamp. A line the decoder could not read is not a record, so it can
 * never witness (a live transcript's torn last line is routine); only a read the stream itself reports a
 * problem on makes a negative `incomplete`. The two legs' dispositions are folded by
 * {@link sweepGateOutcome}, whose input type refuses a non-witnessing hook leg with no transcript leg beside it,
 * so the step line and the refusal always say WHICH witness decided.
 *
 * ## Why gate (c) reads a run journal, not a screen or a chat message
 *
 * A predecessor supervisor is itself booted from a one-time `fresh-supervisor-handoff-N` handover doc
 * (`cmux spawn <that-slug>`), and "stepping down" IS that doc's own run reaching `finished` —
 * a supervisor-state note records "STEPPED DOWN: ... wakeup stopped; run finished." So the
 * mechanical anchor for "the predecessor stepped down" is the same run journal every other handover gate
 * already reads, keyed by the slug the session ledger recorded when that predecessor was spawned. A
 * predecessor with no such slug (started by hand, not via `cmux spawn`) cannot be confirmed this way at all,
 * and this refuses rather than guessing.
 */
import type { RunPhase } from "../handover/ledger.js";
import type { TranscriptRecord } from "../transcripts/record.js";
import type { CmuxEvent } from "./events.js";

/** The tool `skills/supervisor/SKILL.md` § 7 arms on a supervisor's first turn, and re-arms every tick. */
export const SWEEP_ARM_TOOL_NAME = "ScheduleWakeup";

/**
 * Whether one of `events` is this workspace arming the sweep — a `PreToolUse` naming {@link SWEEP_ARM_TOOL_NAME}.
 *
 * Only the `received` phase counts, matching every other fold in this repo (`sessionActivity.ts`): cmux emits
 * both `received` and `completed` for the same firing, and counting both would not change this predicate's
 * answer but would invite a future caller to mistake one call for two.
 *
 * @param events this workspace's own hook events, in any order
 * @param workspaceId the workspace being checked
 * @returns true the moment one qualifying event is found
 */
export function sweepArmedInEvents({
  events,
  workspaceId,
}: {
  events: readonly CmuxEvent[];
  workspaceId: string;
}): boolean {
  return events.some(
    (event) =>
      event.workspaceId === workspaceId &&
      event.name === "agent.hook.PreToolUse" &&
      event.phase !== "completed" &&
      event.toolName === SWEEP_ARM_TOOL_NAME,
  );
}

/** The refusal's standing half, before the two legs' dispositions are appended. */
const NOT_ARMED_REFUSAL =
  `neither this session's own hook events nor its transcript show a ${SWEEP_ARM_TOOL_NAME} call yet — arm the ` +
  "§ 7 sweep before taking over the pin, so a predecessor that might still be the only one actually watching " +
  "the fleet is never displaced";

/**
 * The transcript witness: the line of the first non-sidechain assistant record that called
 * {@link SWEEP_ARM_TOOL_NAME} at or after the session's own start, or `undefined` when none did.
 *
 * The start is the first decoded record whose timestamp parses; a record with no parseable timestamp never
 * counts, as a candidate or as the floor (the decoder defaults an absent timestamp to "", and
 * `Date.parse("")` is `NaN`). Instants are compared, never timestamp strings. Stops at the first match, so a
 * lazy stream over a tens-of-megabytes chair transcript is read only as far as it must be; a complete negative
 * consumes the whole iterable, which is what "no witness" costs.
 *
 * @param records this session's own decoded records, in file order — an array in a test, a generator in the verb
 * @returns the witnessing line, or undefined
 */
export function sweepArmedInTranscript({
  records,
}: {
  records: Iterable<TranscriptRecord>;
}): { readonly lineNumber: number } | undefined {
  // NaN until the first parseable record sets the floor; `??=` is the lint's preferred spelling of an
  // `undefined` check, and `??` is forbidden repo-wide (no-silent-fallback), so the sentinel is a number.
  let floorMs = Number.NaN;
  for (const record of records) {
    const atMs = Date.parse(record.timestamp);
    if (!Number.isFinite(atMs)) {
      continue;
    }
    if (Number.isNaN(floorMs)) {
      floorMs = atMs;
    }
    if (record.role !== "assistant" || record.isSidechain || atMs < floorMs) {
      continue;
    }
    if (record.toolUses.some((use) => use.name === SWEEP_ARM_TOOL_NAME)) {
      return { lineNumber: record.lineNumber };
    }
  }
  return undefined;
}

/**
 * The cursor gate (a)'s drain starts from: just before the oldest frame cmux still retains, read off a live-edge
 * ack a moment earlier — never `seq 0`.
 *
 * `seq 0` aged out of cmux's 4,096-frame buffer on every busy machine, so a drain from it acked `gap: true`
 * every time and every negative read as inconclusive, forever (MEASURED: `slopweaver cmux events
 * --since 0` printed the gap line, oldest retained 1131782). Starting inside the window asks for exactly what
 * cmux holds. An ack with no usable `oldest_seq` is a malformed reply, never a silent `0`.
 *
 * @param oldestSeq the live-edge ack's `resume.oldest_seq`
 * @returns the cursor, or the reason there is none
 */
export function retainedWindowCursor({
  oldestSeq,
}: {
  oldestSeq: number | undefined;
}): { readonly afterSeq: number } | { readonly unusable: string } {
  if (oldestSeq === undefined || !Number.isSafeInteger(oldestSeq) || oldestSeq < 1) {
    return { unusable: `cmux's ack carried no usable oldest_seq (${String(oldestSeq)})` };
  }
  return { afterSeq: oldestSeq - 1 };
}

/** What the hook-event leg of gate (a) found. */
export type HookLeg =
  | { readonly kind: "witnessed" }
  /**
   * No event named the tool anywhere in cmux's retained window. That is a negative over the WINDOW, not over the
   * session: a session older than `windowStartIso` may have armed before it. The transcript leg is what covers
   * the rest — cmux strips Claude Code's `SessionStart.source`, and the same session id boots again on every
   * resume and compaction, so no hook frame can say where this session began (MEASURED,
   * `~/.cmuxterm/events.jsonl`: one active session booted again, payload with no
   * `source` key).
   */
  | {
      readonly kind: "window-no";
      /** The oldest frame cmux still held when the drain's own ack arrived. */
      readonly oldestSeq: number;
      /** When the earliest frame the drain replayed occurred, or undefined when it replayed none. */
      readonly windowStartIso: string | undefined;
    }
  /** The drain itself failed, or cmux's ack could not place it. */
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * The hook leg a finished drain amounts to: a match is a witness whatever else the buffer lost; anything else
 * is a negative over the window the drain actually saw, named by its oldest seq and earliest replayed instant.
 *
 * @param matched whether a frame satisfied the arm predicate
 * @param oldestSeq the drain's own ack's `resume.oldest_seq`
 * @param windowStartIso the earliest replayed frame's `occurred_at`, when one was replayed
 * @returns the leg's disposition
 */
export function hookLegOfDrain({
  matched,
  oldestSeq,
  windowStartIso,
}: {
  matched: boolean;
  oldestSeq: number | undefined;
  windowStartIso: string | undefined;
}): HookLeg {
  if (matched) {
    return { kind: "witnessed" };
  }
  const usable = retainedWindowCursor({ oldestSeq });
  if ("unusable" in usable) {
    return { kind: "unreadable", why: `${usable.unusable} on the drain, so the window it searched is unknown` };
  }
  return { kind: "window-no", oldestSeq: usable.afterSeq + 1, windowStartIso };
}

/** What the transcript leg of gate (a) found. */
export type TranscriptLeg =
  | { readonly kind: "witnessed"; readonly lineNumber: number }
  /** The whole transcript was read and no qualifying record was in it. */
  | { readonly kind: "no-tool-use" }
  /** No qualifying record, and the read reported problems — so the negative is not established. */
  | { readonly kind: "incomplete"; readonly problems: readonly string[] }
  /** The transcript could not be read at all: no session id, not found, ambiguous, or unreadable. */
  | { readonly kind: "unread"; readonly why: string };

/** One leg's disposition, as the step line and the refusal print it. */
function describeHookLeg({ leg }: { leg: HookLeg }): string {
  switch (leg.kind) {
    case "witnessed":
      return `${SWEEP_ARM_TOOL_NAME} PreToolUse event`;
    case "window-no": {
      const since = leg.windowStartIso === undefined ? "" : `, earliest replayed ${leg.windowStartIso}`;
      return `no ${SWEEP_ARM_TOOL_NAME} event in cmux's retained window (oldest seq ${String(leg.oldestSeq)}${since})`;
    }
    case "unreadable":
      return `unreadable: ${leg.why}`;
  }
}

/**
 * The transcript leg's disposition, as the step line and the refusal print it — for a cmux caller and an app caller.
 *
 * @param leg what the transcript leg found
 * @returns the disposition in words
 */
export function describeTranscriptLeg({ leg }: { leg: TranscriptLeg }): string {
  switch (leg.kind) {
    case "witnessed":
      return `${SWEEP_ARM_TOOL_NAME} tool_use at line ${String(leg.lineNumber)}`;
    case "no-tool-use":
      return `no ${SWEEP_ARM_TOOL_NAME} tool_use, fully read`;
    case "incomplete":
      return `no ${SWEEP_ARM_TOOL_NAME} tool_use, read incomplete: ${leg.problems.join("; ")}`;
    case "unread":
      return `not read: ${leg.why}`;
  }
}

/** Gate (a)'s verdict over both legs — the witness that decided it, or the refusal naming both dispositions. */
export type SweepGateOutcome =
  { readonly armed: true; readonly witness: string } | { readonly armed: false; readonly refusal: string };

/**
 * The two legs as the verb hands them over: a witnessing hook leg may come alone (the transcript was never
 * opened), and every other hook disposition — clean no, gap, drain failure — MUST carry what the transcript leg
 * found. The type is what stops a verb from refusing on half the evidence.
 */
export type SweepGateEvidence =
  | { readonly hook: Extract<HookLeg, { readonly kind: "witnessed" }>; readonly transcript?: TranscriptLeg }
  | { readonly hook: Exclude<HookLeg, { readonly kind: "witnessed" }>; readonly transcript: TranscriptLeg };

/**
 * Fold the two legs into gate (a)'s verdict.
 *
 * The hook event passes first and alone, whatever the transcript says — it is the stronger witness and the
 * one the gate always had — and its line says the transcript was not read. Otherwise a transcript witness
 * passes, with the hook leg's disposition beside it so a reader sees why the weaker witness decided. Neither
 * witnessing refuses, naming both, so the operator can tell "never armed" from "armed on a Claude Code whose
 * hook never fired and whose transcript could not be read". Every line names both legs.
 *
 * @param evidence both legs as the verb hands them over, the transcript leg absent only beside a witnessing hook leg
 * @returns the verdict
 */
export function sweepGateOutcome({ evidence }: { evidence: SweepGateEvidence }): SweepGateOutcome {
  const { hook, transcript } = evidence;
  const hookText = describeHookLeg({ leg: hook });
  const transcriptText =
    transcript === undefined ? "not read, the hook event decided" : describeTranscriptLeg({ leg: transcript });
  if (hook.kind === "witnessed") {
    return { armed: true, witness: `${hookText}; transcript: ${transcriptText}` };
  }
  if (transcript?.kind === "witnessed") {
    return { armed: true, witness: `${transcriptText}; hook events: ${hookText}` };
  }
  return { armed: false, refusal: `${NOT_ARMED_REFUSAL} — hook events: ${hookText}; transcript: ${transcriptText}` };
}

/**
 * The phase gate (c)'s refusal names. A slug with no run journal was never opened as a run, so it has no
 * phase to name, and the refusal says there is no run.
 */
function predecessorPhaseLabel({ runPhase }: { runPhase: RunPhase | undefined }): string {
  if (runPhase === undefined) {
    return "no run";
  }
  return runPhase;
}

/**
 * The refusal for gate (c), or `undefined` to proceed — the predecessor's own run must have reached
 * a terminal phase before this session closes it out from under it: `finished`/`abandoned`, a row `closed`, or
 * `orphaned` — the reaper's typed closure once the live-session registry proved the chair's session dead, which
 * after a restart is exactly the chair that can no longer step down itself.
 *
 * @param predecessorRef the predecessor's workspace ref, for the message
 * @param slug the handover slug the session ledger recorded for the predecessor, or `undefined` when it was
 * never spawned via `cmux spawn` (or the ledger has lost track of it)
 * @param runPhase the predecessor's run phase (`runStateOf` over its run journal), or `undefined` when it has
 * no run journal at all
 * @returns the refusal reason, or undefined
 */
export function predecessorRunNotFinishedRefusal({
  predecessorRef,
  slug,
  runPhase,
}: {
  predecessorRef: string;
  slug: string | undefined;
  runPhase: RunPhase | undefined;
}): string | undefined {
  if (slug === undefined) {
    return (
      `${predecessorRef} is not registered against a handover slug in the session ledger (no open row pairs to it ` +
      "by ref and worktree, nor by worktree alone), so its run cannot be " +
      "confirmed finished — confirm by hand (or record it: `slopweaver session record`) before closing it"
    );
  }
  if (runPhase !== "closed") {
    return (
      `${predecessorRef}'s run "${slug}" has not reached a terminal phase — finished, abandoned, closed or orphaned (phase: ${predecessorPhaseLabel({ runPhase })}) — ` +
      "refusing to close a session whose own run is still open"
    );
  }
  return undefined;
}
