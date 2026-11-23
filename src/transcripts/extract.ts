/**
 * The human turns of a transcript, and the far larger machine traffic wearing the `user` role.
 *
 * ## Why this is the whole point of the phase
 *
 * A transcript's `user` records are overwhelmingly NOT a person. Measured over one project directory's 156
 * transcripts — reproduce with `slopweaver transcripts summary --session <id>` — 27,221 of the 29,946 `user`
 * lines were tool results, and of the remainder the largest single bucket was task notifications the harness
 * wrote to itself. What is left after all of it is stripped is the handful of turns that actually STEERED
 * the session, and that is the only record of the human half that exists anywhere.
 *
 * ## Structural markers first, text second — because neither alone is enough
 *
 * Claude Code marks most injected traffic structurally (`promptSource`, `origin.kind`, `isMeta`,
 * `isCompactSummary`), and where it does, that is what is read. But the markers do not cover everything:
 * measured on the same directory, all 297 `[Request interrupted …]` records carried `promptSource: null`,
 * `origin: null` and `isMeta: false` — structurally indistinguishable from a person typing. So the wrapper
 * TEXT is read too, and a turn is machine if either signal says so.
 *
 * The residual direction is deliberate: an unrecognised record with real text is reported as HUMAN with an
 * `unknown` source rather than dropped. A false human turn is visible in the output and can be argued with;
 * a dropped one is invisible, and this corpus is the only place it exists.
 *
 * ## A `<system-reminder>` is stripped, not classified
 *
 * The reminders ride ALONG WITH a person's words on the same record, so treating their presence as a machine
 * signal would delete real turns. They are cut out of the text instead, and only a record whose whole
 * content was reminder is called machine.
 *
 * Pure: records in, turns out. No I/O, no clock.
 */

import { absentAsNumber } from "#lib/absent.js";
import { isBootRefusalWake } from "./bootRefusalWake.js";
import { isFleetNudge } from "./fleetNudge.js";
import type { TranscriptRecord } from "./record.js";
import { isSpawnPickupLine } from "./spawnPickupLine.js";

/** Why a `user` record is not a person speaking. One value per stripped wrapper kind. */
export type MachineTurnKind =
  | "assistant"
  | "tool-result"
  | "system-reminder"
  | "slash-command"
  | "bash-io"
  | "hook-feedback"
  | "task-notification"
  | "cross-session-message"
  | "compaction-summary"
  | "interrupt-marker"
  | "attachment-only"
  | "injected-prompt"
  | "fleet-nudge"
  | "boot-refusal-wake"
  | "spawn-pickup"
  | "empty";

/** How a human turn reached the session, as the record's own `promptSource` reports it. */
export type HumanTurnSource = "typed" | "queued" | "suggestion-accepted" | "unknown";

/** One turn a person actually took. */
export interface HumanTurn {
  /** The record's uuid, so a caller can find the exact line again. */
  readonly uuid: string;
  /** The ISO instant the turn was recorded, or "" when the line carried none. */
  readonly timestamp: string;
  /** The person's words, with every reminder and wrapper span cut out. */
  readonly text: string;
  /** The 1-based line the turn was read from, so a caller can go straight to it. */
  readonly lineNumber: number;
  /** How it arrived — typed, queued behind a running turn, or an accepted suggestion. */
  readonly source: HumanTurnSource;
  /** The working directory the session was in, so turns can be grouped by project. */
  readonly cwd: string;
  /** Present when an unclosed wrapper took the rest of the text, so {@link text} is short of what the record holds. */
  readonly tailCut?: true;
  /** Present when a wrapper span was cut from between the person's words, so {@link text} joins what the record kept apart. */
  readonly spliced?: true;
}

/**
 * A record read either as a person's turn or as machine traffic. Both arms are ordinary, neither is a failure.
 *
 * @internal
 */
export type TurnReading =
  | { readonly kind: "human"; readonly turn: HumanTurn }
  | { readonly kind: "machine"; readonly machine: MachineTurnKind };

