/**
 * The huddle TRANSCRIPT — Slack's spoken-word capture, shaped and rendered. Pure, no I/O.
 *
 * ## Where the words actually live, and why nobody found them before
 *
 * A `huddle_transcript` file's BYTES are cookie-only: `files-pri` answers 302 to the workspace root for a
 * bearer token however many scopes it holds, which is what `docs/security/slack-huddles.md` recorded and
 * what made a huddle a pointer rather than a document. The words are not in that file at all from a token's
 * point of view — they come back INLINE on `files.info`, under an undeclared argument the web client sends
 * and the SDK does not know about:
 *
 * ```
 * files.info  file=<transcript id>  include_transcription=true
 *   → file.huddle_transcription = { lines[], channel_id, date_start, date_end, transcription_time_ranges[] }
 * ```
 *
 * Measured against the owner's own workspace, through `slopweaver slack probe`:
 * `slopweaver slack probe --method files.info file=<id> include_transcription=true --shape-at
 * file.huddle_transcription` reports `blocks, channel_id, date_end, date_start, lines,
 * transcription_time_ranges` for the USER token (`files:read`), and the same call WITHOUT the argument
 * returns a file object with no `huddle_transcription` key — so the argument is the switch, not the token.
 * The bot token answers `file_not_found` for a huddle held in a DM it is not a member of, which is
 * membership rather than scope.
 *
 * ## Rendering is `[mm:ss] speaker: words`, and the speaker may stay an id
 *
 * Each line carries `user_id`, `start_time_ms` and `contents`. A name map resolves the speaker when the
 * caller has one (the corpus refresh does); with no map the speaker renders as Slack's own `<@U…>` mention
 * syntax, which is exactly what the rest of the corpus stores for an unresolved user and what
 * `slopweaver derive` already knows how to resolve. Inventing a placeholder such as `unknown` instead would
 * put a word in a transcript that nobody said.
 *
 * Lines are separated by a BLANK line because the corpus chunker splits on paragraph boundaries — see
 * `corpus/chunkText.ts` — so a single-newline join would give it nothing to cut on and a long huddle would
 * chunk into one atom the size of the whole call.
 */
import { optStr as str } from "../../corpus/slack/shape.js";
import { epochSecondsToIso } from "../../lib/date.js";
import { isRecord } from "../../lib/parsers.js";

/** One spoken line of a huddle. */
interface HuddleTranscriptLine {
  /** The Slack user id Slack attributed the line to, when it attributed one. */
  readonly speakerId: string | undefined;
  /** Milliseconds from the start of the recording, when Slack reported an offset. */
  readonly startMs: number | undefined;
  /** What was said. Never blank — a line with no contents is dropped in shaping. */
  readonly contents: string;
}

/** One huddle's whole transcription, as `files.info` returns it under `include_transcription=true`. */
export interface HuddleTranscript {
  readonly lines: readonly HuddleTranscriptLine[];
  /** The conversation the huddle happened in, as Slack reports it on the transcription itself. */
  readonly channelId: string | undefined;
  readonly startedIso: string | undefined;
  readonly endedIso: string | undefined;
}

/** A finite number off an unknown record, or undefined. */
function num({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Slack epoch SECONDS → ISO-8601, or undefined when the field was absent or unusable. */
function epochToIso({ value }: { value: unknown }): string | undefined {
  const seconds = num({ value });
  return seconds === undefined ? undefined : epochSecondsToIso({ seconds });
}

/** One raw `lines[]` entry, or undefined when it carries nothing that was said. */
function shapeLine({ line }: { line: unknown }): HuddleTranscriptLine | undefined {
  if (!isRecord(line)) {
    return undefined;
  }
  const contents = str({ value: line["contents"] })?.trim();
  if (contents === undefined || contents.length === 0) {
    return undefined;
  }
  return {
    contents,
    speakerId: str({ value: line["user_id"] }),
    startMs: num({ value: line["start_time_ms"] }),
  };
}

/**
 * Shape one `files.info` file object's `huddle_transcription` into {@link HuddleTranscript}.
 *
 * Absent means absent: a file with no `huddle_transcription`, or one whose `lines` hold nothing that was
 * said, yields `undefined` rather than an empty transcript — so a caller cannot record "this huddle has a
 * transcript" off a response that carried no words.
 *
 * @param file the raw `file` member of a `files.info` response, of unvalidated shape
 * @returns the shaped transcription, or undefined when the response carried none
 */
export function shapeHuddleTranscript({ file }: { file: unknown }): HuddleTranscript | undefined {
  if (!isRecord(file)) {
    return undefined;
  }
  const raw = file["huddle_transcription"];
  if (!isRecord(raw)) {
    return undefined;
  }
  const rawLines = Array.isArray(raw["lines"]) ? raw["lines"] : [];
  const lines = rawLines
    .map((line) => shapeLine({ line }))
    .filter((line): line is HuddleTranscriptLine => line !== undefined);
  if (lines.length === 0) {
    return undefined;
  }
  return {
    channelId: str({ value: raw["channel_id"] }),
    endedIso: epochToIso({ value: raw["date_end"] }),
    lines,
    startedIso: epochToIso({ value: raw["date_start"] }),
  };
}

/** `13000` → `00:13`, `3_725_000` → `62:05`. Minutes are not wrapped into hours — a huddle is one sitting. */
function stamp({ startMs }: { startMs: number }): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Render a transcript to the plain text a corpus record and `slack read-file` both print.
 *
 * @param transcript the shaped transcription
 * @param speakerNames Slack user id → display name, when the caller holds the map; absent ids stay `<@U…>`
 * @returns the rendered transcript, one blank-line-separated line per utterance
 */
export function renderHuddleTranscript({
  transcript,
  speakerNames = {},
}: {
  transcript: HuddleTranscript;
  speakerNames?: Readonly<Record<string, string>>;
}): string {
  return transcript.lines
    .map((line) => {
      const at = line.startMs === undefined ? "" : `[${stamp({ startMs: line.startMs })}] `;
      const speaker = line.speakerId === undefined ? "" : `${speakerNames[line.speakerId] ?? `<@${line.speakerId}>`}: `;
      return `${at}${speaker}${line.contents}`;
    })
    .join("\n\n");
}
