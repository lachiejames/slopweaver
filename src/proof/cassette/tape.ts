/**
 * Turning a session-authored VHS tape into one that renders a proof cassette a reader can actually watch: an
 * `.mp4` with a player's controls, typed fast enough that nobody sits through it.
 *
 * A looping GIF has no timeline controls and no indicator of how long it runs or whether it loops, and a
 * prompt that takes 15 seconds to type out cannot be skipped or sped up. Both are tape properties. VHS
 * types at 50ms a character unless told otherwise, so a 300-character prompt is fifteen seconds of typing;
 * and the tape names its own output, so whatever extension the author wrote is what reaches the pull request.
 *
 * So this module OWNS both. It refuses a tape that names an output (VHS writes EVERY `Output` line, so a
 * stray `.gif` would still be produced beside the video), a `Source` (another tape this check cannot read),
 * and any typing slower than {@link MAX_TYPING_MS} or played back below real time; then it sets
 * {@link DEFAULT_TYPING} first and the `.mp4` output last, followed by the text transcript its capture receipt reads.
 *
 * It reads the tape as VHS does — a TOKEN stream, not lines. MEASURED with `vhs validate` (0.11.0), every one of these is a valid tape: `Type @500ms "x"`, `Type@ 500ms "x"`, `Type@500ms"x"`,
 * `Backspace@500ms 40`, `Sleep 100ms Type@500ms "x"` on one line, `Type` and `@500ms "x"` on two, and
 * `Type "a\" Type@500ms "b"` — a string has no escapes, so the second command is real (rendering
 * `Type "a\" Type@2s "b"` printed `Type a\` then `Type 2s b`). An unterminated
 * string ends at its line break: rendering `Type "abc` then `Type@2s "xx"` printed `Type 2s xx`. A `#` outside
 * a string starts a comment even glued to a word (`Type "f"#Type@@` validates). A line-anchored check misses
 * most of those, so {@link tapeTokens} lexes the whole source and the rules read its tokens.
 *
 * MEASURED against `vhs` 0.11.0, both placements take effect: a `Set TypingSpeed` before a
 * `Require` and an `Output` after the last command each rendered, and the file was h264/yuv420p, which every
 * browser plays inline (`vhs <tape> && ffprobe -v error -show_entries stream=codec_name,pix_fmt -of compact
 * <out>.mp4`).
 */
import { err, ok, type Result } from "#lib/result.js";

import { isTapeStringSafe } from "../yarnWhy/tape.js";

/** The slowest a cassette may type, per character. Ten milliseconds is three seconds for a 300-character prompt. */
const MAX_TYPING_MS = 10;
/** The typing speed every cassette starts at; a tape may only set it faster. */
const DEFAULT_TYPING = "5ms";
/** The one container a cassette renders to: GitHub, Slack and Linear all play it with controls. */
const VIDEO_EXTENSION = ".mp4";

/** A VHS duration: a number with an optional `ms` or `s` unit, where a bare number is seconds. */
const DURATION = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)?$/;
/** The characters that open, and close, a VHS string. */
const QUOTES = new Set(['"', "'", "`"]);

/**
 * One VHS token: a word, a string's contents, or the `@` that introduces a per-command speed. Strings are kept
 * so the token after an `@` is the one VHS reads, and a string there is an unreadable duration.
 */
interface TapeToken {
  readonly kind: "word" | "at" | "string";
  readonly text: string;
  readonly line: number;
}

/**
 * Where a string opened just before `from` ends: at its own closing quote, or at the newline or end of tape
 * that comes first — VHS ends an unterminated string at the line break rather than swallowing the next line.
 */
function stringEnd({ source, from, quote }: { source: string; from: number; quote: string }): number {
  let end = from;
  while (end < source.length && source[end] !== quote && source[end] !== "\n") {
    end += 1;
  }
  return end;
}

/** Whether a character ends a word: whitespace, a quote, a comment or an `@`. */
function endsWord({ char }: { char: string }): boolean {
  return /\s/.test(char) || QUOTES.has(char) || char === "#" || char === "@";
}

/**
 * Skip the whitespace and `#` comments starting at `from`. A comment runs to its newline and stops short of
 * it, so that newline is skipped here as whitespace and counted.
 */
