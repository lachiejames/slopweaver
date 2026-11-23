/**
 * Every way `slopweaver slack status` refuses, as one discriminated union and its factory. The shell prints
 * `message`; a test branches on `code`. Scoped to this verb alone — no other Slack verb shares it.
 */

/** The four Slack methods the verb calls, which is also what a `missing_scope` is judged against. */
export type StatusSlackMethod = "users.profile.set" | "users.setPresence" | "users.profile.get" | "users.getPresence";

/** The sub-commands `slack status` takes. */
export type StatusSubcommand = "set" | "clear" | "show" | "presence";

/** Every refusal the verb can print. */
export type SlackStatusError =
  | { readonly code: "SUBCOMMAND_UNKNOWN"; readonly message: string; readonly got: string | undefined }
  | { readonly code: "FLAGS_REJECTED"; readonly message: string; readonly problems: readonly string[] }
  | { readonly code: "FLAG_NOT_FOR_SUBCOMMAND"; readonly message: string; readonly flag: string }
  | { readonly code: "STATUS_EMPTY"; readonly message: string }
  | { readonly code: "TEXT_TOO_LONG"; readonly message: string; readonly chars: number }
  | { readonly code: "EMOJI_MALFORMED"; readonly message: string; readonly emoji: string }
  | { readonly code: "UNTIL_UNPARSEABLE"; readonly message: string; readonly raw: string }
  | { readonly code: "UNTIL_NEEDS_ZONE"; readonly message: string }
  | { readonly code: "ZONE_UNKNOWN"; readonly message: string; readonly zone: string }
  | { readonly code: "UNTIL_NOT_FUTURE"; readonly message: string; readonly untilIso: string }
  | { readonly code: "PRESENCE_INVALID"; readonly message: string; readonly raw: string | undefined }
  | { readonly code: "TOKEN_ABSENT"; readonly message: string }
  | { readonly code: "TOKEN_WRONG_KIND"; readonly message: string }
  | { readonly code: "SCOPE_MISSING"; readonly message: string; readonly scope: string; readonly method: string }
  | { readonly code: "EMOJI_NOT_ALLOWED"; readonly message: string; readonly emoji: string }
  | { readonly code: "SLACK_REJECTED"; readonly message: string; readonly method: string; readonly slackError: string }
  | {
      readonly code: "READBACK_FAILED";
      readonly message: string;
      readonly wrote: StatusSlackMethod;
      readonly reason: string;
      readonly next: string | undefined;
    }
  | {
      readonly code: "READBACK_MISMATCH";
      readonly message: string;
      readonly field: string;
      readonly asked: string;
      readonly held: string;
    };

/** Which scope each method needs — what a `missing_scope` from it is naming. */
const SCOPE_OF: Readonly<Record<StatusSlackMethod, string>> = {
  "users.getPresence": "users:read",
  "users.profile.get": "users.profile:read",
  "users.profile.set": "users.profile:write",
  "users.setPresence": "users:write",
};

/** The one step that grants a scope to the user token, and the command that proves it arrived. */
const RECONSENT =
  "add it to the Slack app's User Token Scopes and reinstall (a workspace admin may have to approve), then, " +
  "if Slack issued a new user token, run `slopweaver secrets set slack-user-token`; confirm with " +
  "`slopweaver slack probe --method auth.test --scopes`";

