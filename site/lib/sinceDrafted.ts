/**
 * What a held draft's card says about the world moving since the draft was written: one quiet line, opening onto who
 * said or changed what. It surfaces what has happened in the world since the card was created that materially changes things, as a little
 * versioning, and never too prominently.
 *
 * The measurement is the verb's (`src/live/slack/draftContextSince.ts`, the release's own classification); this module
 * only words it. It never claims "nothing changed" when the read itself said what it could not see: that read gets the
 * qualified "No changes found in this read" instead. Pure: the age arrives already worded, since the clock is the
 * component's.
 */
import type { ContextMessage, DraftSinceDrafted } from "../components/live/readDraftContext";
import { draftLinesWords } from "./draftWords";
import { personLabel, type SlackPeople } from "./slackPeople";

/** How many of a changed message's words its row draws; the message itself is one click away. */
export const SINCE_DRAFTED_WORDS = 12;

/** One message that is new or edited since the draft, as its row reads. */
export interface SinceDraftedChange {
  readonly kind: "added" | "edited";
  readonly ts: string;
  /** "Kyle wrote: the opening words…" or "Kyle edited: …". */
  readonly line: string;
  readonly permalink: string;
}

/** What the card draws: the one line, and what it opens onto. */
export type SinceDraftedView =
  | {
      readonly kind: "measured";
      /** Whether anything moved; the line takes the warning ink only then. */
      readonly changed: boolean;
      readonly summary: string;
      readonly changes: readonly SinceDraftedChange[];
      /** "1 message was removed", when any were; nothing of one is left to name. */
      readonly removedLine: string | undefined;
      readonly limits: readonly string[];
    }
  | { readonly kind: "not-measured"; readonly summary: string; readonly why: string };

/** A plural noun for a count: `1 new message`, `3 new messages`. */
function counted({ count, one, many }: { count: number; one: string; many: string }): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** Who wrote a message: the roster's name, else the name an app posted under, else that an app sent it. */
function authorOf({ message, people }: { message: ContextMessage; people: SlackPeople }): string {
  if (message.userId !== undefined) {
    return personLabel({ id: message.userId, people }).text;
  }
  if (message.username !== undefined) {
    return message.username;
  }
  return "an app";
}

/** A message's opening words as the card draws them, or a plain note when Slack gave it no text. */
function openingOf({ message, people }: { message: ContextMessage; people: SlackPeople }): string {
  const words = draftLinesWords({ labels: { mentions: [], people }, lines: message.lines })
    .split(/\s+/u)
    .filter((word) => word !== "");
  if (words.length === 0) {
    return "a message with no text Slack could give";
  }
  if (words.length <= SINCE_DRAFTED_WORDS) {
    return words.join(" ");
  }
  return `${words.slice(0, SINCE_DRAFTED_WORDS).join(" ")}…`;
}

/** Ascending by `ts`, the order the conversation happened in. */
function byTs({ left, right }: { left: string; right: string }): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * The card's words for what moved since the draft was written.
 *
 * @param reading the verb's measurement
 * @param messages the conversation as read, which every added or edited `ts` names a message of
 * @param people the roster naming each author
 * @param age how long ago the draft was written, as the page prints ages ("10.3h ago")
 * @returns the one quiet line and what it opens onto
 */
export function sinceDraftedView({
  reading,
  messages,
  people,
  age,
}: {
  reading: DraftSinceDrafted;
  messages: readonly ContextMessage[];
  people: SlackPeople;
  age: string;
}): SinceDraftedView {
  if (reading.kind === "not-measured") {
    return { kind: "not-measured", summary: "Could not tell what changed since this was drafted", why: reading.why };
  }
  const byStamp = new Map(messages.map((message) => [message.ts, message]));
  const changes = [
    ...reading.added.map((ts) => ({ kind: "added" as const, ts })),
    ...reading.edited.map((ts) => ({ kind: "edited" as const, ts })),
  ]
    .toSorted((left, right) => byTs({ left: left.ts, right: right.ts }))
    .map(({ kind, ts }): SinceDraftedChange => {
      // The reader refuses a measurement naming a message the conversation does not hold.
      const message = byStamp.get(ts)!;
      const verb = kind === "added" ? "wrote" : "edited";
      return {
        kind,
        line: `${authorOf({ message, people })} ${verb}: ${openingOf({ message, people })}`,
        permalink: message.permalink,
        ts,
      };
    });
  const removed = reading.removed.length;
  let removedLine: string | undefined;
  if (removed > 0) {
    removedLine = `${counted({ count: removed, many: "messages were", one: "message was" })} removed`;
  }
  const parts: string[] = [];
  if (reading.added.length > 0) {
    parts.push(counted({ count: reading.added.length, many: "new messages", one: "new message" }));
  }
  if (reading.edited.length > 0) {
    parts.push(`${String(reading.edited.length)} edited`);
  }
  if (removed > 0) {
    parts.push(`${String(removed)} removed`);
  }
  const limited = reading.limits.length > 0;
  const changed = parts.length > 0;
  let summary = `Nothing has changed here since this was drafted ${age}`;
  if (changed) {
    summary = `Since this was drafted ${age}: ${parts.join(", ")}${limited ? " (partial read)" : ""}`;
  } else if (limited) {
    summary = `No changes found in this read since this was drafted ${age}`;
  }
  return { changed, changes, kind: "measured", limits: reading.limits, removedLine, summary };
}
