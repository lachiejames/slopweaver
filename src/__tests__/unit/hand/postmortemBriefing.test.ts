/*
 * The postmortem card's posting rule: a step on a `postmortem-` row opens the briefing page the fleet published, and
 * its decision may sit beside that page. Each case is a step the real builder made, changing only the field it is
 * about.
 */
import { describe, expect, it } from "vitest";

import { postmortemRowRefusal } from "../../../cli/commands/hand/post.js";
import { misplacedDecision } from "../../../hand/decision.js";
import { postingRefusal } from "../../../hand/posting.js";
import { postmortemWithoutBriefing } from "../../../hand/proofLink.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

const ROW = "postmortem-c0syn000004";
const BRIEFING = "http://127.0.0.1:4321/view?src=%2Fapi%2Fpage%2Finc-98-briefing%2Findex.html&back=%2Fqueue";
const DD = "https://app.datadoghq.com/rum/explorer?query=%40view.name%3Acheckout";

/** The card `incident postmortem` composes, every field but the ones a case changes. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        cites: ["https://app.incident.io/acme/incidents/98"],
        decision: {
          lean: "Yes — the room will decide the Stripe pin.",
          options: [
            { option: "Yes — send the ask as written", tradeoff: "the room sees you ask to sit in" },
            { option: "No — skip this one", tradeoff: "the postmortem runs without you" },
          ],
          problem: "INC-98's postmortem is a room you are not in yet.",
          stakes: {
            blastRadius: "#inc-2026-09-23-payment-checkout-regression",
            risk: "one reply in your name in the incident channel",
            stillReal: "the snapshot listed INC-98 at 01:00Z",
          },
        },
        id: "pm-c0syn000004-r1",
        postedBy: "supervisor",
        postedIso: "2026-09-24T01:10:00.000Z",
        row: ROW,
        unblocks: "you sitting in on INC-98's postmortem",
        url: BRIEFING,
        what: "412 customers could not pay at checkout for five hours: should we send this to join the postmortem (INC-98)?",
        witness: "slopweaver slack draft show sd-1234abcd",
        ...over,
      },
    }),
  );
}

const WHY_TAIL =
  "on a step for a postmortem row — a postmortem card opens the briefing the owner reads before the meeting; " +
  "publish it with `slopweaver page publish <slug> --page <file> --review <id>` (the review from " +
  "`slopweaver page review-prepare`) and pass its viewer address";

describe("postmortemWithoutBriefing", () => {
  it("passes the card opening its briefing, and every posting rule passes it too", () => {
    expect(postmortemWithoutBriefing({ step: step() })).toBe(undefined);
    expect(postingRefusal({ step: step() })).toBe(undefined);
  });

  it("refuses a postmortem card with no address", () => {
    const refused = postmortemWithoutBriefing({ step: step({ url: undefined }) });

    expect(refused!.message).toBe(`url is missing ${WHY_TAIL}`);
  });

  it("refuses a Datadog view, which is an outage's evidence and not a briefing", () => {
    const refused = postmortemWithoutBriefing({ step: step({ url: DD }) });

    expect(refused!.message).toBe(`url is not a published page ${WHY_TAIL}`);
  });

  it("refuses the Queue, the card the owner came from", () => {
    const refused = postingRefusal({ step: step({ url: "http://localhost:3000/queue" }) });

    expect(refused!.message).toBe(`url is not a published page ${WHY_TAIL}`);
  });

  it("refuses a headline that reads as a sign-in, since a postmortem row has no step the owner performs", () => {
    const refused = postmortemWithoutBriefing({
      step: step({
        url: DD,
        what: "Auth failures blocked 412 customers at checkout: should we send this to join the postmortem (INC-98)?",
      }),
    });

    expect(refused!.message).toBe(`url is not a published page ${WHY_TAIL}`);
  });

  it("leaves a step on any other row to the rules that judge it", () => {
    expect(postmortemWithoutBriefing({ step: step({ row: "steer-incident-postmortem-card", url: DD }) })).toBe(
      undefined,
    );
  });
});

describe("postmortemRowRefusal", () => {
  it("refuses hand post a card on a postmortem row, naming the verb that checks its reply", () => {
    expect(postmortemRowRefusal({ step: step() })).toEqual({
      code: "INVALID_FIELD",
      field: "row",
      message:
        `row ${ROW} is a postmortem row, whose card only \`slopweaver incident postmortem --form <file>\` posts — ` +
        "it checks the parked reply against the form and this verb cannot. There is no override",
    });
  });

  it("leaves a step on any other row to hand post", () => {
    expect(postmortemRowRefusal({ step: step({ row: "steer-incident-postmortem-card" }) })).toBe(undefined);
  });
});

describe("misplacedDecision on a postmortem row", () => {
  it("lets the decision sit beside the briefing page", () => {
    expect(misplacedDecision({ step: step() })).toBe(undefined);
  });

  it("still refuses it beside a Datadog view on a postmortem row", () => {
    const refused = misplacedDecision({ step: step({ url: DD }) });

    expect(refused!.code).toBe("INVALID_FIELD");
    expect(refused!.message).toContain("decision is carried beside a link to another record");
  });
});
