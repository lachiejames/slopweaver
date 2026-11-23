/**
 * The typed failures the `slack` drafting and sending lanes author: a form that is not JSON, a form the schema
 * refused, a domain form whose derived card is not one, a poll form that could not be read, a flag a no-fold
 * card is never asked, a write token that is absent or the other identity's, and the refusals an admission pass
 * forwards from the modules that wrote them.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to the `slack` verbs' delivery; argument
 * parsing is `../../cli/commands/slack/argumentErrors.ts`'s and the lifecycle `lifecycleErrors.ts`'s beside it. A list of
 * problems rides as `reasons`, and {@link slackDeliveryErrorLines} prints it one line each, as the
 * `readonly string[]` it replaced did.
 */
import type { Result } from "../../lib/result.js";
import type { SlackActor } from "./types.js";

/** A form was not JSON at all; `subject` names which form, `reason` is the parser's own complaint. */
export interface SlackDeliveryFormNotJsonError {
  readonly code: "FORM_NOT_JSON";
  readonly message: string;
  readonly subject: string;
  readonly reason: string;
}

/** A form parsed as JSON but its schema refused it; `reasons` is every violation, one line each. */
export interface SlackDeliveryFormInvalidError {
  readonly code: "FORM_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A domain form within its own limits derived a card that is not; `reasons` is the header then each violation. */
export interface SlackDeliveryDerivedCardInvalidError {
  readonly code: "DERIVED_CARD_INVALID";
  readonly message: string;
  readonly kind: string;
  readonly reasons: readonly string[];
}

/** The poll form's source could not be read at all. */
export interface SlackDeliveryFormUnreadableError {
  readonly code: "FORM_UNREADABLE";
  readonly message: string;
  readonly reason: string;
}

/** A flag this send refuses by name, because the card it would send is never asked what the flag answers. */
export interface SlackDeliveryFlagRefusedError {
  readonly code: "FLAG_REFUSED";
  readonly message: string;
  readonly flag: string;
}

/** No token is configured for the identity `actor` names. */
export interface SlackDeliveryTokenAbsentError {
  readonly code: "TOKEN_ABSENT";
  readonly message: string;
  readonly actor: SlackActor;
}

/** The token configured for `actor` is the other identity's, so sending with it would post as somebody else. */
export interface SlackDeliveryTokenWrongKindError {
  readonly code: "TOKEN_WRONG_KIND";
  readonly message: string;
  readonly actor: SlackActor;
}

/** Refusals another module authored, forwarded by an admission pass in the order it asked them. */
export interface SlackDeliveryUpstreamRefusedError {
  readonly code: "UPSTREAM_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every failure the delivery lanes in this directory author. */
export type SlackDeliveryError =
  | SlackDeliveryFormNotJsonError
  | SlackDeliveryFormInvalidError
  | SlackDeliveryDerivedCardInvalidError
  | SlackDeliveryFormUnreadableError
  | SlackDeliveryFlagRefusedError
  | SlackDeliveryTokenAbsentError
  | SlackDeliveryTokenWrongKindError
  | SlackDeliveryUpstreamRefusedError;

/** What a delivery step here answers: the value, or this union's typed refusal. */
export type SlackDelivery<T> = Result<T, SlackDeliveryError>;

/** What each identity's token refusals say, so the two lanes are data rather than two near-identical branches. */
const TOKEN_REFUSALS = {
  bot: {
    absent:
      "--as bot needs a Slack bot token: run `slopweaver secrets set slack-bot-token` " +
      "(or set SLACK_BOT_TOKEN), then confirm it with `slopweaver connect slack --check`",
    wrongKind:
      "--as bot requires a bot token (`xoxb-…`), but the configured bot token is not one — " +
      "refusing to post under an identity you did not ask for. `slopweaver connect slack --check` says which token is which",
  },
  me: {
    absent:
      "--as me needs a Slack USER token: run `slopweaver secrets set slack-user-token` " +
      "(or set SLACK_USER_TOKEN), then confirm it with `slopweaver connect slack --check`",
    wrongKind:
      "--as me requires a user token (`xoxp-…`), but the configured user token is not one — refusing to " +
      "post under an identity you did not ask for. A bot token cannot post under your name",
  },
} as const satisfies Record<SlackActor, { readonly absent: string; readonly wrongKind: string }>;

/** What a thrown `cause` says: an Error's own message, else the value as text. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A form that is not JSON, named. */
function notJson({ subject, reason }: { subject: string; reason: string }): SlackDeliveryFormNotJsonError {
  return { code: "FORM_NOT_JSON", message: `${subject} is not valid JSON: ${reason}`, reason, subject };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const SlackDeliveryErrors = {
  derivedCardInvalid: ({
    kind,
    remedy,
    violations,
  }: {
    kind: string;
    remedy: string;
    violations: readonly string[];
  }): SlackDeliveryDerivedCardInvalidError => {
    const reasons = [
      `this ${kind}'s fields are each within their own limits, but together they derive a card that is not. ` +
        `${remedy} If nothing below matches a field you can change, that IS a slopweaver bug — please report ` +
        "it with the form. Details:",
      ...violations,
    ];
    return { code: "DERIVED_CARD_INVALID", kind, message: reasons.join("; "), reasons };
  },
  formInvalid: ({ reasons }: { reasons: readonly string[] }): SlackDeliveryFormInvalidError => ({
    code: "FORM_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  formNotJson: ({ reason }: { reason: string }): SlackDeliveryFormNotJsonError =>
    notJson({ reason, subject: "--form" }),
  noFoldPictureReasonRefused: (): SlackDeliveryFlagRefusedError => ({
    code: "FLAG_REFUSED",
    flag: "--no-picture-because",
    message: "--no-picture-because answers a question a no-fold message is never asked. Remove it.",
  }),
  pollFormNotJson: ({ cause }: { cause: unknown }): SlackDeliveryFormNotJsonError =>
    notJson({ reason: causeText({ cause }), subject: "the poll form" }),
  pollFormUnreadable: ({ cause }: { cause: unknown }): SlackDeliveryFormUnreadableError => {
    const reason = causeText({ cause });
    return { code: "FORM_UNREADABLE", message: `cannot read the poll form: ${reason}`, reason };
  },
  tokenAbsent: ({ actor }: { actor: SlackActor }): SlackDeliveryTokenAbsentError => ({
    actor,
    code: "TOKEN_ABSENT",
    message: TOKEN_REFUSALS[actor].absent,
  }),
  tokenWrongKind: ({ actor }: { actor: SlackActor }): SlackDeliveryTokenWrongKindError => ({
    actor,
    code: "TOKEN_WRONG_KIND",
    message: TOKEN_REFUSALS[actor].wrongKind,
  }),
  upstreamRefused: ({ reasons }: { reasons: readonly string[] }): SlackDeliveryUpstreamRefusedError => ({
    code: "UPSTREAM_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
} as const;

/**
 * The lines a {@link SlackDeliveryError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display
 * reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function slackDeliveryErrorLines({ error }: { error: SlackDeliveryError }): readonly string[] {
  if (error.code === "FORM_INVALID" || error.code === "DERIVED_CARD_INVALID" || error.code === "UPSTREAM_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
