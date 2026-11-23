/**
 * Pure `files.info` → the typed subset `slack read-file` needs. No I/O.
 *
 * ## The huddle fields are REAL and UNTYPED, and that is the interesting fact here
 *
 * `slopweaver atlas slack-api --method files.info` lists the response fields `@slack/web-api` 8.0.0
 * declares, and NONE of the five this module reads is among them. Measured live against a
 * real huddle-notes file (`slopweaver slack probe --method files.info file=F0BTACLP1D0`, which reports
 * field NAMES and never bodies), Slack returned `is_huddle_canvas`, `huddle_date_start`, `huddle_date_end`,
 * `huddle_summary_id` and `huddle_transcript_file_id` alongside the documented ones.
 *
 * So the SDK typings are a floor, not a ceiling, and every field here is read defensively off `unknown`
 * with an absent-means-absent contract. A huddle canvas whose transcript id Slack stops sending degrades to
 * "notes, no transcript" rather than throwing.
 *
 * ## Why the transcript is a SECOND file
 *
 * Slack stores a huddle as two objects: the notes CANVAS a person can edit, and an auto-generated
 * transcript the canvas points at by id. Nothing on the canvas carries the transcript's text, so reading a
 * huddle is inherently a two-call operation — `files.info` on the canvas, then `files.info` on the id it
 * names. That is why {@link SlackFileMeta} carries `huddleTranscriptFileId` rather than a body.
 *
 * The SECOND call is where the words are, and they are not the file's bytes: passing Slack's undeclared
 * `include_transcription=true` returns them inline as `file.huddle_transcription`, which
 * {@link SlackFileMeta.huddleTranscript} carries. `huddleTranscript.ts` holds the measurement and the shape.
 */
import { optStr as str } from "../../corpus/slack/shape.js";
import { epochSecondsToIso } from "../../lib/date.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type SlackFileReadError, SlackFileReadErrors } from "./fileErrors.js";
import { type HuddleTranscript, shapeHuddleTranscript } from "./huddleTranscript.js";

/** The typed subset of one `files.info` file object. Every optional field is genuinely absent, never blank. */
export interface SlackFileMeta {
  readonly id: string;
  readonly title: string;
  /** Slack's `filetype`, e.g. `canvas`, `text`, `png`. */
  readonly filetype: string | undefined;
  /** Slack's `mode`, e.g. `canvas`, `hosted`, `snippet` — a second, older signal for the same question. */
  readonly mode: string | undefined;
  readonly mimetype: string | undefined;
  /** Bytes Slack reports, used to detect a short download rather than to decide anything. */
  readonly size: number | undefined;
  /** The public-facing permalink, for citation. Never `url_private`. */
  readonly permalink: string | undefined;
  /** The authenticated bytes URL, as an attachment. Present for anything with a body. */
  readonly urlPrivateDownload: string | undefined;
  /** The authenticated in-place URL. Slack serves some filetypes only from this one. */
  readonly urlPrivate: string | undefined;
  /** The uploading/creating user id, unresolved. */
  readonly user: string | undefined;
  /** Creation time as ISO-8601, when Slack reported an epoch. */
  readonly createdIso: string | undefined;
  /** Every conversation id the file is shared into — the visibility signal a corpus lane needs. */
  readonly channels: readonly string[];
  /**
   * Slack's `file_access`, e.g. `visible` or `check_file_info`. Reported because it is the ONE field that
   * distinguishes "this token may not read the bytes" from "the bytes did not arrive", and a read verb that
   * cannot tell those apart sends its caller looking for a network fault that is really a permission.
   */
  readonly fileAccess: string | undefined;
  /** True when Slack marks this file as a huddle-notes canvas. */
  readonly isHuddleCanvas: boolean;
  /** The auto-generated transcript's own file id, when the huddle produced one. */
  readonly huddleTranscriptFileId: string | undefined;
  /** The AI summary's file id, when one exists. Reported, never followed — see `readFile.ts`. */
  readonly huddleSummaryId: string | undefined;
  readonly huddleStartIso: string | undefined;
  readonly huddleEndIso: string | undefined;
  /**
   * The huddle's spoken WORDS, present only when the caller asked `files.info` for
   * `include_transcription=true` AND Slack had a transcription for this file. See
   * `huddleTranscript.ts` for why the words arrive here rather than in the file's bytes.
   */
  readonly huddleTranscript: HuddleTranscript | undefined;
}

/**
 * Undo the three entities Slack escapes in every text field it returns.
 *
 * Slack's own documented contract is that `&`, `<` and `>` — and only those three — are escaped, so this is
 * a complete decoder rather than a partial one. Without it a huddle's title reads
 * `… with &lt;@USER&gt;` (an escaped user mention), which is not a mention any reader or downstream resolver
 * recognises. `&amp;` is undone LAST so `&amp;lt;` decodes to the literal `&lt;` a person typed rather than
 * to a `<` they did not.
 *
 * @param text the escaped text as Slack returned it
 * @returns the text with Slack's escapes undone
 */
function unescapeSlack({ text }: { text: string }): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/** A finite number field off an unknown record, or undefined. */
function num({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Slack epoch SECONDS → ISO-8601, or undefined when the field was absent or unusable. */
function epochToIso({ value }: { value: unknown }): string | undefined {
  const seconds = num({ value });
  return seconds === undefined ? undefined : epochSecondsToIso({ seconds });
}

/** Every string member of an unknown array, dropping anything that is not one. */
function strings({ value }: { value: unknown }): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Shape one raw `files.info` file object into {@link SlackFileMeta}.
 *
 * @param file the raw `file` member of the `files.info` response, of unvalidated shape
 * @returns the typed metadata, or `err` when the object carries no id to key anything on
 */
export function shapeSlackFileMeta({ file }: { file: unknown }): Result<SlackFileMeta, SlackFileReadError> {
  if (!isRecord(file)) {
    return err(SlackFileReadErrors.unusableFile({ reason: "files.info returned no file object" }));
  }
  const id = str({ value: file["id"] });
  if (id === undefined) {
    return err(SlackFileReadErrors.unusableFile({ reason: "the file object carries no id" }));
  }
  return ok({
    channels: [
      ...strings({ value: file["channels"] }),
      ...strings({ value: file["ims"] }),
      ...strings({ value: file["groups"] }),
    ],
    createdIso: epochToIso({ value: file["created"] }),
    fileAccess: str({ value: file["file_access"] }),
    filetype: str({ value: file["filetype"] }),
    huddleEndIso: epochToIso({ value: file["huddle_date_end"] }),
    huddleStartIso: epochToIso({ value: file["huddle_date_start"] }),
    huddleSummaryId: str({ value: file["huddle_summary_id"] }),
    huddleTranscript: shapeHuddleTranscript({ file }),
    huddleTranscriptFileId: str({ value: file["huddle_transcript_file_id"] }),
    id,
    isHuddleCanvas: file["is_huddle_canvas"] === true,
    mimetype: str({ value: file["mimetype"] }),
    mode: str({ value: file["mode"] }),
    permalink: str({ value: file["permalink"] }),
    size: num({ value: file["size"] }),
    title: unescapeSlack({ text: str({ value: file["title"] }) ?? str({ value: file["name"] }) ?? id }),
    urlPrivate: str({ value: file["url_private"] }),
    urlPrivateDownload: str({ value: file["url_private_download"] }),
    user: str({ value: file["user"] }),
  });
}
