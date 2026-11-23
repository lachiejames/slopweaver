/**
 * Every way one `investigate` row can fail to become an ask on the lane, and the factory that builds each.
 *
 * Split out of `./investigate.ts` along the domain's own error seam, so the executor module stays about
 * planning and asking, and a refusal's wording is reviewed in one place.
 */
import { VOICE_RULES_ESCAPE } from "../../outbound/voice/exactRules.js";

/** The row's `params` are not an `investigate` configuration at all.
 *
 * @internal
 */
export interface InvestigateParamsInvalidError {
  readonly code: "PARAMS_INVALID";
  readonly message: string;
  readonly recipeId: string;
  readonly issues: readonly string[];
}

/** The question cannot be asked as one automation prompt — over the prompt's own cap, or the no-fold bound.
 *
 * @internal
 */
export interface InvestigateFormRefusedError {
  readonly code: "FORM_REFUSED";
  readonly message: string;
  readonly recipeId: string;
  readonly issues: readonly string[];
}

/** The question breaks a packing rule above the fold, so the door would refuse it at every firing.
 *
 * @internal
 */
export interface InvestigateVoiceRefusedError {
  readonly code: "VOICE_REFUSED";
  readonly message: string;
  readonly recipeId: string;
  readonly issues: readonly string[];
}

/** The door refused the question, or never answered that it had sent it.
 *
 * @internal
 */
export interface InvestigatePostFailedError {
  readonly code: "POST_FAILED";
  readonly message: string;
  readonly recipeId: string;
}

/** The post went through and its own report could not be read, so the ask has no address.
 *
 * @internal
 */
export interface InvestigateReportUnreadableError {
  readonly code: "REPORT_UNREADABLE";
  readonly message: string;
  readonly recipeId: string;
}

/**
 * The row would ask its question somewhere the whole team can read it.
 *
 * @internal
 */
export interface InvestigatePromptChannelPublicError {
  readonly code: "PROMPT_CHANNEL_PUBLIC";
  readonly message: string;
  readonly recipeId: string;
  /** Where the row wanted to ask. */
  readonly channel: string;
  /** The one conversation configured to hold a prompt, absent when the install has configured none. */
  readonly promptChannel: string | undefined;
}

/** Every way one `investigate` row can fail to become an ask on the lane. */
export type InvestigateError =
  | InvestigatePromptChannelPublicError
  | InvestigateParamsInvalidError
  | InvestigateFormRefusedError
  | InvestigateVoiceRefusedError
  | InvestigatePostFailedError
  | InvestigateReportUnreadableError;

/**
 * Where a row's own definition file sits, RELATIVE to the state home.
 *
 * Relative rather than absolute because this module is pure and holds no `home` — and a relative path is
 * enough to act on, which is the whole point. A blocked refusal that does not say why is not helpful to an
 * agent: humans and agents both need information. A refusal telling a reader to edit "the row's own definition file" without naming it makes
 * them read `stateHome.ts` to act on their own dead-letter row, which a review pass found by asking what a
 * cold reader could actually do with the sentence.
 *
 * The segments mirror `stateHome.ts`'s `live.recipe.definitionsDir`, which is the one authority; they are
 * restated here rather than imported because importing the whole state-home resolver into a pure module to
 * build one display string would be the larger wrong.
 */
function definitionPathOf({ recipeId }: { readonly recipeId: string }): string {
  return `live/recipe/definitions/${recipeId}.json`;
}

/**
 * The refusal for a row that would ask its question where a team can read it.
 *
 * Four things, in the order the reader needs them: what caught it and why, the file to edit, the exact edit,
 * and that there is deliberately no override. The last line is the `hold` shape
 * (`../../visualEvidence/errors.ts`) rather than the four-line hatch shape, and the reason is stated rather
 * than left to inference: an escape hatch here would be a documented way to post the bot's own instructions
 * into a team channel, which is the exact act the private-prompt rule forbids.
 *
 * @param channel where the row wanted to ask
 * @param promptChannel the configured private conversation, absent when the install has configured none
 * @param recipeId the row, so the refusal names something a reader can open
 * @returns the whole refusal as one message
 */
