import { describe, expect, it } from "vitest";

import { type BriefingCommandError, briefingCommandErrorLines } from "../../../../../cli/commands/briefing/errors.js";
import {
  type BriefingNarrativeSections,
  injectNarrative,
} from "../../../../../cli/commands/briefing/injectNarrative.js";
import {
  injectAutonomy,
  injectFreshness,
  injectHandSteps,
  injectNothingStale,
  injectOpenArtifacts,
  injectOwnerBeliefs,
  injectQuiz,
  injectYourList,
  refuseComposedProjection,
} from "../../../../../cli/commands/briefing/injectSections.js";
import { type Result, unwrap } from "../../../../../lib/result.js";
import type { BriefingHandSteps } from "../../../../../outbound/briefing/types.js";

/** The projected hand-step section, the one used wherever a case needs a section with a row in it. */
const HAND_STEPS: BriefingHandSteps = {
  notShown: 0,
  rows: [
    {
      id: "backup-sa-needs-object-delete",
      postedIso: "2026-09-20T22:04:11.000Z",
      tier: "fleet-blocked",
      unblocks: "the nightly backup sweep",
      what: "grant the backup service account objectAdmin",
      witness: "slopweaver hand done backup-sa-needs-object-delete",
    },
  ],
  unreadable: 0,
};

/** The messages one refusal carried, so a case names the failure rather than only that there was one. */
const messages = ({ result }: { result: Result<unknown, BriefingCommandError> }): readonly string[] => {
  expect(result.isErr()).toBe(true);
  return briefingCommandErrorLines({ error: result._unsafeUnwrapErr() });
};

describe("refuseComposedProjection", () => {
  it("names the field and what fills it instead, in the one sentence every section shares", () => {
    expect(messages({ result: refuseComposedProjection({ field: "handSteps", why: "Pass `--hand-steps`." }) })).toEqual(
      ["the form writes `handSteps` itself. Pass `--hand-steps`."],
    );
  });
});

describe("a composer that authored a projected section", () => {
  it("is refused on handSteps, and told the register's bytes are the point", () => {
    const refusal = messages({ result: injectHandSteps({ handSteps: undefined, json: { handSteps: {} } }) })[0]!;
    expect(refusal).toContain("the form writes `handSteps` itself.");
    expect(refusal).toContain("Drop it, and pass `--hand-steps`.");
  });

  it("is refused on autonomy", () => {
    expect(messages({ result: injectAutonomy({ autonomy: undefined, json: { autonomy: {} } }) })[0]!).toContain(
      "the form writes `autonomy` itself.",
    );
  });

  it("is refused on quiz", () => {
    expect(messages({ result: injectQuiz({ json: { quiz: {} }, quiz: undefined }) })[0]!).toContain(
      "the form writes `quiz` itself.",
    );
  });

  it("is refused on ownerBeliefs", () => {
    expect(
      messages({ result: injectOwnerBeliefs({ json: { ownerBeliefs: {} }, ownerBeliefs: undefined }) })[0]!,
    ).toContain("the form writes `ownerBeliefs` itself.");
  });

  it("is refused on freshness, and told which flag projects it", () => {
    expect(messages({ result: injectFreshness({ freshness: undefined, json: { freshness: {} } }) })).toEqual([
      "the form writes `freshness` itself. That section is projected from this machine's own resync roster and " +
        "outcomes, never composed — drop it from the form and pass `--freshness` instead.",
    ]);
  });

  it("is refused on nothingStale, and told which flag projects it", () => {
    expect(messages({ result: injectNothingStale({ json: { nothingStale: {} }, nothingStale: undefined }) })).toEqual([
      "the form writes `nothingStale` itself. That section is projected from the documents this machine's " +
        "standing rows wrote, never composed — drop it from the form and pass `--nothing-stale` instead.",
    ]);
  });

  it("gets the projected Nothing stale section spliced in when it wrote none", () => {
    const nothingStale = { id: "nothing-stale", notes: [], summary: "0 known stale · all five surfaces seen" };
    expect(unwrap(injectNothingStale({ json: { header: 1 }, nothingStale }))).toEqual({ header: 1, nothingStale });
  });

  it("is refused on yourList", () => {
    expect(messages({ result: injectYourList({ json: { yourList: {} }, yourList: undefined }) })[0]!).toContain(
      "the form writes `yourList` itself.",
    );
  });

  it("is refused on reactNow.openArtifacts, nested one level down", () => {
    const refusal = messages({
      result: injectOpenArtifacts({ json: { reactNow: { openArtifacts: [] } }, openArtifacts: undefined }),
    })[0]!;
    expect(refusal).toContain("the form writes `reactNow.openArtifacts` itself.");
  });
});

