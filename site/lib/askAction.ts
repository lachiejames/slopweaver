/**
 * The exact command that would SEND one drafted destination — and nothing that sends it.
 *
 * ## Why a copyable line and not a button
 *
 * `./actVerbs.ts` is a closed allowlist, and its own header states the rule this file obeys: a verb that
 * reaches a provider without its own dry-run and refusal shown first may not be a row there yet. A Slack
 * post under the owner's name is the most outward-facing act on the surface, so it gets the treatment
 * `../components/console/SlackThread.tsx`'s composer already gives a thread reply — the real command,
 * rendered, copyable, run by a session or by the owner, never pressed on a web page. Making these rows pressable
 * is capability work with its own dry-run, and it is owed rather than missing.
 *
 * ## The heredoc delimiter is CHOSEN, not assumed
 *
 * A draft is the owner's prose and may contain the word `EOF` — a reviewer's message about an end-of-file marker
 * is not a hypothetical. A `<<'EOF'` whose body carries a bare `EOF` line silently truncates the message
 * at that line and the shell then reads the rest as commands, which is a send of the wrong text at best.
 * {@link heredocDelimiter} walks a fixed family until one appears nowhere in the body, so the command is
 * correct for any draft rather than for most of them.
 *
 * Imports NOTHING from `src/` — `./queueCard.ts`'s header carries why (the root tsconfig excludes `site`,
 * so one such import turns `yarn typecheck` red for a reason that has nothing to do with the change).
 */

import type { BoardRowAction, BoardRowDestination } from "../components/live/readAction";

/** The delimiters tried in order. The first is the idiom; the rest exist for a draft that contains it. */
const DELIMITERS: readonly string[] = ["EOF", "SLOPWEAVER_EOF", "SLOPWEAVER_BODY_END"];

/**
 * A heredoc delimiter that appears on no line of the body.
 *
 * @param body the drafted message
 * @returns the first safe delimiter, or one with a counter appended when every declared one collides
 */
export function heredocDelimiter({ body }: { body: string }): string {
  const lines = new Set(body.split("\n").map((line) => line.trim()));
  for (const candidate of DELIMITERS) {
    if (!lines.has(candidate)) {
      return candidate;
    }
  }
  let counter = 2;
  while (lines.has(`SLOPWEAVER_BODY_END_${String(counter)}`)) {
    counter += 1;
  }
  return `SLOPWEAVER_BODY_END_${String(counter)}`;
}

/**
 * The verb line for one destination, without the body — what a reader checks before the message itself.
 *
 * @param destination where the draft would go
 * @returns the `slopweaver …` line, ending in `--body -`
 */
export function sendVerb({ destination }: { destination: BoardRowDestination }): string {
  if (destination.kind === "thread") {
    return `slopweaver slack reply --as me --channel ${destination.channel} --thread-ts ${destination.threadTs} --body -`;
  }
  if (destination.kind === "channel") {
    return `slopweaver slack post --as me --channel ${destination.channel} --shape top-level --body -`;
  }
  return `slopweaver slack post --as me --channel ${destination.conversation} --shape top-level --body -`;
}

/**
 * Every message a draft sends, in the order they are posted — the body, then each follow-up.
 *
 * @param action the drafted action
 * @returns one entry per message, never empty
 */
export function draftMessages({ action }: { action: BoardRowAction }): readonly string[] {
  return [action.body, ...action.followUps];
}

/**
 * The whole command: one send per message, each fed in over a heredoc whose delimiter that message cannot
 * break, chained with `&&` so a send that fails stops the ones after it — a second message landing without
 * the first it follows on from reads as a non sequitur in the room.
 *
 * Two drafts to one recipient are each sent on their own. One send of a body joined by
 * a blank line posts them as one message, which is the defect this shape closes.
 *
 * @param destination where the draft would go
 * @param messages the drafted messages, in order, exactly as they would be sent
 * @returns the command, ready to paste into a shell
 */
export function sendCommand({
  destination,
  messages,
}: {
  destination: BoardRowDestination;
  messages: readonly string[];
}): string {
  const verb = sendVerb({ destination });
  return messages
    .map((body, index) => {
      const delimiter = heredocDelimiter({ body });
      const chain = index < messages.length - 1 ? " &&" : "";
      return `${verb} <<'${delimiter}'${chain}\n${body}\n${delimiter}`;
    })
    .join("\n");
}

/**
 * How a destination names itself in one line — the channel, the thread, or who the DM reaches.
 *
 * The DM arm spells the PEOPLE rather than the conversation id, because `D01…` tells a reader nothing and
 * the whole point of the card is that the owner can decide it in one breath. A DM with no named recipient says so
 * out loud rather than printing an id and letting it read as a person.
 *
 * @param destination the destination to describe
 * @returns the one-line description
 */
export function destinationWhere({ destination }: { destination: BoardRowDestination }): string {
  if (destination.kind === "channel") {
    return `a new top-level message in ${destination.channel}`;
  }
  if (destination.kind === "thread") {
    return `a reply in the thread at ${destination.channel} · ${destination.threadTs}`;
  }
  if (destination.recipients.length === 0) {
    return `a DM to ${destination.conversation}; the conversation names no recipient`;
  }
  return `a DM to ${destination.recipients.map((one) => one.label).join(", ")}`;
}
