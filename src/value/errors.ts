/**
 * The value-sample domain's typed failures: a sample that will not read or write, and an answer the sample refuses.
 * One union for the whole `src/value/` tree, built only through {@link ValueErrors}.
 */

/** A sample file exists and could not be read off disk. */
export interface SampleUnreadableError {
  readonly code: "SAMPLE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A sample file read, and is not a sample. */
export interface SampleInvalidError {
  readonly code: "SAMPLE_INVALID";
  readonly message: string;
  readonly path: string;
}

/** A sample could not be written. */
export interface SampleUnwritableError {
  readonly code: "SAMPLE_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** No sample was drawn for the week an answer names. */
export interface NoSampleError {
  readonly code: "NO_SAMPLE";
  readonly message: string;
  readonly week: string;
}

/** The answer names an ask the week's sample did not draw. */
export interface AskNotSampledError {
  readonly code: "ASK_NOT_SAMPLED";
  readonly message: string;
  readonly slug: string;
  readonly week: string;
}

/** The ask already carries a different answer; a second one never silently replaces the first. */
export interface AnswerConflictError {
  readonly code: "ANSWER_CONFLICT";
  readonly message: string;
  readonly recorded: string;
  readonly slug: string;
}

/** Every way the value-sample domain fails. */
export type ValueError =
  | SampleUnreadableError
  | SampleInvalidError
  | SampleUnwritableError
  | NoSampleError
  | AskNotSampledError
  | AnswerConflictError;

/** The message a thrown cause carries. */
const causeText = ({ cause }: { cause: unknown }): string => (cause instanceof Error ? cause.message : String(cause));

/** The factory every value-sample failure is built through. */
export const ValueErrors = {
  answerConflict: ({
    offered,
    recorded,
    slug,
  }: {
    offered: string;
    recorded: string;
    slug: string;
  }): AnswerConflictError => ({
    code: "ANSWER_CONFLICT",
    message: `${slug} is already answered ${recorded}; refusing ${offered} — a recorded answer is never replaced`,
    recorded,
    slug,
  }),
  askNotSampled: ({ slug, week }: { slug: string; week: string }): AskNotSampledError => ({
    code: "ASK_NOT_SAMPLED",
    message: `${slug} is not one of the asks the ${week} sample drew`,
    slug,
    week,
  }),
  noSample: ({ week }: { week: string }): NoSampleError => ({
    code: "NO_SAMPLE",
    message: `no value sample was drawn for ${week} — \`slopweaver value sample\` draws one`,
    week,
  }),
  sampleInvalid: ({ detail, path }: { detail: string; path: string }): SampleInvalidError => ({
    code: "SAMPLE_INVALID",
    message: `${path} is not a value sample: ${detail}`,
    path,
  }),
  sampleUnreadable: ({ cause, path }: { cause: unknown; path: string }): SampleUnreadableError => ({
    code: "SAMPLE_UNREADABLE",
    message: `${path} could not be read: ${causeText({ cause })}`,
    path,
  }),
  sampleUnwritable: ({ cause, path }: { cause: unknown; path: string }): SampleUnwritableError => ({
    code: "SAMPLE_UNWRITABLE",
    message: `${path} could not be written: ${causeText({ cause })}`,
    path,
  }),
} as const;