function skipBlank({ source, from }: { source: string; from: number }): { next: number; newlines: number } {
  let next = from;
  let newlines = 0;
  while (next < source.length) {
    const char = source[next]!;
    if (char === "#") {
      const newline = source.indexOf("\n", next);
      next = newline === -1 ? source.length : newline;
    } else if (/\s/.test(char)) {
      newlines += char === "\n" ? 1 : 0;
      next += 1;
    } else {
      return { newlines, next };
    }
  }
  return { newlines, next };
}

/**
 * Read the one token starting at `from`, which is not blank. Neither a string nor a word ever spans a
 * newline, so the token sits wholly on `line`.
 */
function readToken({ source, from, line }: { source: string; from: number; line: number }): {
  token: TapeToken;
  next: number;
} {
  const char = source[from]!;
  if (QUOTES.has(char)) {
    const end = stringEnd({ from: from + 1, quote: char, source });
    // Past the closing quote, but never past a newline: that is skipped next, so the line count stays right.
    return {
      next: source[end] === char ? end + 1 : end,
      token: { kind: "string", line, text: source.slice(from + 1, end) },
    };
  }
  if (char === "@") {
    return { next: from + 1, token: { kind: "at", line, text: char } };
  }
  let end = from + 1;
  while (end < source.length && !endsWord({ char: source[end]! })) {
    end += 1;
  }
  return { next: end, token: { kind: "word", line, text: source.slice(from, end) } };
}

/**
 * Lex a tape the way VHS reads it: whitespace (newlines included) separates tokens, `@` is a token of its
 * own, a quote opens a string that runs to the same quote or the end of its line with no escapes, and `#`
 * comments to end of line.
 *
 * @param source the whole tape
 * @returns every token, each with the 1-based line it starts on
 */
function tapeTokens({ source }: { source: string }): readonly TapeToken[] {
  const tokens: TapeToken[] = [];
  let line = 1;
  let index = 0;
  for (;;) {
    const blank = skipBlank({ from: index, source });
    line += blank.newlines;
    if (blank.next >= source.length) {
      return tokens;
    }
    const read = readToken({ from: blank.next, line, source });
    tokens.push(read.token);
    index = read.next;
  }
}

/**
 * A VHS duration in milliseconds, or `undefined` when it is not one.
 *
 * @param text the duration as the tape spells it — `5ms`, `0.05s`, `1`
 * @returns the duration in milliseconds
 */
function durationMs({ text }: { text: string }): number | undefined {
  const match = DURATION.exec(text);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const value = Number.parseFloat(match[1]);
  return match[2] === "ms" ? value : value * 1000;
}

/**
 * One thing a tape or its output is refused for. `slow-typing` is the one POLICY refusal — the tape would
 * render, just slowly — so it is the one the verb's escape hatch waives; every other kind is a tape that
 * cannot produce the one `.mp4` at all.
 */
export interface CassetteIssue {
  readonly kind: "slow-typing" | "unrenderable";
  readonly message: string;
}

/** Why one typing duration is refused, or `undefined` when it is fast enough or slow typing is allowed. */
function typingIssue({
  line,
  text,
  allowSlowTyping,
}: {
  line: number;
  text: string;
  allowSlowTyping: boolean;
}): CassetteIssue | undefined {
  const ms = durationMs({ text });
  if (ms === undefined) {
    return { kind: "unrenderable", message: `line ${String(line)}: cannot read the typing duration "${text}"` };
  }
  if (ms > MAX_TYPING_MS && !allowSlowTyping) {
    return {
      kind: "slow-typing",
      message:
        `line ${String(line)}: types at ${text} a character — a cassette types at ${String(MAX_TYPING_MS)}ms or ` +
        `faster, so a reader is not sat through it; drop the setting and the cassette types at ${DEFAULT_TYPING}`,
    };
  }
  return undefined;
}

/**
 * Every issue one token earns, reading the token after it where the token introduces a value: `Output` and
 * `Source` outright, the duration after an `@` (on `Type` and every key command — `Backspace@500ms 40` is
 * twenty seconds of deleting) or after `TypingSpeed`, and the factor after `PlaybackSpeed`.
 */
