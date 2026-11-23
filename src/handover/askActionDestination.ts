/**
 * One DESTINATION's own rules — the half of {@link ./askAction.ts} that is about a place rather than about
 * the message, split out because the two are genuinely different subjects and neither file fits both.
 *
 * `./askAction.ts` asks whether the drafted message is one the owner can read and whether the card would describe
 * it truthfully. This file asks whether each place it could go is a real place the send verb could reach:
 * an id the provider would accept, a thread root that is a `ts` rather than an instant, a direct-message
 * conversation that is already OPEN — `slopweaver slack dm open --with <people>` is what opens one, and
 * drawing a preview must never be what creates a conversation.
 *
 * Pure: no filesystem, no clock.
 */

import type { AskDestination, AskMention } from "./askAction.js";
import { authoredOptionLetter } from "./askOptionLabel.js";

/** The longest a destination's or a person's human label may run, in characters. */
export const ACTION_LABEL_MAX_CHARS = 60;

/** The most people one direct message may reach — a group DM, never a broadcast. */
export const ACTION_MAX_RECIPIENTS = 8;

/** A Slack channel, group or direct-message conversation id, as the provider spells one. */
const CONVERSATION_ID = /^[CGD][A-Z0-9]{2,}$/u;

/** A Slack member id. */
export const MEMBER_ID = /^[UW][A-Z0-9]{2,}$/u;

/** A Slack `ts` as an IDENTIFIER — seconds and microseconds, never scaled into an instant. */
const SLACK_TS = /^[0-9]{10}\.[0-9]{6}$/u;

/**
 * What makes two destinations the same place, so an action cannot offer one twice.
 *
 * A channel and a thread IN that channel are different places and must not collide, which is why the kind
 * is part of the key rather than the conversation alone.
 *
 * @param destination the place
 * @returns a string equal for two destinations a reader would call the same
 */
export function destinationKey({ destination }: { destination: AskDestination }): string {
  if (destination.kind === "dm") {
    return `dm:${destination.conversation}`;
  }
  if (destination.kind === "thread") {
    return `thread:${destination.channel}:${destination.threadTs}`;
  }
  return `channel:${destination.channel}`;
}

/**
 * Every way a label breaks its own rule, empty when it is well-formed.
 *
 * @param what how a refusal names the thing the label is on
 * @returns one sentence per rule it broke
 */
export function labelProblems({ label, what }: { label: string; what: string }): readonly string[] {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    return [`${what} has no label — the card shows a name, never a raw id`];
  }
  if (trimmed.length > ACTION_LABEL_MAX_CHARS) {
    return [
      `${what}'s label runs ${String(trimmed.length)} characters against a cap of ` +
        `${String(ACTION_LABEL_MAX_CHARS)} — it sits on one line of the card`,
    ];
  }
  return [];
}

/**
 * Every way a list of people breaks a rule, empty when it is well-formed.
 *
 * @param what how a refusal names one of them — `a mention`, `a recipient`
 * @returns one sentence per rule the list broke
 */
export function peopleProblems({ people, what }: { people: readonly AskMention[]; what: string }): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const person of people) {
    if (!MEMBER_ID.test(person.userId)) {
      problems.push(`${person.userId} is not a Slack member id`);
    }
    if (seen.has(person.userId)) {
      problems.push(`${person.userId} is named twice as ${what}`);
    }
    seen.add(person.userId);
    problems.push(...labelProblems({ label: person.label, what: `${what} (${person.userId})` }));
  }
  return problems;
}

/** Every way one direct-message destination breaks a rule, empty when it is well-formed. */
function dmProblems({ destination }: { destination: Extract<AskDestination, { kind: "dm" }> }): readonly string[] {
  const problems: string[] = [];
  if (!CONVERSATION_ID.test(destination.conversation)) {
    problems.push(
      `${destination.conversation} is not an open Slack conversation — ` +
        "`slopweaver slack dm open --with <people>` is what opens one, and a preview never does",
    );
  }
  if (destination.recipients.length === 0) {
    problems.push("the direct message names nobody");
  }
  if (destination.recipients.length > ACTION_MAX_RECIPIENTS) {
    problems.push(
      `the direct message names ${String(destination.recipients.length)} people against a cap of ` +
        `${String(ACTION_MAX_RECIPIENTS)} — past that it is a channel post wearing a DM's clothes`,
    );
  }
  problems.push(...peopleProblems({ people: destination.recipients, what: "a recipient" }));
  return problems;
}

/**
 * A destination label that opens with its own option letter — refused when an action is WRITTEN, never when one is
 * read, so an action already on disk still reads. Its label is drawn as an option sentence
 * beside the positional letter (`./askOptionLabel.ts`), so a typed one draws two.
 *
 * @param destination the place the drafted message could go
 * @returns the refusal, or `undefined` when the label carries no letter of its own
 */
export function destinationLetterProblem({ destination }: { destination: AskDestination }): string | undefined {
  const typed = authoredOptionLetter({ text: destination.label });
  if (typed === undefined) {
    return undefined;
  }
  return (
    `the ${destination.kind}'s label opens with its own letter "${typed}", but options are lettered by position, so ` +
    `the card would draw two — drop the letter, and name an option in \`--lean\` by the letter its position gives it`
  );
}

/**
 * Every way one destination breaks a rule, empty when it is well-formed.
 *
 * @param destination the place the drafted message could go
 * @returns one sentence per rule it broke
 */
export function destinationProblems({ destination }: { destination: AskDestination }): readonly string[] {
  const problems: string[] = [...labelProblems({ label: destination.label, what: `the ${destination.kind}` })];
  if (destination.tradeoff.trim().length === 0) {
    problems.push(`the ${destination.kind} carries no trade-off — every option on a card says what it costs`);
  }
  if (destination.kind === "dm") {
    return [...problems, ...dmProblems({ destination })];
  }
  if (!CONVERSATION_ID.test(destination.channel)) {
    problems.push(`${destination.channel} is not a Slack conversation id — the card links and the verb posts by id`);
  }
  if (destination.kind === "thread" && !SLACK_TS.test(destination.threadTs)) {
    problems.push(`${destination.threadTs} is not a Slack ts — a reply binds to the thread root by its own id`);
  }
  return problems;
}
