/**
 * Why measuring the owner's voice length register from their sent Slack failed — as opposed to measuring nothing, which is a
 * skip and never one of these. Each is a different fix, so each is its own code.
 */

/** `profile.json` is there and cannot be trusted, so whose messages to measure is unknown. */
export interface VoiceMeasureProfileUnreadableError {
  readonly code: "VOICE_MEASURE_PROFILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The Slack corpus, or one file in it, could not be read, so a measurement would silently miss the owner's messages. */
export interface VoiceMeasureCorpusUnreadableError {
  readonly code: "VOICE_MEASURE_CORPUS_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The owner's protect list refuses the Slack corpus, or cannot be read, so none of it was opened. */
export interface VoiceMeasureCorpusProtectedError {
  readonly code: "VOICE_MEASURE_CORPUS_PROTECTED";
  readonly message: string;
}

/** A line naming the owner would not parse, so it may be one of the owner's messages the measurement would miss. */
export interface VoiceMeasureRowMalformedError {
  readonly code: "VOICE_MEASURE_ROW_MALFORMED";
  readonly message: string;
  readonly path: string;
  readonly line: number;
}

/** The store refused, could not be reached, or did not take a cohort. */
export interface VoiceMeasureStoreFailedError {
  readonly code: "VOICE_MEASURE_STORE_FAILED";
  readonly message: string;
}

/** The register was written but the context cache the send door reads could not be refreshed. */
export interface VoiceMeasureCacheFailedError {
  readonly code: "VOICE_MEASURE_CACHE_FAILED";
  readonly message: string;
}

/** Every way a measurement fails. */
export type VoiceMeasureError =
  | VoiceMeasureProfileUnreadableError
  | VoiceMeasureCorpusUnreadableError
  | VoiceMeasureCorpusProtectedError
  | VoiceMeasureRowMalformedError
  | VoiceMeasureStoreFailedError
  | VoiceMeasureCacheFailedError;

/** The factory every {@link VoiceMeasureError} is built through. */
export const VoiceMeasureErrors = {
  cacheFailed: ({ detail }: { detail: string }): VoiceMeasureCacheFailedError => ({
    code: "VOICE_MEASURE_CACHE_FAILED",
    message:
      `the context cache the send door reads could not be rebuilt (${detail}), so no cohort was written — ` +
      "the register keeps its last measurement",
  }),
  corpusProtected: ({ lines }: { lines: readonly string[] }): VoiceMeasureCorpusProtectedError => ({
    code: "VOICE_MEASURE_CORPUS_PROTECTED",
    message: `${lines.join("; ")} — nothing was measured`,
  }),
  corpusUnreadable: ({ path, detail }: { path: string; detail: string }): VoiceMeasureCorpusUnreadableError => ({
    code: "VOICE_MEASURE_CORPUS_UNREADABLE",
    message: `the Slack corpus at ${path} could not be read (${detail}), so nothing was measured`,
    path,
  }),
  profileUnreadable: ({ path, detail }: { path: string; detail: string }): VoiceMeasureProfileUnreadableError => ({
    code: "VOICE_MEASURE_PROFILE_UNREADABLE",
    message: `${detail} — nothing was measured, because whose Slack messages to measure is read from it`,
    path,
  }),
  rowMalformed: ({
    path,
    line,
    detail,
  }: {
    path: string;
    line: number;
    detail: string;
  }): VoiceMeasureRowMalformedError => ({
    code: "VOICE_MEASURE_ROW_MALFORMED",
    line,
    message:
      `${path} line ${String(line + 1)} names the owner's Slack id but does not parse (${detail}), so it may be one of the owner's ` +
      "messages — nothing was measured rather than measuring without it",
    path,
  }),
  storeFailed: ({ detail }: { detail: string }): VoiceMeasureStoreFailedError => ({
    code: "VOICE_MEASURE_STORE_FAILED",
    message: `the voice register could not be written: ${detail}`,
  }),
} as const;
