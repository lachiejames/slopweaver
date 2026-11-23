/*
 * A card's declared readiness: a waiting card must name the session and event it waits on, an unmarked card
 * whose `what` says a session is still working is refused, and every waiting card ranks below the cards the owner
 * can answer now, read across both groupings. `waitingCard` is used only here, so it stays here.
 */
import { describe, expect, it } from "vitest";

import { AGE_LINE, artifact, card, check, groupedArtifact } from "./harness.js";

/** One waiting card's HTML: the renderer's own mark, and the line naming the session and the event. */
function waitingCard({
  question = "1. Does 16378 go for review once it sits in a native stack?",
  what = "The chain of four is not a native stack. The session is adopting the four into one native stack.",
  line = '<div class="wait">waiting on handoff-9141 · the four adopt into one native stack</div>',
}: { question?: string; what?: string; line?: string } = {}): string {
  return (
    `<div class="need" data-readiness="waiting"><div class="q">${question}</div>${AGE_LINE}${line}` +
    `<dl class="f"><dt>what</dt><dd>${what}</dd>` +
    `<dt>why you</dt><dd>It is your call whether it goes out.</dd>` +
    `<dt>options</dt><dd>A: tell the supervisor go. B: tell the supervisor hold.</dd>` +
    `<dt>lean</dt><dd>A, once it lands.</dd>` +
    `<dt>if silent</dt><dd>nothing goes out.</dd></dl></div>`
  );
}

describe("a card's declared readiness", () => {
  it("passes a waiting card that names its session and event", () => {
    const result = check({ html: artifact({ cards: [waitingCard()] }) });

    expect(result.cardsChecked).toBe(1);
    expect(result.defects).toEqual([]);
  });

  it("refuses a waiting card carrying no wait line", () => {
    const result = check({ html: artifact({ cards: [waitingCard({ line: "" })] }) });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "readiness",
        question: "Does 16378 go for review once it sits in a native stack?",
        reason:
          "the card is marked as waiting and carries no `waiting on <session> · <event>` line, so it says " +
          "the owner cannot answer it yet and never says what would change that.",
      },
    ]);
  });

  // Card 1 is unmarked, so it claims to be the owner's to answer, with a `what` that says the session had not
  // finished.
  it("refuses an unmarked card whose `what` says a session is still working", () => {
    const html = artifact({
      cards: [
        card({
          question: "1. Does 16378 go for review once it sits in a native stack?",
          what: "The chain of four is not a native stack. The session is adopting the four into one native stack.",
        }),
      ],
    });

    const result = check({ html });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "what",
        question: "Does 16378 go for review once it sits in a native stack?",
        reason:
          'what says a session is still working, with "The session is adopting", while the card declares ' +
          'itself ready for your word. Declare `"readiness": { "state": "waiting", "session": "…", "event": ' +
          '"…" }` so the card ranks below the ones you can answer now, or reword the `what` to report work ' +
          "that has finished.",
      },
    ]);
  });

  it("refuses a waiting card ranked above one you can answer now", () => {
    const html = artifact({ cards: [waitingCard(), card({ question: "2. Was landing it the right call?" })] });

    const result = check({ html });

    expect(result.defects).toEqual([
      {
        card: 1,
        field: "readiness",
        question: "Does 16378 go for review once it sits in a native stack?",
        reason:
          "card 1 waits on a session and ranks above card 2, which you can answer now. Every ready card " +
          "comes first; the waiting ones sit under their own heading below.",
      },
    ]);
  });

  it("reads the ORDER across both groupings, because that is the order the owner reads", () => {
    const html = groupedArtifact({
      mine: [card({ question: "2. Was landing it the right call?" })],
      team: [waitingCard()],
    });

    const result = check({ html });

    expect(result.defects.map((defect) => defect.field)).toEqual(["readiness"]);
    expect(result.defects[0]!.card).toBe(1);
  });

  it("passes the same two cards once the ready one comes first", () => {
    const html = artifact({
      cards: [
        card({ question: "1. Was landing it the right call?" }),
        waitingCard({ question: "2. Does 16378 go for review once it sits in a native stack?" }),
      ],
    });

    expect(check({ html }).defects).toEqual([]);
  });

  it("reports one line per waiting card, never one per pair it outranks", () => {
    const html = artifact({
      cards: [
        waitingCard(),
        card({ question: "2. Was landing it the right call?" }),
        card({ question: "3. Was the rebase right?" }),
      ],
    });

    expect(check({ html }).defects).toHaveLength(1);
  });
});
