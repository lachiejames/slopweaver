/**
 * The DOOR's half of "an automation's prompt never posts into a team channel".
 *
 * `outbound/artifact/automationPrompt.ts` makes the payload declare what it is; this module is what the
 * declaration BUYS. A `automation-prompt` form is the bot's own instructions, so it is admitted into the
 * one conversation configured to hold them (`slackBot.promptChannel`) and refused everywhere else, at the
 * wire, whichever caller composed it.
 *
 * ## There is no hatch, and the refusal says so
 *
 * A policy refusal in this repository normally carries four lines and a `SLOPWEAVER_ALLOW_*` key
 * (`.claude/rules/error-handling.md`). This one carries none, on the `hold` precedent
 * `src/visualEvidence/errors.ts` already states: an override here would be a documented way to post the
 * bot's own instructions into a team channel, which is the exact act the chair deleted from
 * a team channel once. Silence about the absence reads as a forgotten hatch,
 * so the text names it — and names the fix instead, which is a `postTo` on the row rather than a waiver:
 * the team channel still gets the finished card, it just stops getting the instructions that produce one.
 *
 * ## Absent config REFUSES
 *
 * An install that has configured no prompt conversation has nowhere private to ask, so it may not ask at
 * all. That is the same fail-closed arm `./renderProof.ts`'s `unconfiguredProofRefusal` takes, and for the
 * same reason: the alternative is inventing a destination nobody chose.
 */
import { AUTOMATION_PROMPT_KIND } from "../artifact/automationPrompt.js";
import type { NoFoldRecurrence } from "./types.js";

/**
 * Whether this send is an automation prompt, and so subject to the check below.
 *
 * Its own function because the discriminant is a string the door compares rather than a type it narrows —
 * naming the comparison keeps the one place that knows what a prompt payload is called from spreading.
 *
 * @param formKind the `BOT_FORM_KINDS` entry that parsed this payload
 * @returns true when the payload declared itself the bot's own instructions
 */
export function isAutomationPrompt({ formKind }: { formKind: string }): boolean {
  return formKind === AUTOMATION_PROMPT_KIND;
}

/**
 * Whether a no-fold send's words recur by design, derived from the form that parsed it.
 *
 * A prompt is asked verbatim at every firing of its row, so the repeat guard must not refuse its second day;
 * every other no-fold message is judged. Decided here, beside {@link isAutomationPrompt}, so the form
 * kind is compared in one module and the channel refusal below is what confines the exemption to the owner's DM.
 *
 * @param formKind the `BOT_FORM_KINDS` entry that parsed this payload
 * @returns `automation-prompt` for a prompt, `once` for everything else
 */
export function noFoldRecurrenceOf({ formKind }: { formKind: string }): NoFoldRecurrence {
  if (isAutomationPrompt({ formKind })) {
    return "automation-prompt";
  }
  return "once";
}

/**
 * Refuse an automation prompt aimed anywhere but the configured private prompt conversation.
 *
 * Returns an EMPTY list for every payload that is not a prompt, so a caller may ask unconditionally — the
 * alternative is a caller-side `if` on the form kind, which is the branch that gets forgotten.
 *
 * @param formKind the `BOT_FORM_KINDS` entry that parsed this payload
 * @param channel where this send is aimed
 * @param promptChannel the one conversation `slackBot.promptChannel` names, absent on an install with none
 * @returns the refusal lines, or nothing when the send may proceed
 */
export function automationPromptChannelRefusal({
  formKind,
  channel,
  promptChannel,
}: {
  formKind: string;
  channel: string;
  promptChannel: string | undefined;
}): readonly string[] {
  if (!isAutomationPrompt({ formKind })) {
    return [];
  }
  if (promptChannel === undefined) {
    return [
      "this is an automation's PROMPT — the bot's own instructions — and no `slackBot.promptChannel` is " +
        "set in profile.json, so there is nowhere private to ask it. Set it to the conversation only you " +
        "and the bot read (the bot's own DM is the intended one). There is deliberately NO override: a " +
        "prompt posted where a team can read it is the room seeing what the bot was told to do.",
    ];
  }
  if (channel === promptChannel) {
    return [];
  }
  return [
    `this is an automation's PROMPT — the bot's own instructions — aimed at ${channel}, which is not the ` +
      `configured prompt conversation ${promptChannel}. A team reading a prompt is the team reading what ` +
      "the bot was told to do, which is what the chair once deleted from a channel.",
    `Ask it in ${promptChannel} instead, and name the team channel in the row's \`params.postTo\` — the ` +
      "finished card still lands there, and only the card does.",
    "There is deliberately NO escape hatch here, and that is not an omission: an override would be a " +
      "documented way to do the thing this refusal exists to prevent.",
  ];
}
