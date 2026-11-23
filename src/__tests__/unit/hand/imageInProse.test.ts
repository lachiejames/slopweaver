/*
 * A hand step's picture goes in `--shot` with a box on what to grab, never named as a path in its prose (an image on a card
 * is seen on the queue card).
 */
import { describe, expect, it } from "vitest";

import { HandStepErrors } from "../../../hand/errors.js";
import { imageInProse } from "../../../hand/imageInProse.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

const DRAFT: HandStepDraft = {
  id: "vanta-network-segregation-evidence",
  postedBy: "workspace:1",
  postedIso: "2026-10-05T12:10:00.000Z",
  row: "vanta-evidence",
  unblocks: "The Vanta network-segregation control reads as current again",
  url: "https://app.vanta.com/tests",
  what: "Upload the current network diagram to the network segregation control",
  where: "Vanta, Tests, Network segregation (ISO 2.1 and 3)",
  witness: "slopweaver vanta tests lists network segregation as passing",
};

/** A step built by the real builder from the draft with a case's changes. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(buildHandStep({ draft: { ...DRAFT, ...over } }));
}

describe("imageInProse", () => {
  it("passes a step whose prose names no picture", () => {
    expect(imageInProse({ step: step() })).toBe(undefined);
  });

  it("refuses the first field naming a picture, with the file and the flag that attaches it", () => {
    expect(imageInProse({ step: step({ where: "Vanta, Tests — as in ~/shots/net-93.png" }) })).toEqual(
      HandStepErrors.invalidField({
        field: "where",
        why:
          'names the picture "~/shots/net-93.png" as text, which the card draws as a path the owner cannot see — attach it ' +
          "with --shot <png> --box x,y,width,height=<label> so the card shows it with a box on what to grab, and say " +
          "in words what it shows",
      }),
    );
  });

  it("does not read the step's url, which is a link the owner opens rather than prose", () => {
    expect(imageInProse({ step: step({ url: "https://example.com/net-93.png" }) })).toBe(undefined);
  });
});
