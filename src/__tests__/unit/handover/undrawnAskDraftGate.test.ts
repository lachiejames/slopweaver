/*
 * The gate on a Queue card saying a message was drafted as the owner — `src/handover/undrawnAskDraftGate.ts` — and its
 * effectful halves in `namedDraftAdmission.ts`. The corpus is the three recorded run journals that used the phrase,
 * measured: two drew no draft on their cards, the third named its parked draft.
 */

import { describe, expect, it } from "vitest";

import { undrawnAskDraftExit, waitingCard } from "../../../cli/commands/handover/namedDraftAdmission.js";
import { EXIT_USAGE } from "../../../cli/exitCodes.js";
import { parseLedger } from "../../../handover/ledger.js";
import { UNDRAWN_ASK_DRAFT_HATCH, undrawnAskDraftVerdict } from "../../../handover/undrawnAskDraftGate.js";

/** `the-claude-subs-card-is-tracked-…`'s question: the note sat in a DM thread the card cannot draw. */
const SETH_NOTE =
  "(1) The limit-increase note to Seth (2,000 AUD a month) is drafted as you in your bot DM thread " +
  "https://acme.slack.com/archives/D0SYN000001/p1789571466818409";

/** `owner-steer-off-the-platform-stand-up-23`'s question: the post sat on a page the card cannot draw. */
const PAYMENTS_POST = "The payments-channel post is drafted as you and UNSENT on the page";

/** `organisation-intelligence-post-shapes-…-291-22`'s problem: the draft is parked and named, so the card draws it. */
const NAMED_POST = "your PR preview candidates post to #squad-web-platform is drafted as you in sd-e55bf6e4, parked";

const COMMAND = "slopweaver handover ask";

describe("undrawnAskDraftVerdict", () => {
  const base = { command: COMMAND, draftIds: [], env: {}, offersMessage: false } as const;

  it("refuses both recorded asks whose cards drew nothing, quoting the phrase", () => {
    const seth = undrawnAskDraftVerdict({ ...base, texts: [SETH_NOTE] });
    const payments = undrawnAskDraftVerdict({ ...base, texts: [PAYMENTS_POST] });
    expect(seth.kind).toBe("refused");
    expect(payments.kind).toBe("refused");
    expect(seth).toEqual(payments);
    expect(unwrapLines({ verdict: seth })[0]!.split("\n")[0]).toBe(
      "slopweaver handover ask blocked because the card says a message was drafted as the owner and carries no draft the " +
        "card can draw — two recorded asks pointed at a DM thread and a page instead, where a Queue card about a " +
        'draft shows it (it says "drafted as you", names no parked draft and offers no ' +
        "message).",
    );
    expect(unwrapLines({ verdict: seth }).at(-1)).toContain("park the message with `slopweaver slack draft record`");
  });

  it("admits a card naming its parked draft, or one whose ask offers the message", () => {
    expect(undrawnAskDraftVerdict({ ...base, draftIds: ["sd-e55bf6e4"], texts: [NAMED_POST] })).toEqual({ kind: "ok" });
    expect(undrawnAskDraftVerdict({ ...base, offersMessage: true, texts: [SETH_NOTE] })).toEqual({ kind: "ok" });
  });

  it("admits a card that says no message was drafted as the owner, and skips an absent text", () => {
    expect(undrawnAskDraftVerdict({ ...base, texts: ["Merge #2064 once CI is green?", undefined] })).toEqual({
      kind: "ok",
    });
  });

  it("records past the hatch, saying the card has no draft to draw", () => {
    expect(undrawnAskDraftVerdict({ ...base, env: { [UNDRAWN_ASK_DRAFT_HATCH]: "1" }, texts: [SETH_NOTE] })).toEqual({
      kind: "hatched",
      lines: [
        'slopweaver handover ask: recorded past SLOPWEAVER_ALLOW_UNDRAWN_ASK_DRAFT=1 — it says "drafted as you" and ' +
          "carries no draft, so its card has none to draw",
      ],
    });
  });
});

describe("undrawnAskDraftExit", () => {
  function exitOf({ texts, named }: { texts: readonly string[]; named: readonly string[] }): {
    code: number | undefined;
    lines: string[];
  } {
    const lines: string[] = [];
    const code = undrawnAskDraftExit({
      command: COMMAND,
      env: {},
      named,
      offersMessage: false,
      texts,
      write: (line) => lines.push(line),
    });
    return { code, lines };
  }

  it("refuses a card speaking of a draft as the owner that nothing on it names, printing the whole refusal", () => {
    const { code, lines } = exitOf({ named: ["a-row-slug"], texts: [SETH_NOTE] });
    expect(code).toBe(EXIT_USAGE);
    expect(lines.length).toBe(2);
  });

  it("counts an id the row's slug or summary names, since the card draws that draft too", () => {
    expect(exitOf({ named: ["summary naming sd-e55bf6e4"], texts: [PAYMENTS_POST] })).toEqual({
      code: undefined,
      lines: [],
    });
  });

  it("never reads the phrase in the slug or summary, so a row ABOUT drafts does not refuse itself", () => {
    expect(exitOf({ named: [PAYMENTS_POST], texts: ["Should the gate cover this?"] })).toEqual({
      code: undefined,
      lines: [],
    });
  });
});

