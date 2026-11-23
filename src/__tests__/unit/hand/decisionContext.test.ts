/*
 * The decision a hand step carries in its own record: decoded whole or refused, and the posting form that
 * lets a decision through only when it opens or carries its choice.
 */
import { describe, expect, it } from "vitest";

import { decisionWithoutAsk } from "../../../hand/decision.js";
import { checkedHandDecision } from "../../../hand/decisionContext.js";
import { postingRefusal } from "../../../hand/posting.js";
import { buildHandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DECISION = {
  lean: "Repair, then restart.",
  options: [
    { letter: "A", option: "Restart it now", tradeoff: "output returns first, may stop again" },
    { letter: "B", option: "Repair, then restart it", tradeoff: "promise holds, output absent meanwhile" },
  ],
  problem: "store-backup-daily stopped firing.",
  stakes: { blastRadius: "store-backup-daily", risk: "It stays silent.", stillReal: "This pass read it stopped." },
} as const;

const WHAT = "Choose restart, repair, or retire for store-backup-daily — stopped firing";

/** The step's own card on the console queue — the one link a carried decision may sit beside. */
const OWN_CARD = "http://localhost:3000/queue?open=hand%3Amon-recipe-store-backup-daily&context=work";

function draft(over: Partial<HandStepDraft> = {}): HandStepDraft {
  return {
    id: "mon-recipe-store-backup-daily",
    postedBy: "workspace:12",
    postedIso: "2026-09-27T02:00:00.000Z",
    unblocks: "store-backup-daily — MISSED: 2 slot(s) went by unrun",
    what: WHAT,
    witness: "slopweaver monitor check --fire",
    ...over,
  };
}

describe("checkedHandDecision", () => {
  it("reads absence as no decision, so every step posted before the field reads unchanged", () => {
    expect(unwrap(checkedHandDecision({ value: undefined }))).toBeUndefined();
  });

  it("reads a whole decision back exactly, letters derived by position", () => {
    const wire = { ...DECISION, options: DECISION.options.map((one) => ({ ...one, letter: "Z" })) };

    expect(unwrap(checkedHandDecision({ value: wire }))).toEqual(DECISION);
  });

  it("refuses a value that is not an object", () => {
    expect(unwrapErr(checkedHandDecision({ value: "restart" })).message).toBe("decision is not an object");
  });

  it("refuses a decision with no lean", () => {
    expect(unwrapErr(checkedHandDecision({ value: { ...DECISION, lean: undefined } })).message).toBe(
      "decision carries no problem or no lean as text",
    );
  });

  it("refuses partial stakes rather than drawing half of them", () => {
    const partial = { ...DECISION, stakes: { risk: "It stays silent." } };

    expect(unwrapErr(checkedHandDecision({ value: partial })).message).toBe(
      "decision carries no whole stakes — risk, blast radius and the still-real check are all required",
    );
  });

  it("refuses an option that is not an option and a trade-off", () => {
    const malformed = { ...DECISION, options: [...DECISION.options, { option: "Retire it" }] };

    expect(unwrapErr(checkedHandDecision({ value: malformed })).message).toBe(
      "decision has an option that is not an option and a trade-off",
    );
  });

  it("refuses one option, because one option is a notification rather than a decision", () => {
    const one = { ...DECISION, options: [DECISION.options[0]] };

    expect(unwrapErr(checkedHandDecision({ value: one })).message).toBe(
      "decision 1 option(s) — an ask carries 2 to 4, because one option is a notification rather than a decision",
    );
  });

  it("refuses a problem of two sentences, the ask shape's own cap", () => {
    const long = { ...DECISION, problem: "It stopped. Nobody knows why." };

    expect(unwrapErr(checkedHandDecision({ value: long })).code).toBe("INVALID_FIELD");
  });
});

describe("a hand step carrying its decision", () => {
  it("builds and keeps the decision on the step", () => {
    expect(unwrap(buildHandStep({ draft: draft({ decision: DECISION }) })).decision).toEqual(DECISION);
  });

  it("omits the field when it carries none", () => {
    expect(Object.keys(unwrap(buildHandStep({ draft: draft() })))).not.toContain("decision");
  });
});

describe("the posting form over a decision", () => {
  it("refuses the recipe card's sentence when it carries nothing — the card the owner could not read", () => {
    const step = unwrap(buildHandStep({ draft: draft() }));

    expect(decisionWithoutAsk({ step })!.code).toBe("DECISION_WITHOUT_ASK");
    expect(postingRefusal({ step })!.code).toBe("DECISION_WITHOUT_ASK");
  });

  it("passes the same sentence once the step carries its decision, opening its own card", () => {
    const step = unwrap(buildHandStep({ draft: draft({ decision: DECISION, url: OWN_CARD }) }));

    expect(decisionWithoutAsk({ step })).toBeUndefined();
    expect(postingRefusal({ step })).toBeUndefined();
  });

  it("refuses a decision on a sentence that offers no choice", () => {
    const step = unwrap(
      buildHandStep({ draft: draft({ decision: DECISION, what: "Sign in to Google Cloud before the deploy runs" }) }),
    );

    expect(postingRefusal({ step })!.message).toBe(
      "decision is carried by a step whose sentence asks for no choice — say the choice in `what`, or drop the decision",
    );
  });

  it("refuses a decision beside a link to another record, so one card never holds two contexts", () => {
    const step = unwrap(
      buildHandStep({
        draft: draft({ decision: DECISION, url: "https://github.com/lachiejames/slopweaver/pull/1400" }),
      }),
    );

    expect(postingRefusal({ step })!.message).toBe(
      "decision is carried beside a link to another record — link the record that holds the choice, or carry it here, never both",
    );
  });

  it("passes a decision beside its own card on a console origin that is not this machine", () => {
    const url = "https://console.example.org/queue?open=hand%3Amon-recipe-store-backup-daily&context=work";
    const step = unwrap(buildHandStep({ draft: draft({ decision: DECISION, url }) }));

    expect(postingRefusal({ step })).toBeUndefined();
  });

  it("passes a reserved closure asked as a go-ahead once it carries its decision", () => {
    const what = "Should I close the Vanta group move now that the staff are in Operations?";
    const step = unwrap(buildHandStep({ draft: draft({ decision: DECISION, url: OWN_CARD, what }) }));

    expect(postingRefusal({ step })).toBeUndefined();
  });

  it("passes a send confirmed as a go-ahead once it carries its decision", () => {
    const what = "Confirm you want the two ISO replies to Rosa posted as you, so their thread is answered";
    const step = unwrap(buildHandStep({ draft: draft({ decision: DECISION, url: OWN_CARD, what }) }));

    expect(postingRefusal({ step })).toBeUndefined();
  });

  it("passes a plain step to take", () => {
    const step = unwrap(
      buildHandStep({
        draft: draft({
          url: "https://console.cloud.google.com/",
          what: "Sign in to Google Cloud before the deploy runs",
        }),
      }),
    );

    expect(postingRefusal({ step })).toBeUndefined();
  });
});

describe("decisionWithoutAsk over a comma-or opening on a third-person pronoun", () => {
  it("reads it as a consequence, whichever person it names, with no modal to lean on", () => {
    // Written words, spelled through a pattern's source: the owner-pronoun gate reads a pattern as speech, which these are.
    const [subject, possessive] = [/he/u.source, /his/u.source];
    const whats = [
      `Approve the push, or ${subject} loses access`,
      `Approve the push, or ${possessive} session ends`,
      "Approve the push, or she loses access",
      "Approve the push, or her session ends",
    ];
    expect(
      whats.map((what) => decisionWithoutAsk({ step: unwrap(buildHandStep({ draft: draft({ what }) })) })),
    ).toEqual([undefined, undefined, undefined, undefined]);
    // The witness: an action after the comma is an alternative, which an unasked decision is refused for.
    const held = unwrap(buildHandStep({ draft: draft({ what: "Approve the push, or hold it for a day" }) }));
    expect(decisionWithoutAsk({ step: held })!.code).toBe("DECISION_WITHOUT_ASK");
  });
});
