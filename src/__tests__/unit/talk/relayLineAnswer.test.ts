/**
 * What the relay's typed line says the owner's words answered, pure: a field made typeable and cut, and the clause
 * naming the voice's turn and the stored verdict in each shape the line can take — the voice's "Needs more info here
 * too?" before the owner's bare yes as the worked case.
 */
import { describe, expect, it } from "vitest";

import type { AnswerContext } from "../../../talk/answerContext.js";
import { answerClause, cutField, LINE_SLUG_CHARS, typeable } from "../../../talk/relayLineAnswer.js";

const POINTER = "talk-call:a0000044-0000-4000-8000-000000000047#turn_000000000000000000022";
const QUESTION = "Needs more info. Next: a proposed post. Needs more info here too?";
const NEEDS_MORE_INFO = { kind: "stored", ruling: { label: undefined, verdict: "needs-more-info" } } as const;

const found: AnswerContext = {
  triage: NEEDS_MORE_INFO,
  voice: { kind: "found", turn: { beganIso: "2026-10-13T23:38:26.835Z", pointer: POINTER, text: QUESTION } },
};

describe("typeable", () => {
  it("turns an Escape, a Ctrl-C and a DEL into spaces, leaving the rest", () => {
    expect(typeable({ text: "a\u001bb\u0003c\u007f" })).toBe("a b c ");
  });
});

describe("cutField", () => {
  it("keeps a field at the bound whole, and cuts one past it to the bound with its mark", () => {
    expect(cutField({ max: 5, text: "abcde" })).toBe("abcde");
    expect(cutField({ max: 5, text: "abcdef" })).toBe("abcd…");
  });

  it("makes the field typeable", () => {
    expect(cutField({ max: 10, text: "a\u001bb" })).toBe("a b");
  });
});

describe("answerClause", () => {
  it("names the voice's turn by pointer in the fixed clause, with the verdict", () => {
    expect(answerClause({ answer: found, typed: false }).fixed).toBe(
      ` — answering the voice's turn ${POINTER}; triage verdict needs-more-info`,
    );
  });

  it("quotes the voice's question whole when the room holds it", () => {
    expect(answerClause({ answer: found, typed: false }).quoted({ room: 1000 })).toBe(
      ` — answering the voice's "${QUESTION}" (${POINTER}); triage verdict needs-more-info`,
    );
  });

  it("quotes the question's END at the fewest characters it quotes, and falls back to the pointer one short of that", () => {
    const overhead = ` — answering the voice's "" (${POINTER}); triage verdict needs-more-info`.length;
    const clause = answerClause({ answer: found, typed: false });
    expect(clause.quoted({ room: overhead + 24 })).toBe(
      ` — answering the voice's "… ds more info here too?" (${POINTER}); triage verdict needs-more-info`,
    );
    expect(clause.quoted({ room: overhead + 23 })).toBe(clause.fixed);
  });

  it("carries only the verdict for a console-typed steer, which no voice turn preceded", () => {
    const clause = answerClause({ answer: found, typed: true });
    expect([clause.fixed, clause.quoted({ room: 1000 }), clause.short]).toStrictEqual([
      " — triage verdict needs-more-info",
      " — triage verdict needs-more-info",
      " — triage verdict needs-more-info",
    ]);
  });

  it("says why no voice turn was found, and cuts that reason shorter only in the short form", () => {
    const why = "x".repeat(200);
    const clause = answerClause({
      answer: { triage: { kind: "none" }, voice: { kind: "not-found", why } },
      typed: false,
    });
    expect(clause.fixed).toBe(
      ` — the voice turn the owner answered was not found (${"x".repeat(159)}…); triage verdict: none`,
    );
    expect(clause.quoted({ room: 1000 })).toBe(clause.fixed);
    expect(clause.short).toBe(
      ` — the voice turn the owner answered was not found (${"x".repeat(87)}…); triage verdict: none`,
    );
  });

  it("says a call that could not be read as that, not as a turn not found", () => {
    const clause = answerClause({
      answer: { triage: { kind: "not-applicable" }, voice: { kind: "unreadable", why: "EACCES" } },
      typed: false,
    });
    expect(clause.fixed).toBe(
      " — the voice turn the owner answered could not be read (EACCES); triage verdict: none (no relay)",
    );
  });

  it("cuts a hand-edited row slug and voice pointer to their bounds", () => {
    const slug = "s".repeat(LINE_SLUG_CHARS + 10);
    const pointer = "p".repeat(120);
    const clause = answerClause({
      answer: {
        triage: { kind: "not-recorded", slug },
        voice: { kind: "found", turn: { beganIso: "2026-10-13T23:38:26.835Z", pointer, text: QUESTION } },
      },
      typed: false,
    });
    expect(clause.fixed).toBe(
      ` — answering the voice's turn ${"p".repeat(95)}…; triage verdict: NOT RECORDED (read row ${"s".repeat(LINE_SLUG_CHARS - 1)}…)`,
    );
  });
});