function promptChannelMessage({
  channel,
  promptChannel,
  recipeId,
}: {
  readonly channel: string;
  readonly promptChannel: string | undefined;
  readonly recipeId: string;
}): string {
  const where = definitionPathOf({ recipeId });
  if (promptChannel === undefined) {
    return (
      `recipe '${recipeId}' would ask its question in ${channel}, and no \`slackBot.promptChannel\` is set in ` +
      "profile.json, so there is nowhere private to ask it. An automation's question is the bot's own " +
      "instructions, and a team reading them is a team reading what the bot was told to do. Set " +
      "`slackBot.promptChannel` to the conversation only you and the bot read. There is deliberately NO " +
      "override, because one would be a documented way to do the thing this refuses"
    );
  }
  return (
    `recipe '${recipeId}' would ask its question in ${channel}, which is not the configured prompt ` +
    `conversation ${promptChannel}. An automation's question is the bot's own instructions, and a team ` +
    "reading them is a team reading what the bot was told to do. " +
    `Set \`params.channel\` to ${promptChannel} in ${where} under your state ` +
    `home, and put ${channel} in \`params.postTo\` so the finished card still lands there. There is ` +
    "deliberately NO override, because one would be a documented way to do the thing this refuses"
  );
}

/**
 * Construct one {@link InvestigateError}. Tests build fixtures through these, never a hand-built literal.
 *
 * @internal
 */
export const InvestigateErrors = {
  formRefused: ({
    recipeId,
    issues,
  }: {
    readonly recipeId: string;
    readonly issues: readonly string[];
  }): InvestigateFormRefusedError => ({
    code: "FORM_REFUSED",
    issues,
    message:
      `recipe '${recipeId}' cannot ask its question as one automation prompt: ${issues.join("; ")} — the ` +
      "opening message is the ask's own address, so it is asked in full or not at all. The question is row " +
      `state, so shorten \`params.question\` in ${definitionPathOf({ recipeId })} under your state home`,
    recipeId,
  }),
  promptChannelPublic: ({
    recipeId,
    channel,
    promptChannel,
  }: {
    readonly recipeId: string;
    readonly channel: string;
    readonly promptChannel: string | undefined;
  }): InvestigatePromptChannelPublicError => ({
    channel,
    code: "PROMPT_CHANNEL_PUBLIC",
    message: promptChannelMessage({ channel, promptChannel, recipeId }),
    promptChannel,
    recipeId,
  }),
  paramsInvalid: ({
    recipeId,
    issues,
  }: {
    readonly recipeId: string;
    readonly issues: readonly string[];
  }): InvestigateParamsInvalidError => ({
    code: "PARAMS_INVALID",
    issues,
    message: `recipe '${recipeId}' is not a runnable investigate row: ${issues.join("; ")}`,
    recipeId,
  }),
  postFailed: ({
    recipeId,
    channel,
    why,
  }: {
    readonly recipeId: string;
    readonly channel: string;
    readonly why: string;
  }): InvestigatePostFailedError => ({
    code: "POST_FAILED",
    message: `recipe '${recipeId}' could not ask its question in ${channel}: ${why}`,
    recipeId,
  }),
  reportUnreadable: ({
    recipeId,
    why,
  }: {
    readonly recipeId: string;
    readonly why: string;
  }): InvestigateReportUnreadableError => ({
    code: "REPORT_UNREADABLE",
    message: `recipe '${recipeId}' asked its question and could not read where it landed: ${why}`,
    recipeId,
  }),
  voiceRefused: ({
    recipeId,
    issues,
  }: {
    readonly recipeId: string;
    readonly issues: readonly string[];
  }): InvestigateVoiceRefusedError => ({
    code: "VOICE_REFUSED",
    issues,
    message:
      `recipe '${recipeId}' asks a question the above-the-fold gate refuses: ${issues.join("; ")} — the ` +
      `question is row state, so rewrite \`params.question\` in ${definitionPathOf({ recipeId })} under your ` +
      "state home. A wording the door refuses is refused at every firing, not once. For one deliberate " +
      `firing, ${VOICE_RULES_ESCAPE} asks the question unchanged, exactly as the grant lifts the same ` +
      "refusal at the door",
    recipeId,
  }),
} as const;
