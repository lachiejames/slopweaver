/**
 * The failures the failure-explanations register (`./failureExplanation.ts`) authors: the variants of this directory's
 * `RecipeError` union that belong to it, and their factories, which `./errors.ts`'s `RecipeErrors` carries whole. Kept
 * beside that union rather than inside it so the directory's error file stays one a reader can hold.
 */

/** The failure explanations register could not be read or appended to at all. */
export interface RecipeExplanationsFileError {
  readonly code: "EXPLANATIONS_FILE_UNREADABLE" | "EXPLANATIONS_FILE_UNWRITABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** An explanation named a firing the slot ledger does not hold as failed or dead at that attempt, so none is filed. */
export interface RecipeExplanationNotAFailureError {
  readonly code: "EXPLANATION_NOT_A_FAILURE";
  readonly message: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly attempt: number;
}

/** An explanation's words are not one plain sentence fit to lead a row (`checkExplanationWords`), so none is filed. */
export interface RecipeExplanationWordsRefusedError {
  readonly code: "EXPLANATION_WORDS_REFUSED";
  readonly message: string;
  readonly recipeId: string;
  readonly why: string;
}

/**
 * An explanation's recording time is not one exact instant, so it cannot be ordered against another for the same
 * firing and none is filed: a line carrying one would otherwise outrank a valid explanation.
 */
export interface RecipeExplanationInstantError {
  readonly code: "EXPLANATION_INSTANT_UNREADABLE";
  readonly message: string;
  readonly recipeId: string;
  readonly recordedIso: string;
}

/**
 * Which check an explanation's words failed: empty, more than one line, over the length cap, a character or token
 * outside the sentence shape, a raw record the shape still lets through, or not exactly one sentence closed by its
 * own stop.
 */
type ExplanationWordsFault = "EMPTY" | "MULTI_LINE" | "TOO_LONG" | "OUTSIDE_SHAPE" | "RAW_RECORD" | "NOT_ONE_SENTENCE";

/** An offered sentence is not one plain sentence fit to lead a row; `fault` names which check it failed. */
export interface RecipeExplanationWordsUnfitError {
  readonly code: "EXPLANATION_WORDS_UNFIT";
  readonly message: string;
  readonly fault: ExplanationWordsFault;
}

/** Every failure the register authors. */
export type RecipeExplanationError =
  | RecipeExplanationsFileError
  | RecipeExplanationNotAFailureError
  | RecipeExplanationInstantError
  | RecipeExplanationWordsRefusedError
  | RecipeExplanationWordsUnfitError;

/** The factories for {@link RecipeExplanationError}, spread into `RecipeErrors`. */
export const RecipeExplanationErrors = {
  explanationInstantUnreadable: ({
    recipeId,
    recordedIso,
  }: {
    recipeId: string;
    recordedIso: string;
  }): RecipeExplanationInstantError => ({
    code: "EXPLANATION_INSTANT_UNREADABLE",
    message: `${recipeId}'s explanation was not filed: its recording time ${recordedIso} is not one ISO instant`,
    recipeId,
    recordedIso,
  }),
  explanationNotAFailure: ({
    recipeId,
    slotIso,
    attempt,
    found,
  }: {
    recipeId: string;
    slotIso: string;
    attempt: number;
    found: string;
  }): RecipeExplanationNotAFailureError => ({
    attempt,
    code: "EXPLANATION_NOT_A_FAILURE",
    message: `${recipeId}'s firing at ${slotIso} attempt ${String(attempt)} is ${found}, not a failure, so no explanation is filed`,
    recipeId,
    slotIso,
  }),
  explanationWordsRefused: ({
    recipeId,
    why,
  }: {
    recipeId: string;
    why: string;
  }): RecipeExplanationWordsRefusedError => ({
    code: "EXPLANATION_WORDS_REFUSED",
    message: `${recipeId}'s explanation was not filed: ${why}`,
    recipeId,
    why,
  }),
  explanationWordsEmpty: (): RecipeExplanationWordsUnfitError => ({
    code: "EXPLANATION_WORDS_UNFIT",
    fault: "EMPTY",
    message: "the explanation is empty: say what went wrong and what would fix it, in one sentence",
  }),
  explanationWordsMultiLine: (): RecipeExplanationWordsUnfitError => ({
    code: "EXPLANATION_WORDS_UNFIT",
    fault: "MULTI_LINE",
    message: "the explanation spans more than one line: one sentence, with the raw record left in the firing",
  }),
  explanationWordsNotOneSentence: (): RecipeExplanationWordsUnfitError => ({
    code: "EXPLANATION_WORDS_UNFIT",
    fault: "NOT_ONE_SENTENCE",
    message:
      "the explanation is not one sentence ending in a full stop: say what went wrong and what would fix it in " +
      'one, for example "The mail sign-in expired, so reconnecting mail in Setup fixes it." A full stop inside it, ' +
      "such as in a host or file name, reads as a second sentence, so name the service in words.",
  }),
  explanationWordsOutsideShape: ({ found }: { found: string | undefined }): RecipeExplanationWordsUnfitError => {
    // Quoted as a JSON string, so a tab or a quote mark names itself rather than vanishing into the message.
    const what = found === undefined ? "a word or number out of shape" : JSON.stringify(found);
    return {
      code: "EXPLANATION_WORDS_UNFIT",
      fault: "OUTSIDE_SHAPE",
      message:
        `the explanation carries ${what}, which a plain sentence here does not: words and numbers one space apart, ` +
        "joined only by an apostrophe or hyphen, with commas and one closing stop, so say a code, a path, a quote or " +
        "a bracket in words",
    };
  },
  explanationWordsRawRecord: (): RecipeExplanationWordsUnfitError => ({
    code: "EXPLANATION_WORDS_UNFIT",
    fault: "RAW_RECORD",
    message:
      "the explanation reads like the raw record (a stack frame, a JSON body, an exception or an exit code): say in " +
      "plain words what went wrong and what would fix it",
  }),
  explanationWordsTooLong: ({ length, cap }: { length: number; cap: number }): RecipeExplanationWordsUnfitError => ({
    code: "EXPLANATION_WORDS_UNFIT",
    fault: "TOO_LONG",
    message:
      `the explanation is ${String(length)} characters, over the ${String(cap)} ` +
      "a row's subtitle holds: say it shorter, the raw record stays in the firing",
  }),
  explanationsFileUnreadable: ({ path, detail }: { path: string; detail: string }): RecipeExplanationsFileError => ({
    code: "EXPLANATIONS_FILE_UNREADABLE",
    detail,
    message: `cannot read the failure explanations register ${path}: ${detail}`,
    path,
  }),
  explanationsFileUnwritable: ({ path, detail }: { path: string; detail: string }): RecipeExplanationsFileError => ({
    code: "EXPLANATIONS_FILE_UNWRITABLE",
    detail,
    message: `cannot append to the failure explanations register ${path}: ${detail}`,
    path,
  }),
} as const;