function tokenIssues({
  token,
  next,
  allowSlowTyping,
}: {
  token: TapeToken;
  next: TapeToken | undefined;
  allowSlowTyping: boolean;
}): readonly CassetteIssue[] {
  const { line } = token;
  const value = next === undefined ? "" : next.text;
  if (token.kind === "at" || (token.kind === "word" && token.text === "TypingSpeed")) {
    const issue = typingIssue({ allowSlowTyping, line, text: value });
    return issue === undefined ? [] : [issue];
  }
  if (token.kind !== "word") {
    return [];
  }
  if (token.text === "PlaybackSpeed") {
    return playbackIssues({ allowSlowTyping, line, text: value });
  }
  if (token.text === "Output") {
    return [
      {
        kind: "unrenderable",
        message:
          `line ${String(line)}: the tape names its own output — drop it; the cassette writes the one --out .mp4, ` +
          "and VHS would write this one too",
      },
    ];
  }
  if (token.text === "Source") {
    return [
      {
        kind: "unrenderable",
        message: `line ${String(line)}: Source pulls in a tape this check cannot read — inline its commands instead`,
      },
    ];
  }
  return [];
}

/** Why a `Set PlaybackSpeed` factor is refused: unreadable, or below real time with slow typing not allowed. */
function playbackIssues({
  line,
  text,
  allowSlowTyping,
}: {
  line: number;
  text: string;
  allowSlowTyping: boolean;
}): readonly CassetteIssue[] {
  const factor = Number(text);
  if (!Number.isFinite(factor) || factor <= 0) {
    return [{ kind: "unrenderable", message: `line ${String(line)}: cannot read the playback speed "${text}"` }];
  }
  if (factor < 1 && !allowSlowTyping) {
    return [
      {
        kind: "slow-typing",
        message:
          `line ${String(line)}: plays back at ${text}x — slower than real time stretches every keystroke past ` +
          `${String(MAX_TYPING_MS)}ms; drop the setting`,
      },
    ];
  }
  return [];
}

/** Every issue the `--out` path earns: an `.mp4`, absolute, and carriable inside a tape string. */
function outIssues({ out }: { out: string }): readonly CassetteIssue[] {
  const messages = [
    ...(out.toLowerCase().endsWith(VIDEO_EXTENSION)
      ? []
      : [`--out must be an ${VIDEO_EXTENSION} — a GIF autoplays and loops with no timeline control: ${out}`]),
    ...(out.startsWith("/") ? [] : [`--out must be absolute, got ${out}`]),
    ...(isTapeStringSafe({ value: out }) ? [] : [`--out cannot be written into a VHS tape: ${out}`]),
  ];
  return messages.map((message) => ({ kind: "unrenderable", message }));
}

/**
 * Where a cassette's transcript is written: beside the video, so the session reads what the recording showed.
 *
 * @param out the cassette's absolute `.mp4` path
 * @returns the transcript's path
 */
export function cassetteTranscriptPath({ out }: { out: string }): string {
  return `${out}.txt`;
}

/**
 * Build the tape that renders a proof cassette: the author's commands, typed fast, written to one `.mp4` and to the
 * text transcript beside it. The transcript is VHS's `.txt` output — every screen the recording showed, as text —
 * and it is what the capture receipt records as the recording's frame text, so `github attach` scans the words a
 * reader will watch scroll past. NOT MEASURED in the change that added it: no `vhs` was installed where it was
 * written, so the transcript's exact layout rests on VHS's documented text output, and a run that writes no
 * transcript leaves a receipt whose frame text is `incomplete`, which `github attach` refuses.
 *
 * @param source the tape the session wrote, with no `Output` line of its own
 * @param out the ABSOLUTE `.mp4` path the cassette is written to
 * @param allowSlowTyping the verb's escape hatch is open, so a tape slower than the cap is let through
 * @returns the tape to run, or every issue the source and the output earned
 */
export function cassetteTape({
  source,
  out,
  allowSlowTyping,
}: {
  source: string;
  out: string;
  allowSlowTyping: boolean;
}): Result<string, readonly CassetteIssue[]> {
  const tokens = tapeTokens({ source });
  const issues = [
    ...outIssues({ out }),
    ...tokens.flatMap((token, index) => tokenIssues({ allowSlowTyping, next: tokens[index + 1], token })),
  ];
  if (issues.length > 0) {
    return err(issues);
  }
  return ok(
    [
      `Set TypingSpeed ${DEFAULT_TYPING}`,
      source.trimEnd(),
      `Output "${out}"`,
      `Output "${cassetteTranscriptPath({ out })}"`,
      "",
    ].join("\n"),
  );
}
