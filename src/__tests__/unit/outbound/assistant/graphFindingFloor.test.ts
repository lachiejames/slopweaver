import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { DetailBlock } from "../../../../outbound/artifact/types.js";
import { parseAnswerArm } from "../../../../outbound/assistant/answerForm.js";
import {
  answerPictureRefusals,
  answerShownToReader,
  graphFindingFloorRefusals,
} from "../../../../outbound/assistant/graphFindingFloor.js";
import type { BareRefContext } from "../../../../outbound/linkify/bareRefs.js";
import { grantedEnv, grantSessionEnv } from "../../../hatchGrantFixture.js";

const NO_CONTEXT: BareRefContext = { repos: [] };
/** The hunt reply's Datadog graph link, on the synthetic `ap1` site rather than the install's own. */
const LEAD =
  "https://ap1.datadoghq.com/logs?query=env%3Aproduction%20status%3Aerror&from_ts=1789740000000&to_ts=1790431200000&live=false&viz=timeseries";
const MEASURED = [{ figures: ["123"], repro: "slopweaver datadog logs count", takenAtIso: "2026-09-26T14:30:00.000Z" }];
const THREE = ["/tmp/a.png", "/tmp/b.png", "/tmp/c.png"];

/** A hunt reply cut to one lead: a measured figure beside its Datadog graph link. */
const HUNT_BODY: readonly DetailBlock[] = [
  {
    runs: [
      { text: "nz cal api key fetch denied, 1 to 123 errors ", type: "text" },
      { label: "[1]", type: "link", url: LEAD },
    ],
    type: "paragraph",
  },
];

let home: string;
let HATCH: Readonly<Record<string, string>>;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "graph-floor-"));
  HATCH = grantedEnv({ hatchIds: ["unshown-graphs"], home });
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("graphFindingFloorRefusals", () => {
  const answer = { body: HUNT_BODY, citations: [], index: [], measurements: MEASURED };

  it("refuses a graph finding short of three screenshots", () => {
    const floor = graphFindingFloorRefusals({ answer, env: {}, home, images: ["/tmp/a.png"] });
    expect(floor.owed).toBe(true);
    expect(floor.refusals.length).toBe(1);
    expect(floor.refusals[0]).toContain("attaches 1 distinct screenshot(s)");
  });

  it("stays owed but refuses nothing when the hatch is open", () => {
    expect(graphFindingFloorRefusals({ answer, env: HATCH, home, images: [] })).toEqual({ owed: true, refusals: [] });
  });

  it("still refuses with the old variable set and no grant", () => {
    const emptyHome = join(home, "no-grants");
    const env = { ...grantSessionEnv({ home: emptyHome }), SLOPWEAVER_ALLOW_UNSHOWN_GRAPHS: "1" };
    const floor = graphFindingFloorRefusals({ answer, env, home: emptyHome, images: [] });
    expect(floor.refusals.length).toBe(1);
  });

  it("refuses a graph that rides only in the answering permalink", () => {
    const bare = {
      answering: { permalink: LEAD, quote: "the graph" },
      body: [],
      citations: [],
      index: [],
      measurements: MEASURED,
    };
    const floor = graphFindingFloorRefusals({ answer: bare, env: {}, home, images: [] });
    expect(floor.owed).toBe(true);
    expect(floor.refusals[0]).toContain("attaches 0 distinct screenshot(s)");
  });

  it("owes nothing once three distinct screenshots ride along", () => {
    expect(graphFindingFloorRefusals({ answer, env: {}, home, images: THREE })).toEqual({ owed: false, refusals: [] });
  });
});

describe("answerPictureRefusals — the floor silences rule two's question", () => {
  const answer = { body: HUNT_BODY, citations: [], images: [], index: [], measurements: MEASURED };

  it("gives the floor's refusal alone, never rule two's attach-one-or-say-why beside it", () => {
    const refusals = answerPictureRefusals({ answer, context: NO_CONTEXT, env: {} });
    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("a graph finding carries at least 3");
  });

  it("is not answered by noPictureBecause", () => {
    const refusals = answerPictureRefusals({
      answer: { ...answer, noPictureBecause: "the numbers say it all" },
      context: NO_CONTEXT,
      env: {},
    });
    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("`noPictureBecause` does not answer this");
  });

  it("refuses nothing when the hatch is open, and asks no generic question either", () => {
    expect(answerPictureRefusals({ answer, context: NO_CONTEXT, env: HATCH })).toEqual([]);
  });

  it("owes no Datadog picture for a URL that rides only in followThrough, which never renders", () => {
    const quiet = { body: [], citations: [], images: [], index: [], measurements: [] };
    const followThrough = { owes: "other", what: "check https://app.datadoghq.com/logs tomorrow" };
    const unrendered = { ...quiet, followThrough };
    expect(answerPictureRefusals({ answer: unrendered, context: NO_CONTEXT, env: {} })).toEqual([]);
    const shown = { ...quiet, lead: "see https://app.datadoghq.com/logs" };
    expect(answerPictureRefusals({ answer: shown, context: NO_CONTEXT, env: {} })[0]).toContain(
      "media: this message cites Datadog (https://app.datadoghq.com/logs)",
    );
  });

  it("still refuses a stale noPictureBecause once the floor is met", () => {
    const refusals = answerPictureRefusals({
      answer: { ...answer, images: THREE, noPictureBecause: "none needed" },
      context: NO_CONTEXT,
      env: {},
    });
    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("noPictureBecause: ");
  });
});

describe("answerShownToReader", () => {
  it("keeps the rendered fields and cuts grounding to its evidence and provenance", () => {
    const answer = {
      followThrough: { owes: "other", what: "https://app.datadoghq.com/logs" },
      grounding: {
        evidence: { read: [] },
        kind: "verb",
        provenance: { model: "m" },
        result: "https://app.datadoghq.com/logs",
      },
      lead: "shown",
      samples: [],
    };
    expect(answerShownToReader({ answer })).toEqual({
      grounding: { evidence: { read: [] }, provenance: { model: "m" } },
      lead: "shown",
    });
  });
});

/** A minimal answer arm carrying the hunt body, its measurement and the given images. */
function huntRaw({ images }: { images: readonly string[] }): unknown {
  return {
    body: HUNT_BODY,
    citations: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "no live check needed" },
        premiseChecks: [],
        read: [],
      },
      kind: "conversation",
      provenance: { model: "claude-opus-5-5", skillsLoaded: [], verbsLoaded: [] },
      reason: "context and judgement alone were sufficient",
    },
    images,
    index: [],
    kind: "answer",
    lead: "one real regression nobody flagged",
    measurements: MEASURED,
  };
}

describe("parseAnswerArm — a regression-hunt reply, end to end", () => {
  it("refuses the reply as it shipped, with no image", () => {
    const refusals = unwrapErr(parseAnswerArm({ context: NO_CONTEXT, env: {}, raw: huntRaw({ images: [] }) }));
    const pictures = refusals.filter((line) => line.startsWith("images: "));
    expect(pictures.length).toBe(1);
    expect(pictures[0]).toContain("a graph finding carries at least 3");
  });

  it("parses the same reply carrying three screenshots", () => {
    const answer = unwrap(parseAnswerArm({ context: NO_CONTEXT, env: {}, raw: huntRaw({ images: THREE }) }));
    expect(answer.images).toEqual(THREE);
  });

  it("parses it with the journalled hatch open", () => {
    const answer = unwrap(parseAnswerArm({ context: NO_CONTEXT, env: HATCH, raw: huntRaw({ images: [] }) }));
    expect(answer.images).toEqual([]);
  });
});
