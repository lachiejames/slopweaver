/**
 * `slack status` — what the verb SAYS, pure: the dry-run and held lines, the `--json` presence document, the
 * read-back comparison, and the refusal for every failure. Split from `./statusCore.ts`, which parses.
 *
 * Every line here must be true of what happened. A write Slack accepted is never reported as "nothing was
 * changed", and a manual away that may be held always names its undo — nothing else ever reverses one.
 */
import type { StatusProfilePlan } from "./statusCore.js";
import { type SlackStatusError, SlackStatusErrors, type StatusSlackMethod } from "./statusErrors.js";

/** The one command that reverses a manual away — nothing else ever will. */
export const UNDO_MANUAL_AWAY = "slopweaver slack status presence --to auto";

/**
 * What a reader does next about a status write that did not confirm. `clear` REMOVES whatever status is
 * held rather than restoring an earlier one, so it is worded as removal, never as an undo.
 *
 * @param operation which write was sent
 * @returns the follow-up, or undefined after a clear, which left nothing to remove
 */
export function statusFollowUp({ operation }: { operation: "set" | "clear" }): string | undefined {
  return operation === "set" ? "remove it with `slopweaver slack status clear`" : undefined;
}

/**
 * What a reader does next about a presence write that did not confirm: a manual away that may be held always
 * names its undo.
 *
 * @param awayMayBeHeld whether a manual away could now be held
 * @returns the follow-up, or undefined when no manual away can be held
 */
export function presenceFollowUp({ awayMayBeHeld }: { awayMayBeHeld: boolean }): string | undefined {
  return awayMayBeHeld ? `undo a manual away with \`${UNDO_MANUAL_AWAY}\`` : undefined;
}

/**
 * Presence as `--json` carries it: what Slack holds, plus the undo whenever it is a manual away, so a machine
 * reader gets the same reversal the readable lines print.
 *
 * @param held the presence read back from Slack
 * @returns the JSON document's presence value
 */
export function presenceDocument({
  held,
}: {
  held: { readonly presence: "active" | "away"; readonly manualAway: boolean; readonly online: boolean };
}): Readonly<Record<string, unknown>> {
  if (held.manualAway) {
    return { ...held, undo: UNDO_MANUAL_AWAY };
  }
  return { ...held };
}

/**
 * The dry run of a status write.
 *
 * @param plan the decided write
 * @param expiry the expiry already rendered for a reader
 * @returns the lines to print
 */
export function statusDryRunLines({ plan, expiry }: { plan: StatusProfilePlan; expiry: string }): readonly string[] {
  return [
    "DRY RUN — nothing was changed. On YOUR Slack profile, slopweaver would:",
    `  users.profile.set status_text=${JSON.stringify(plan.statusText)} status_emoji=${JSON.stringify(plan.statusEmoji)} ` +
      `status_expiration=${String(plan.expirationSeconds)}`,
    `  expires: ${expiry}`,
  ];
}

/**
 * The dry run of a presence write.
 *
 * @param presence the presence to set
 * @returns the lines to print
 */
export function presenceDryRunLines({ presence }: { presence: "away" | "auto" }): readonly string[] {
  return [
    "DRY RUN — nothing was changed. On YOUR Slack account, slopweaver would:",
    `  users.setPresence presence=${presence}`,
  ];
}

/**
 * What Slack holds now, as a reader wants it.
 *
 * @param held the status read back from Slack
 * @param expiry the expiry already rendered for a reader
 * @returns the lines to print
 */
export function statusHeldLines({
  held,
  expiry,
}: {
  held: { readonly text: string; readonly emoji: string };
  expiry: string;
}): readonly string[] {
  if (held.text === "" && held.emoji === "") {
    return ["your Slack status: none"];
  }
  return [
    `your Slack status: ${[held.emoji, held.text].filter((part) => part !== "").join(" ")}`,
    `  expires: ${expiry}`,
  ];
}

/**
 * Presence as a reader wants it. A manual away always carries its own reversal, because nothing else will
 * ever undo it.
 *
 * @param held the presence read back from Slack
 * @returns the lines to print
 */
export function presenceHeldLines({
  held,
}: {
  held: { readonly presence: "active" | "away"; readonly manualAway: boolean };
}): readonly string[] {
  if (held.manualAway) {
    return ["your Slack presence: away (manual — it stays away until you undo it)", `  undo: ${UNDO_MANUAL_AWAY}`];
  }
  return [`your Slack presence: ${held.presence} (automatic — Slack sets it from your activity)`];
}

/**
 * Whether Slack's read-back matches the write that was sent.
 *
 * @param plan the write that was sent
 * @param held what Slack now reports
 * @returns the first field that differs, or undefined when the write landed as sent
 */
