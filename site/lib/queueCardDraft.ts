/**
 * The card for a reply the outbound door held — split out of `./queueCard.ts`, which holds the shapes and text helpers
 * it builds from.
 */

import { asQuestion, type BriefingCard, foldedText, localPagesIn, readable, saidText } from "./queueCard";

/** A reply the outbound door held rather than sending. */
export interface DraftRecord {
  readonly id: string;
  readonly channel: string;
  readonly question: string;
  readonly reason: string;
  readonly askedBy: string;
}

/**
 * The card for a reply the door held.
 *
 * @returns the card
 */
export function draftCard({ draft }: { draft: DraftRecord }): BriefingCard {
  const reason = saidText({ text: draft.reason });
  const askedBy = saidText({ text: draft.askedBy });
  const channel = saidText({ text: draft.channel });
  const asked = askedBy === undefined || channel === undefined ? undefined : `${askedBy} asked this in ${channel}.`;
  let held = "The bot composed a reply and the outbound door held it rather than sending.";
  let lean: string | undefined;
  if (reason !== undefined) {
    held = `The bot composed a reply and the outbound door held it rather than sending: ${reason}.`;
    lean = `The door held it because ${reason}.`;
  }
  return {
    head: undefined,
    ifSilent: "The reply stays held and the thread gets no answer from the bot.",
    lean,
    options: [
      {
        how: {
          command: `slopweaver queue release ${draft.id}`,
          kind: "elsewhere",
          where: "a session, with the withhold recorded as waived",
        },
        letter: "A",
        sentence: "Send it: the reply goes out through the door as it stands.",
      },
      {
        how: { command: `slopweaver queue drop ${draft.id}`, kind: "elsewhere", where: "a session" },
        letter: "B",
        sentence: "Discard it: the thread gets no answer and the draft is gone.",
      },
      {
        how: { kind: "silence" },
        letter: "C",
        sentence: "Leave it held while you read the thread; it is on this panel.",
      },
    ],
    commands: [],
    examples: undefined,
    pages: localPagesIn({ text: draft.question }),
    problem: undefined,
    stakes: undefined,
    question: asQuestion({ text: readable({ text: draft.question }) }),
    subject: draft.channel,
    what: foldedText({
      text: [asked, held].filter((part) => part !== undefined).join(" "),
    }),
    kind: "briefing",
    whyYou: undefined,
  };
}
