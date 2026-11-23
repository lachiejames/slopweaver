import { describe, expect, it } from "vitest";

import { afterPhotograph } from "../../../../../cli/commands/desktop/e2eQueueCard.js";
import { E2eStepBlocks, E2eStepNotApplicables } from "../../../../../desktop/e2eErrors.js";

const EMPTY = E2eStepNotApplicables.queueEmpty();
const SHOT = "/proof/run/02-queue-card.png";

describe("afterPhotograph — a not-applicable step stands on its photograph", () => {
  it("keeps the not-applicable reason when the photograph was taken and the measured-zero line is still drawn", () => {
    expect(afterPhotograph({ blocked: undefined, emptyDrawn: true, notApplicable: EMPTY, screenshot: SHOT })).toEqual({
      blocked: undefined,
      notApplicable: EMPTY.message,
    });
  });

  it("blocks a step whose photograph could not be taken, even with the line still drawn", () => {
    expect(
      afterPhotograph({ blocked: undefined, emptyDrawn: true, notApplicable: EMPTY, screenshot: undefined }),
    ).toEqual({ blocked: E2eStepBlocks.queueEmptyUnphotographed().message, notApplicable: undefined });
  });

  it("blocks a step whose measured-zero line was gone once photographed", () => {
    expect(afterPhotograph({ blocked: undefined, emptyDrawn: false, notApplicable: EMPTY, screenshot: SHOT })).toEqual({
      blocked: E2eStepBlocks.queueEmptyLost().message,
      notApplicable: undefined,
    });
  });

  it("passes a step that acted through untouched, its block kept and no line looked for", () => {
    expect(
      afterPhotograph({
        blocked: "no page showed /fleet",
        emptyDrawn: false,
        notApplicable: undefined,
        screenshot: SHOT,
      }),
    ).toEqual({ blocked: "no page showed /fleet", notApplicable: undefined });
    expect(
      afterPhotograph({ blocked: undefined, emptyDrawn: false, notApplicable: undefined, screenshot: undefined }),
    ).toEqual({ blocked: undefined, notApplicable: undefined });
  });
});
