/**
 * What `./claimCorrection.ts` refuses with, and the checks on the two words a caller hands it before any message is
 * read. Split out under the file-size cap along the line between the INPUT (the claim's words, the correction line,
 * and every way a correction can be refused) and the MESSAGE they are applied to. Pure, and imports nothing from
 * `./claimCorrection.ts`.
 */
import { rawMarkupRefusal, scanRawMarkup } from "../artifact/typedRuns.js";
import { OPAQUE } from "./claimStrike.js";

/** The longest correction line accepted. One line under a struck claim, never a second answer. */
export const CORRECTION_MAX_CHARS = 300;

/** The correction text, or the claim, is unusable as given. */
interface CorrectionTextInvalidError {
  readonly code: "CORRECTION_TEXT_INVALID";
  readonly message: string;
}

/** The message does not make the claim, so nothing would be struck. */
interface ClaimNotFoundError {
  readonly code: "CLAIM_NOT_FOUND";
  readonly message: string;
}

/** The claim occurs more than once, so the strike could land on the wrong sentence. */
interface ClaimAmbiguousError {
  readonly code: "CLAIM_AMBIGUOUS";
  readonly message: string;
  readonly count: number;
}

/** The claim is already struck through, so this correction has already been made. */
interface ClaimAlreadyStruckError {
  readonly code: "CLAIM_ALREADY_STRUCK";
  readonly message: string;
}

/** The claim also shows where no strike reaches — a header, a context line, an alt text — so readers would still see it. */
interface ClaimUnstrikeableError {
  readonly code: "CLAIM_UNSTRIKEABLE";
  readonly message: string;
}

/** Why a correction cannot be composed. */
export type ClaimCorrectionError =
  | CorrectionTextInvalidError
  | ClaimNotFoundError
  | ClaimAmbiguousError
  | ClaimAlreadyStruckError
  | ClaimUnstrikeableError;

/** How to raise each refusal: the factory the real code calls. */
export const ClaimCorrectionErrors = {
  alreadyStruck: ({ wrong }: { wrong: string }): ClaimAlreadyStruckError => ({
    code: "CLAIM_ALREADY_STRUCK",
    message: `${JSON.stringify(wrong)} is already struck through in this message, so this correction was already made. Nothing was changed.`,
  }),
  ambiguous: ({ count, wrong }: { count: number; wrong: string }): ClaimAmbiguousError => ({
    code: "CLAIM_AMBIGUOUS",
    count,
    message:
      `${JSON.stringify(wrong)} occurs ${String(count)} times in this message, so a strike could land on the wrong ` +
      "sentence. Pass a longer --wrong that occurs once. Nothing was changed.",
  }),
  invalid: ({ reason }: { reason: string }): CorrectionTextInvalidError => ({
    code: "CORRECTION_TEXT_INVALID",
    message: `${reason}. Nothing was changed.`,
  }),
  notFound: ({ wrong }: { wrong: string }): ClaimNotFoundError => ({
    code: "CLAIM_NOT_FOUND",
    message:
      `this message does not say ${JSON.stringify(wrong)} — --wrong must be the claim's exact words as the message ` +
      "shows them (a mention or an emoji inside it cannot be matched). Nothing was changed.",
  }),
  unstrikeable: ({ wrong }: { wrong: string }): ClaimUnstrikeableError => ({
    code: "CLAIM_UNSTRIKEABLE",
    message:
      `${JSON.stringify(wrong)} also shows somewhere a strike cannot reach (a header, a context line, an image's alt ` +
      "text, a date, a link or a code span), so readers would still see it after the edit. Nothing was changed.",
  }),
} as const;

/** Why `--wrong` cannot be struck as given, or nothing. */
function wrongRefusal({ wrong }: { wrong: string }): string | undefined {
  if (wrong.trim().length === 0) {
    return "--wrong is empty: name the exact words of the claim that turned out wrong";
  }
  if (wrong !== wrong.trim()) {
    return "--wrong starts or ends with whitespace, which a strikethrough cannot hold: trim it";
  }
  if (/[&<>]/u.test(wrong)) {
    return "--wrong carries &, < or >, which Slack stores escaped in mrkdwn and fallbacks, so a copy there would not be found: pass words that hold none";
  }
  if (/[\r\n]/u.test(wrong)) {
    return "--wrong spans more than one line, and Slack strikes within one line only: pass the claim's words on one line";
  }
  if (wrong.includes("~")) {
    return "--wrong carries a ~, which Slack would read as the strike's own edge: pass words that hold none";
  }
  return wrong.includes(OPAQUE) ? "--wrong carries a NUL character" : undefined;
}

/**
 * Why the two inputs cannot be used, or nothing: the claim's words first, then the correction line.
 *
 * @param correction the line to put under the strike, as given
 * @param wrong the claim's exact words, as given
 * @returns the refusal's reason, without a trailing full stop, or undefined when both are usable
 */
export function correctionInputRefusal({
  correction,
  wrong,
}: {
  correction: string;
  wrong: string;
}): string | undefined {
  const wrongProblem = wrongRefusal({ wrong });
  if (wrongProblem !== undefined) {
    return wrongProblem;
  }
  const line = correction.trim();
  if (line.length === 0) {
    return "--correction is empty: say what is true now, in one line";
  }
  if (line === wrong) {
    return "--correction repeats --wrong word for word, so the line under the strike would restate the claim: say what is true now";
  }
  if (/[\r\n]/.test(correction)) {
    return "--correction spans more than one line: it is one line under the struck claim, never a second answer";
  }
  if (/[`~*_]/u.test(line)) {
    return "--correction carries `, ~, * or _, which the notification text reads as mrkdwn code or styling while the Correction block shows it literally: say it in plain words";
  }
  if (line.length > CORRECTION_MAX_CHARS) {
    return `--correction is ${String(line.length)} characters, over the ${String(CORRECTION_MAX_CHARS)} a single line under a struck claim takes`;
  }
  const markup = scanRawMarkup({ text: line });
  return markup.length > 0 ? rawMarkupRefusal({ span: markup[0]! }) : undefined;
}