/** Wrapper spans cut out of a turn's text before it is judged, paired with the kind each one implies. */
const WRAPPER_SPANS: readonly { readonly tag: string; readonly kind: MachineTurnKind }[] = [
  { kind: "system-reminder", tag: "system-reminder" },
  { kind: "slash-command", tag: "command-name" },
  { kind: "slash-command", tag: "command-message" },
  { kind: "slash-command", tag: "command-args" },
  { kind: "slash-command", tag: "local-command-stdout" },
  { kind: "slash-command", tag: "local-command-stderr" },
  { kind: "bash-io", tag: "bash-input" },
  { kind: "bash-io", tag: "bash-stdout" },
  { kind: "bash-io", tag: "bash-stderr" },
  { kind: "hook-feedback", tag: "user-prompt-submit-hook" },
];

/**
 * Text openings that mark a record as machine even when nothing structural does.
 *
 * Every entry here was measured on the real corpus rather than imagined; the interrupt marker is the one
 * that forces this list to exist at all, because it carries no structural marker of any kind.
 */
const MACHINE_OPENINGS: readonly { readonly opening: string; readonly kind: MachineTurnKind }[] = [
  { kind: "interrupt-marker", opening: "[Request interrupted" },
  { kind: "task-notification", opening: "<task-notification" },
  { kind: "cross-session-message", opening: "Another Claude session sent a message" },
  { kind: "cross-session-message", opening: "<cross-session-message" },
  { kind: "compaction-summary", opening: "This session is being continued" },
  { kind: "hook-feedback", opening: "Stop hook feedback:" },
  { kind: "attachment-only", opening: "[Image: source:" },
  {
    kind: "slash-command",
    opening: "Caveat: The messages below were generated by the user while running local commands",
  },
];

/** `promptSource` values that name a person, mapped to this module's own vocabulary. */
const HUMAN_SOURCES: Readonly<Record<string, HumanTurnSource>> = {
  queued: "queued",
  suggestion_accepted: "suggestion-accepted",
  typed: "typed",
};

/** What cutting the wrapper spans out of a turn left behind. */
interface StrippedText {
  /** The text with every wrapper span removed, trimmed. */
  readonly residue: string;
  /** The kind of the LAST span removed, or `undefined` when nothing was removed. */
  readonly removed: MachineTurnKind | undefined;
  /** An unclosed wrapper took the rest of the text. */
  readonly unclosed: boolean;
  /** A span was cut from BETWEEN the person's words, so the residue joins text the record never held together. */
  readonly spliced: boolean;
}

/**
 * A text with Unicode White_Space dropped from both ends — never JS `trim`, which also drops a U+FEFF the person's
 * text holds.
 *
 * @returns the text without its edge White_Space
 */