export function statusReadbackMismatch({
  plan,
  held,
}: {
  plan: StatusProfilePlan;
  held: { readonly text: string; readonly emoji: string; readonly expirationSeconds: number };
}): SlackStatusError | undefined {
  const next = statusFollowUp({ operation: plan.operation });
  if (held.text !== plan.statusText) {
    return SlackStatusErrors.readbackMismatch({ asked: plan.statusText, field: "status_text", held: held.text, next });
  }
  if (held.emoji !== plan.statusEmoji) {
    return SlackStatusErrors.readbackMismatch({
      asked: plan.statusEmoji,
      field: "status_emoji",
      held: held.emoji,
      next,
    });
  }
  if (held.expirationSeconds !== plan.expirationSeconds) {
    return SlackStatusErrors.readbackMismatch({
      asked: String(plan.expirationSeconds),
      field: "status_expiration",
      held: String(held.expirationSeconds),
      next,
    });
  }
  return undefined;
}

/**
 * Whether Slack's read-back matches a presence write. `away` must read as a manual away; `auto` must not.
 *
 * @param presence the presence that was sent
 * @param manualAway whether Slack now reports a manual away
 * @returns the refusal, or undefined when it landed
 */
export function presenceReadbackMismatch({
  presence,
  manualAway,
}: {
  presence: "away" | "auto";
  manualAway: boolean;
}): SlackStatusError | undefined {
  if ((presence === "away") === manualAway) {
    return undefined;
  }
  return SlackStatusErrors.readbackMismatch({
    asked: presence,
    field: "manual_away",
    held: String(manualAway),
    next: presenceFollowUp({ awayMayBeHeld: manualAway }),
  });
}

/**
 * The refusal for a write Slack ACCEPTED whose read-back then failed. The write's own refusal would say
 * "Nothing was changed", which is exactly wrong here — so this names the write, why the read failed, and the
 * one follow-up that removes or reverses it when there is one.
 *
 * @param wrote the write Slack accepted
 * @param cause the read-back's own refusal
 * @param next what a reader does about a write that may have landed, from `statusFollowUp`/`presenceFollowUp`
 * @returns the refusal
 */
export function readbackFailure({
  wrote,
  cause,
  next,
}: {
  wrote: StatusSlackMethod;
  cause: SlackStatusError;
  next: string | undefined;
}): SlackStatusError {
  const reason = cause.code === "SCOPE_MISSING" ? `${cause.method} needs ${cause.scope}` : cause.message;
  return SlackStatusErrors.readbackFailed({ next, reason, wrote });
}

/** The Slack error codes that mean "not an emoji a status may carry", named back exactly as Slack sent them. */
const EMOJI_REFUSAL_CODES = ["invalid_emoji_not_allowed", "profile_status_set_failed_not_valid_emoji"] as const;

/**
 * Turn a thrown Slack failure into the refusal a reader can act on. A `missing_scope` names the scope that
 * method needs and how to grant it; an emoji Slack will not take names the emoji.
 *
 * @param method the Slack method that failed
 * @param message the thrown error's message, which carries Slack's own error code
 * @param emoji the emoji that was sent, for Slack's emoji refusal
 * @returns the refusal
 */
export function classifyStatusFailure({
  method,
  message,
  emoji,
}: {
  method: StatusSlackMethod;
  message: string;
  emoji: string;
}): SlackStatusError {
  if (message.includes("missing_scope")) {
    return SlackStatusErrors.scopeMissing({ method });
  }
  const emojiCode = EMOJI_REFUSAL_CODES.find((code) => message.includes(code));
  if (emojiCode !== undefined) {
    return SlackStatusErrors.emojiNotAllowed({ emoji, slackCode: emojiCode });
  }
  return SlackStatusErrors.slackRejected({ method, slackError: message });
}

/**
 * The line a failed `users.setPresence` prints. Only a missing scope is known to have changed nothing. A
 * transport failure is retried, so a failed `away` may have landed; and a failed `auto` leaves any manual
 * away where it was. Either way the reader is told the away may be held, and how to check and undo it.
 *
 * @param presence the presence that was sent
 * @param error the write's own refusal
 * @returns the line to print
 */
export function presenceWriteFailureLine({
  presence,
  error,
}: {
  presence: "away" | "auto";
  error: SlackStatusError;
}): string {
  if (error.code === "SCOPE_MISSING" && presence === "away") {
    return error.message;
  }
  const check = "check with `slopweaver slack status show`";
  if (presence === "away") {
    return `${error.message} — if it landed anyway, ${check} and undo it with \`${UNDO_MANUAL_AWAY}\``;
  }
  return `${error.message} — a manual away may still be held; ${check}, and retry \`${UNDO_MANUAL_AWAY}\` to undo it`;
}

/**
 * The line a failed `users.profile.set` prints. A refusal Slack named changed nothing; a transport failure is
 * retried, so the write may have landed anyway, and the reader is told how to check it and what to run next.
 *
 * @param operation which write was sent
 * @param error the write's own refusal
 * @returns the line to print
 */
export function statusWriteFailureLine({
  operation,
  error,
}: {
  operation: "set" | "clear";
  error: SlackStatusError;
}): string {
  if (error.code !== "SLACK_REJECTED") {
    return error.message;
  }
  const check = "check with `slopweaver slack status show`";
  if (operation === "set") {
    return `${error.message} — if it landed anyway, ${check} and remove it with \`slopweaver slack status clear\``;
  }
  return `${error.message} — the earlier status may still be held; ${check}, and retry \`slopweaver slack status clear\``;
}