describe("waitingCard", () => {
  const started = { atIso: "2026-10-10T08:00:00.000Z", branch: "b", docHash: "h1", kind: "started" };
  const asked = { atIso: "2026-10-10T08:10:00.000Z", kind: "question", question: "Post it?" };
  const offered = {
    action: {
      actor: "me",
      body: "trying out this new thing",
      destinations: [{ channel: "C0SYN000001", kind: "channel", label: "#payments", tradeoff: "under your name" }],
      mentions: [],
      version: 1,
    },
    atIso: "2026-10-10T08:20:00.000Z",
    kind: "question-offered",
    lean: "post it",
    options: [
      { letter: "A", option: "#payments", tradeoff: "under your name" },
      { letter: "B", option: "Hold it — send nothing for now", tradeoff: "the draft goes stale" },
    ],
    problem: "the post waits on the owner",
    question: "Post it?",
  };

  /** A doc registered with no shape, so the card has nothing to fall back to. */
  const UNSHAPED_DOC = {
    blastRadius: undefined,
    lean: undefined,
    options: [],
    problem: undefined,
    risk: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
  };

  function contextOf({
    lines,
    doc = UNSHAPED_DOC,
  }: {
    lines: readonly unknown[];
    doc?: Parameters<typeof waitingCard>[0]["context"]["doc"];
  }): Parameters<typeof waitingCard>[0]["context"] {
    return { ...parseLedger({ text: lines.map((line) => JSON.stringify(line)).join("\n") }), doc };
  }

  // An unshaped, actionless ask's card falls back to the doc's shape, so the gate reads it too.
  it("falls back to the doc's shape for a run that journalled none, as the card does", () => {
    const doc = {
      ...UNSHAPED_DOC,
      lean: "post it",
      options: [{ letter: "A", option: "#payments", tradeoff: "under your name" }],
      problem: "The payments post is drafted as you and UNSENT",
    };

    expect(waitingCard({ context: contextOf({ doc, lines: [started, asked] }) }).shape).toEqual([
      "The payments post is drafted as you and UNSENT",
      "#payments",
      "under your name",
      "post it",
    ]);
  });

  it("offers a message, and keeps the question and shape it draws, for a run waiting on an offered ask", () => {
    expect(waitingCard({ context: contextOf({ lines: [started, asked, offered] }) })).toEqual({
      offersMessage: true,
      question: "Post it?",
      shape: [
        "the post waits on the owner",
        "#payments",
        "under your name",
        "Hold it — send nothing for now",
        // Derived from the action on the way in (`questionLineDecode.ts`), never the stored line.
        "the thread moves on without our answer, and the draft goes stale",
        "post it",
      ],
      stillReal: undefined,
    });
  });

  it("offers no message for a run waiting on an unshaped ask that offered none", () => {
    expect(waitingCard({ context: contextOf({ lines: [started, asked] }) })).toEqual({
      offersMessage: false,
      question: "Post it?",
      shape: [],
      stillReal: undefined,
    });
  });

  // A correction keeps the reconfirmed line, and the card goes on drawing it.
  it("keeps the reconfirmed still-real line across a correction", () => {
    const reconfirmed = {
      atIso: "2026-10-10T08:30:00.000Z",
      kind: "question-reconfirmed",
      question: "Post it?",
      stillReal: "The reply is drafted as you and UNSENT",
    };
    const corrected = {
      atIso: "2026-10-10T08:40:00.000Z",
      kind: "question-corrected",
      question: "Post it now?",
      why: "w",
    };
    const waiting = waitingCard({ context: contextOf({ lines: [started, asked, reconfirmed, corrected] }) });

    expect([waiting.question, waiting.stillReal]).toEqual(["Post it now?", "The reply is drafted as you and UNSENT"]);
  });

  it("carries nothing for a run not waiting on the owner", () => {
    expect(waitingCard({ context: contextOf({ lines: [started] }) })).toEqual({
      offersMessage: false,
      question: undefined,
      shape: [],
      stillReal: undefined,
    });
  });

  it("lets a reconfirm line speak of a draft the waiting question already names by id", () => {
    const lines: string[] = [];
    const waiting = waitingCard({
      context: contextOf({ lines: [started, { ...asked, question: "Post the reply drafted as you (sd-e55bf6e4)?" }] }),
    });
    const code = undrawnAskDraftExit({
      command: "slopweaver handover reconfirm",
      env: {},
      named: [waiting.question, ...waiting.shape],
      offersMessage: waiting.offersMessage,
      texts: ["the reply drafted as you is still unsent"],
      write: (line) => lines.push(line),
    });
    expect({ code, lines }).toEqual({ code: undefined, lines: [] });
  });
});

/** A refused verdict's lines, throwing on any other kind so an assertion never branches. */
function unwrapLines({ verdict }: { verdict: ReturnType<typeof undrawnAskDraftVerdict> }): readonly string[] {
  if (verdict.kind !== "refused") {
    throw new Error(`expected a refusal, got ${verdict.kind}`);
  }
  return verdict.lines;
}