export function trimWhiteSpace({ text }: { text: string }): string {
  return text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

/** Whether `text` holds anything but White_Space. */
function holdsWords({ text }: { text: string }): boolean {
  return /[^\p{White_Space}]/u.test(text);
}

/**
 * Cut every wrapper span out of a turn's text.
 *
 * @param text the record's joined text blocks
 * @returns what is left after the spans are removed, and which kind the removal implies
 */
export function stripWrapperSpans({ text }: { text: string }): StrippedText {
  let residue = text;
  let removed: MachineTurnKind | undefined;
  let unclosed = false;
  // Where each cut joined the residue back together, kept in step with every later cut.
  let seams: number[] = [];
  for (const span of WRAPPER_SPANS) {
    const open = `<${span.tag}>`;
    const close = `</${span.tag}>`;
    for (;;) {
      const start = residue.indexOf(open);
      if (start === -1) {
        break;
      }
      const end = residue.indexOf(close, start);
      // An UNCLOSED wrapper takes the rest of the string. A transcript is appended to live, so a truncated
      // tail is ordinary; leaving the opening tag's body in place would hand it back as a person's words.
      let stop = residue.length;
      if (end !== -1) {
        stop = end + close.length;
      }
      residue = residue.slice(0, start) + residue.slice(stop);
      const width = stop - start;
      seams = [
        ...seams.map((seam) => {
          if (seam <= start) {
            return seam;
          }
          return Math.max(start, seam - width);
        }),
        start,
      ];
      unclosed = unclosed || end === -1;
      removed = span.kind;
    }
  }
  const spliced = seams.some(
    (seam) => holdsWords({ text: residue.slice(0, seam) }) && holdsWords({ text: residue.slice(seam) }),
  );
  return { removed, residue: trimWhiteSpace({ text: residue }), spliced, unclosed };
}

/**
 * The machine kind a record's own structural markers imply, if any.
 *
 * @param record the decoded line
 * @returns the kind, or `undefined` when nothing structural marks it as machine
 */
function structuralKind({ record }: { record: TranscriptRecord }): MachineTurnKind | undefined {
  if (record.role === "assistant") {
    return "assistant";
  }
  if (record.toolResults.length > 0 || record.hasToolUseResult) {
    return "tool-result";
  }
  if (record.isCompactSummary) {
    return "compaction-summary";
  }
  if (record.originKind === "task-notification") {
    return "task-notification";
  }
  if (record.originKind === "peer") {
    return "cross-session-message";
  }
  if (record.originKind === "human") {
    return undefined;
  }
  return record.isMeta || record.promptSource === "system" || record.promptSource === "sdk"
    ? "injected-prompt"
    : undefined;
}

/**
 * Read one decoded record as either a person's turn or machine traffic.
 *
 * @param record the decoded line
 * @returns the human turn, or the kind of machine traffic that was stripped
 */
export function classifyRecord({ record }: { record: TranscriptRecord }): TurnReading {
  const structural = structuralKind({ record });
  if (structural !== undefined) {
    return { kind: "machine", machine: structural };
  }
  // The WHOLE record, before any wrapper is stripped: a resume line beside anything else is a person's turn.
  const whole = trimWhiteSpace({ text: record.text });
  if (isFleetNudge({ text: whole })) {
    return { kind: "machine", machine: "fleet-nudge" };
  }
  // Whole too: the courier's boot-refusal line is the chair being told every seat refuses, never the owner's word.
  if (isBootRefusalWake({ text: whole })) {
    return { kind: "machine", machine: "boot-refusal-wake" };
  }
  // Whole too, paste wrapper and all: the line `cmux spawn` typed is the fleet booting a seat, never the owner's word.
  if (isSpawnPickupLine({ text: whole })) {
    return { kind: "machine", machine: "spawn-pickup" };
  }
  const stripped = stripWrapperSpans({ text: record.text });
  const opening = MACHINE_OPENINGS.find((candidate) => stripped.residue.startsWith(candidate.opening));
  if (opening !== undefined) {
    return { kind: "machine", machine: opening.kind };
  }
  if (stripped.residue === "") {
    if (stripped.removed !== undefined) {
      return { kind: "machine", machine: stripped.removed };
    }
    const attachmentOnly = record.blockKinds.some((kind) => kind === "image" || kind === "document");
    return { kind: "machine", machine: attachmentOnly ? "attachment-only" : "empty" };
  }
  const { [record.promptSource]: source = "unknown" } = HUMAN_SOURCES;
  return {
    kind: "human",
    turn: {
      cwd: record.cwd,
      lineNumber: record.lineNumber,
      source,
      text: stripped.residue,
      timestamp: record.timestamp,
      uuid: record.uuid,
      ...(stripped.unclosed ? { tailCut: true as const } : {}),
      ...(stripped.spliced ? { spliced: true as const } : {}),
    },
  };
}

/**
 * What an extraction found: the person's turns, and a full account of everything it stripped.
 *
 * @internal
 */
export interface ExtractedTurns {
  readonly turns: readonly HumanTurn[];
  /** How many records were stripped, by kind. Every stripped record lands in exactly one bucket. */
  readonly stripped: Readonly<Record<string, number>>;
  /** How many records were read in total, human and machine alike. */
  readonly recordCount: number;
}

/**
 * The turns that actually steered a session.
 *
 * Takes an ITERABLE rather than an array so the effectful edge can hand it a generator that streams one
 * line at a time off a file measured in tens of megabytes. An array satisfies it too, which is what the
 * unit suite passes.
 *
 * @param records the decoded lines, in file order
 * @returns the human turns, plus the count of everything stripped, by kind
 */
export function extractUserTurns({ records }: { records: Iterable<TranscriptRecord> }): ExtractedTurns {
  const turns: HumanTurn[] = [];
  const stripped: Record<string, number> = {};
  let recordCount = 0;
  for (const record of records) {
    recordCount += 1;
    const reading = classifyRecord({ record });
    if (reading.kind === "human") {
      turns.push(reading.turn);
      continue;
    }
    stripped[reading.machine] = absentAsNumber({ value: stripped[reading.machine], whenAbsent: 0 }) + 1;
  }
  return { recordCount, stripped, turns };
}
