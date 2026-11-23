/*
 * A queue card whose drawn prose names a session, call, talk, turn or run by its machine id is refused, never drawn.
 *
 * A machine id reads as noise to a person; the session stays behind the source line's hover.
 */

import { describe, expect, it } from "vitest";

import { machineIdForm, machineIdsHidden } from "../../lib/machineIdForm";
import type { BriefingCard, StepCard } from "../../lib/queueCard";
import type { CardSource } from "../../lib/queueCardSource";

const SESSION = "a0000056-5c4b-4a0e-9a49-2f8f3d1c7b10";

/**
 * A briefing card whose every drawn field is clean, with one field overridden.
 *
 * @returns the card
 */
function briefing({ over = {} }: { over?: Partial<BriefingCard> }): BriefingCard {
  return {
    commands: [],
    examples: undefined,
    head: undefined,
    ifSilent: "It stays parked.",
    kind: "briefing",
    lean: "Send it.",
    options: [
      { how: { kind: "silence" }, letter: "A", sentence: "Send it as you.", tradeoff: "The owner reads it today." },
    ],
    pages: [],
    problem: undefined,
    question: "Send this review ask as you?",
    stakes: undefined,
    subject: "acme/acme-admin review ask",
    what: { aboveFold: "A review ask.", folded: false, whole: "A review ask." },
    whyYou: undefined,
    ...over,
  };
}

/**
 * A step card whose every drawn field is clean, with its rows given.
 *
 * @returns the card
 */
function step({ rows }: { rows: StepCard["rows"] }): StepCard {
  return {
    checklist: undefined,
    copy: undefined,
    decision: undefined,
    kind: "step",
    pages: [],
    question: "Approve the Vanta write.",
    rows,
    subject: "approve-vanta-write",
    what: { aboveFold: "Approve the Vanta write.", folded: false, whole: "Approve the Vanta write." },
  };
}

const FROM_A_RUN: CardSource = {
  kind: "registered",
  run: "carry-out-the-three-rulings-on-the-dependency",
  session: SESSION,
  steers: [],
};

describe("machineIdForm", () => {
  it("draws a card whose prose names no machine id, with the session behind the source line's hover", () => {
    expect(machineIdForm({ card: briefing({}), source: FROM_A_RUN })).toEqual({ kind: "drawn" });
  });

  it("refuses a card whose what names a session by its uuid, naming the field and never the id", () => {
    const card = briefing({
      over: {
        what: {
          aboveFold: "Drafted by a session.",
          folded: true,
          whole: `Drafted by session ${SESSION} while it ran.`,
        },
      },
    });

    expect(machineIdForm({ card, source: FROM_A_RUN })).toEqual({
      kind: "refused",
      why:
        "This card's what names a session, call, talk, turn or run by its machine id, so it is refused rather than " +
        "drawn. A card names it by what it was doing, with the id behind a link or a hover at most.",
    });
  });

  it("refuses a short session hex named in an option's tradeoff", () => {
    const card = briefing({
      over: {
        options: [{ how: { kind: "silence" }, letter: "B", sentence: "Hold it.", tradeoff: "session a0000055 waits." }],
      },
    });

    expect(machineIdForm({ card, source: FROM_A_RUN })).toEqual({
      kind: "refused",
      why:
        "This card's option B names a session, call, talk, turn or run by its machine id, so it is refused rather " +
        "than drawn. A card names it by what it was doing, with the id behind a link or a hover at most.",
    });
  });

  it("draws an id inside a URL, which the panel draws as a link, and an id in the subject, which is its key", () => {
    const card = briefing({
      over: { question: `Open http://localhost:3000/queue?open=act:${SESSION} and send it?`, subject: SESSION },
    });

    expect(machineIdForm({ card, source: FROM_A_RUN })).toEqual({ kind: "drawn" });
  });

  it("draws a step whose machine id sits only in an address row", () => {
    const card = step({ rows: [{ behind: true, label: "cites", value: `transcript:${SESSION}` }] });

    expect(machineIdForm({ card, source: FROM_A_RUN })).toEqual({ kind: "drawn" });
  });

  it("refuses a step whose prose row names a turn id", () => {
    const card = step({ rows: [{ label: "still here because", value: "turn_EUpmQx7rT2b says so" }] });

    expect(machineIdForm({ card, source: FROM_A_RUN })).toEqual({
      kind: "refused",
      why:
        `This card's "still here because" row names a session, call, talk, turn or run by its machine id, so it is ` +
        "refused rather than drawn. A card names it by what it was doing, with the id behind a link or a hover at most.",
    });
  });

  it("refuses a step whose checklist line names a session by its id", () => {
    const card: StepCard = {
      ...step({ rows: [] }),
      checklist: [
        { action: "Open the transcript of session a0000019.", command: undefined, find: undefined, url: undefined },
      ],
    };

    expect(machineIdForm({ card, source: FROM_A_RUN })).toEqual({
      kind: "refused",
      why:
        "This card's checklist names a session, call, talk, turn or run by its machine id, so it is refused rather " +
        "than drawn. A card names it by what it was doing, with the id behind a link or a hover at most.",
    });
  });

  it("draws a card from a run whose slug reads as an id once its hyphens are spaces, naming neither", () => {
    const source: CardSource = { kind: "registered", run: "session-a0000019-cleanup", session: SESSION, steers: [] };

    expect(machineIdForm({ card: briefing({}), source })).toEqual({ kind: "drawn" });
  });

  it("draws a card whose unreadable anchor's reason carries the anchor, because the reason is folded beneath the line", () => {
    const anchor = `transcript:${SESSION}#${SESSION}`;
    const source: CardSource = {
      anchor,
      kind: "unreadable",
      steers: [],
      why: [{ lead: "its record would not read", why: `${anchor} names no owner turn in that transcript` }],
    };

    expect(machineIdForm({ card: briefing({}), source })).toEqual({ kind: "drawn" });
  });

  it("draws a card from a run that is itself a uuid, because the line names neither", () => {
    const source: CardSource = { kind: "registered", run: SESSION, session: SESSION, steers: [] };

    expect(machineIdForm({ card: briefing({}), source })).toEqual({ kind: "drawn" });
  });

  it("refuses a card whose source origin names a session by its id", () => {
    const source: CardSource = { kind: "none", origin: `a finding session ${SESSION} observed`, steers: [] };

    expect(machineIdForm({ card: briefing({}), source })).toEqual({
      kind: "refused",
      why:
        "This card's source line names a session, call, talk, turn or run by its machine id, so it is refused " +
        "rather than drawn. A card names it by what it was doing, with the id behind a link or a hover at most.",
    });
  });
});

describe("machineIdsHidden", () => {
  it("hides each id in what a refused card still draws, leaving a URL and the rest of the sentence whole", () => {
    const url = `http://localhost:3000/queue?open=act:${SESSION}`;
    const card = briefing({ over: { question: `Send what session ${SESSION} drafted? See ${url}` } });
    const source: CardSource = { kind: "none", origin: "a finding run a0000019 observed", steers: [] };

    const hidden = machineIdsHidden({ card, source });

    expect(hidden.card.question).toBe(`Send what session [id hidden] drafted? See ${url}`);
    expect(hidden.source).toEqual({ kind: "none", origin: "a finding [id hidden] observed", steers: [] });
  });
});