/** The factory — the ONLY place these messages are worded. */
export const SlackStatusErrors = {
  emojiMalformed: ({ emoji }: { emoji: string }): SlackStatusError => ({
    code: "EMOJI_MALFORMED",
    emoji,
    message: `--emoji must be one emoji name between colons, like :palm_tree: (got ${JSON.stringify(emoji)})`,
  }),
  emojiNotAllowed: ({ emoji, slackCode }: { emoji: string; slackCode: string }): SlackStatusError => ({
    code: "EMOJI_NOT_ALLOWED",
    emoji,
    message: `Slack refused ${emoji} as a status emoji (${slackCode}). Nothing was changed.`,
  }),
  flagNotForSubcommand: ({ flag, sub }: { flag: string; sub: StatusSubcommand }): SlackStatusError => ({
    code: "FLAG_NOT_FOR_SUBCOMMAND",
    flag,
    message: `--${flag} does not apply to \`slack status ${sub}\``,
  }),
  flagsRejected: ({ problems }: { problems: readonly string[] }): SlackStatusError => ({
    code: "FLAGS_REJECTED",
    message: problems.join("; "),
    problems,
  }),
  presenceInvalid: ({ raw }: { raw: string | undefined }): SlackStatusError => ({
    code: "PRESENCE_INVALID",
    message: `slack status presence needs --to away or --to auto (got ${JSON.stringify(raw)})`,
    raw,
  }),
  readbackFailed: ({
    next,
    reason,
    wrote,
  }: {
    next: string | undefined;
    reason: string;
    wrote: StatusSlackMethod;
  }): SlackStatusError => {
    let message =
      `Slack accepted ${wrote}, but reading it back failed (${reason}), so the change has most likely landed ` +
      "unconfirmed — check it with `slopweaver slack status show`";
    if (next !== undefined) {
      message += `; ${next}`;
    }
    return { code: "READBACK_FAILED", message, next, reason, wrote };
  },
  readbackMismatch: ({
    asked,
    field,
    held,
    next,
  }: {
    asked: string;
    field: string;
    held: string;
    next: string | undefined;
  }): SlackStatusError => {
    let message =
      `Slack accepted the write but reads ${field} back as ${JSON.stringify(held)}, not the ` +
      `${JSON.stringify(asked)} that was sent — check it with \`slopweaver slack status show\``;
    if (next !== undefined) {
      message += `; ${next}`;
    }
    return { asked, code: "READBACK_MISMATCH", field, held, message };
  },
  scopeMissing: ({ method }: { method: StatusSlackMethod }): SlackStatusError => ({
    code: "SCOPE_MISSING",
    message: `${method} needs ${SCOPE_OF[method]} on your user token, which it does not hold. Nothing was changed. To grant it: ${RECONSENT}.`,
    method,
    scope: SCOPE_OF[method],
  }),
  slackRejected: ({ method, slackError }: { method: StatusSlackMethod; slackError: string }): SlackStatusError => ({
    code: "SLACK_REJECTED",
    message: `${method} failed: ${slackError}`,
    method,
    slackError,
  }),
  statusEmpty: (): SlackStatusError => ({
    code: "STATUS_EMPTY",
    message: "slack status set needs --text, --emoji or both; use `slack status clear` to remove a status",
  }),
  subcommandUnknown: ({ got }: { got: string | undefined }): SlackStatusError => ({
    code: "SUBCOMMAND_UNKNOWN",
    got,
    message: `slack status takes one sub-command: set, clear, show or presence (got ${JSON.stringify(got)})`,
  }),
  textTooLong: ({ chars, max }: { chars: number; max: number }): SlackStatusError => ({
    chars,
    code: "TEXT_TOO_LONG",
    message: `--text is ${String(chars)} characters and Slack holds at most ${String(max)}; it is refused rather than cut`,
  }),
  tokenAbsent: (): SlackStatusError => ({
    code: "TOKEN_ABSENT",
    message:
      "slack status runs on YOUR user token (xoxp-) and none is stored — `slopweaver secrets status` names it, " +
      "`slopweaver secrets set slack-user-token` stores it",
  }),
  tokenWrongKind: (): SlackStatusError => ({
    code: "TOKEN_WRONG_KIND",
    message:
      "the configured Slack user token (SLACK_USER_TOKEN, else the stored slack-user-token) is not a user token " +
      "(xoxp-); a status is yours and only that token can set it",
  }),
  untilNeedsZone: (): SlackStatusError => ({
    code: "UNTIL_NEEDS_ZONE",
    message: "--until end-of-day needs --zone <IANA zone>, e.g. --zone Australia/Melbourne; the day is never guessed",
  }),
  untilNotFuture: ({ untilIso }: { untilIso: string }): SlackStatusError => ({
    code: "UNTIL_NOT_FUTURE",
    message: `--until ${untilIso} is not in the future, so the status would expire the moment it was set`,
    untilIso,
  }),
  untilUnparseable: ({ raw }: { raw: string }): SlackStatusError => ({
    code: "UNTIL_UNPARSEABLE",
    message:
      `--until takes end-of-day (with --zone) or an ISO instant carrying Z or an offset, like ` +
      `2026-09-26T00:00:00+10:00 (got ${JSON.stringify(raw)})`,
    raw,
  }),
  zoneUnknown: ({ zone }: { zone: string }): SlackStatusError => ({
    code: "ZONE_UNKNOWN",
    message: `--zone ${JSON.stringify(zone)} is not an IANA zone this runtime knows`,
    zone,
  }),
} as const;
