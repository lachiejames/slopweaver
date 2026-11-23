/*
 * A hand step never dictates quoted words for the owner to type or say: the owner speaks on the Queue, in their own
 * words, and a card asks for what it needs on itself.
 */
import { describe, expect, it } from "vitest";

import { HandStepErrors } from "../../../hand/errors.js";
import { postingRefusal } from "../../../hand/posting.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { typedInstruction } from "../../../hand/typedInstruction.js";
import { unwrap } from "../../../lib/result.js";

const DRAFT: HandStepDraft = {
  id: "mon-claude-plan-two-0123456789abcdef",
  postedBy: "claude watch",
  postedIso: "2026-01-01T00:00:00.000Z",
  unblocks: "plan-two: its usage answer is a shape the gauge cannot read",
  url: "http://localhost:3000/queue?open=hand%3Amon-claude-plan-two-0123456789abcdef&context=work",
  what: "Ask on this card for a usage reader fix for owner@acme.example on Claude, so the plan works again",
  witness: "slopweaver monitor check --fire",
};

/** A step built by the real builder from the draft with a case's changes. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(buildHandStep({ draft: { ...DRAFT, ...over } }));
}

/** The refusal the rule gives for a phrase dictated in one field. */
function refusal({
  field,
  dictated,
}: {
  field: "what" | "where";
  dictated: string;
}): ReturnType<typeof typedInstruction> {
  return HandStepErrors.invalidField({
    field,
    why:
      `dictates words for the owner to type or say (${dictated}) — the owner speaks on the Queue, in their own ` +
      "words: say what they want done and where they ask for it, such as `Ask on this card for …`",
  });
}

describe("typedInstruction", () => {
  it("passes a card asking for the repair on itself", () => {
    expect(typedInstruction({ step: step() })).toBe(undefined);
  });

  it("refuses the card that told the owner to type a sentence to the supervisor", () => {
    const what =
      'Type "fix the usage reader for owner@acme.example on Claude" to the supervisor, so the plan works again';
    expect(typedInstruction({ step: step({ what }) })).toEqual(
      refusal({ dictated: 'Type "fix the usage reader for owner@acme.example on Claude"', field: "what" }),
    );
  });

  it("refuses a curly-quoted say in where", () => {
    const where = "the supervisor chat — say “repair the plans register” there";
    expect(typedInstruction({ step: step({ where }) })).toEqual(
      refusal({ dictated: "say “repair the plans register”", field: "where" }),
    );
  });

  it("refuses curly single quotes and a lower-case verb mid-sentence", () => {
    const what = "Open the chat and type ‘fix the usage reader’, so the plan works again";
    expect(typedInstruction({ step: step({ what }) })).toEqual(
      refusal({ dictated: "type ‘fix the usage reader’", field: "what" }),
    );
  });

  it("passes a code to type with no quoted words, a button named in quotes, and a label quoted after a question", () => {
    const passing = [
      "Type the code mailed to owner@acme.example into the sign-in prompt, so the token mints",
      'Click "Approve" on the access request, so the group write can go out',
      "Say whether the dialog reads “Approved”, so the group write can go out",
      'Enter the code from the mail into the prompt labelled "Code", so the token mints',
    ];
    expect(passing.map((what) => typedInstruction({ step: step({ what }) }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("is a posting rule", () => {
    const dictated = step({ what: 'Type "fix the usage reader" to the supervisor, so the plan works again' });
    expect(postingRefusal({ step: dictated })).toEqual(typedInstruction({ step: dictated }));
    expect(postingRefusal({ step: step() })).toBe(undefined);
  });
});