describe("attaching what the verb projected", () => {
  it("puts the section on the form and leaves every other field alone", () => {
    expect(unwrap(injectHandSteps({ handSteps: HAND_STEPS, json: { headline: "one thing" } }))).toEqual({
      handSteps: HAND_STEPS,
      headline: "one thing",
    });
  });

  it("attaches nothing at all when the run projected nothing", () => {
    expect(unwrap(injectHandSteps({ handSteps: undefined, json: { headline: "one thing" } }))).toEqual({
      headline: "one thing",
    });
  });

  it("nests the open-artifact index under reactNow, keeping the cards the composer wrote beside it", () => {
    const artifacts = [
      {
        ask: [{ kind: "text" as const, text: "Pick A or B." }],
        label: "Open page 1",
        landedIso: "2026-09-06T04:00:00Z",
        rank: 1,
        url: "https://example.invalid/page-1",
        validity: { mark: "valid" as const },
      },
    ];
    expect(unwrap(injectOpenArtifacts({ json: { reactNow: { meFacing: [] } }, openArtifacts: artifacts }))).toEqual({
      reactNow: { meFacing: [], openArtifacts: artifacts },
    });
  });

  it("leaves a form that is not an object alone rather than wrapping it", () => {
    expect(unwrap(injectHandSteps({ handSteps: HAND_STEPS, json: "not a form" }))).toBe("not a form");
  });
});

/** The three sections `--ticks` projects, empty of notes so a case reads only where they land. */
const NARRATIVE: BriefingNarrativeSections = {
  earlierToday: { notes: [], summary: "Earlier today" },
  history: [{ notes: [], summary: "Yesterday" }],
  recent: [],
};

describe("injectNarrative", () => {
  it("leaves an authored narrative alone when the run projected none", () => {
    const json = { headline: "one thing", history: [{ notes: [], summary: "Yesterday" }] };
    expect(unwrap(injectNarrative({ json, narrative: undefined }))).toEqual({
      headline: "one thing",
      history: [{ notes: [], summary: "Yesterday" }],
    });
  });

  it("refuses a composed quoted lane nested inside history when the run projected none", () => {
    const json = { history: [{ notes: [{ lane: "quoted" }], summary: "Yesterday" }] };
    const refusal = messages({ result: injectNarrative({ json, narrative: undefined }) })[0]!;
    expect(refusal).toContain("the form writes `history` itself.");
    expect(refusal).toContain('One of its notes is marked `lane: "quoted"` and this run projected nothing.');
  });

  it("names every authored narrative field in one refusal when the run projected the narrative", () => {
    const json = { history: [], recent: [] };
    const refusal = messages({ result: injectNarrative({ json, narrative: NARRATIVE }) })[0]!;
    expect(refusal).toContain("the form writes `recent`, `history` itself.");
    expect(refusal).toContain("Drop them from the form, or drop `--ticks` and keep writing all three.");
  });

  it("splices all three projected sections in beside every other field", () => {
    expect(unwrap(injectNarrative({ json: { headline: "one thing" }, narrative: NARRATIVE }))).toEqual({
      earlierToday: NARRATIVE.earlierToday,
      headline: "one thing",
      history: NARRATIVE.history,
      recent: NARRATIVE.recent,
    });
  });

  it("leaves a form that is not an object alone even with a projected narrative", () => {
    expect(unwrap(injectNarrative({ json: "not a form", narrative: NARRATIVE }))).toBe("not a form");
  });
});
