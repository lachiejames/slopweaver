import { describe, expect, it } from "vitest";

import { inventedVisualsIn } from "../../../admit/inventedVisual.js";
import { INVENTED_VISUAL_OVERRIDE, inventedVisualFindings } from "../../../admit/inventedVisualGate.js";
import { answerVisuals, prBodyVisuals } from "../../../admit/inventedVisualSeams.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";

/** A valid answer with only the two fields these collectors read varied. */
function answerOf({
  images,
  body,
}: {
  images: AnswerFormAnswer["images"];
  body: AnswerFormAnswer["body"];
}): AnswerFormAnswer {
  return {
    body,
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: {
        model: "the dispatched worker in workspace:1 (Claude Code, in-turn)",
        skillsLoaded: [],
        verbsLoaded: [],
      },
      reason: "answered from the thread",
    },
    images,
    index: [],
    kind: "answer",
    lead: "the pool exhausted at 03:00Z",
    measurements: [],
  };
}

describe("answerVisuals", () => {
  it("collects the attached image paths, images first", () => {
    expect(answerVisuals({ answer: answerOf({ body: [], images: ["/tmp/a.png", "/tmp/b.png"] }) })).toStrictEqual([
      { ref: "/tmp/a.png", seam: "answer-image" },
      { ref: "/tmp/b.png", seam: "answer-image" },
    ]);
  });

  it("collects the URL of a link run rendered in the body", () => {
    const answer = answerOf({
      body: [
        {
          runs: [{ label: "before", type: "link", url: "http://127.0.0.1:8792/before.html" }],
          type: "paragraph",
        },
      ],
      images: [],
    });
    expect(answerVisuals({ answer })).toStrictEqual([
      { ref: "http://127.0.0.1:8792/before.html", seam: "answer-image" },
    ]);
  });

  it("collects nothing from an answer carrying neither", () => {
    expect(answerVisuals({ answer: answerOf({ body: [], images: [] }) })).toStrictEqual([]);
  });

  it("refuses the incident's own link when handed to the detector", () => {
    const answer = answerOf({
      body: [
        {
          runs: [{ label: "before", type: "link", url: "http://127.0.0.1:8792/before.html" }],
          type: "paragraph",
        },
      ],
      images: [],
    });
    const findings = inventedVisualFindings({ visuals: answerVisuals({ answer }) });
    expect(findings.map((finding) => finding.code)).toStrictEqual([
      "INVENTED_VISUAL_LOCAL_RENDER_URL",
      "INVENTED_VISUAL_PAGE_NOT_CAPTURE",
    ]);
    expect(findings[0]!.severity).toBe("warn");
  });

  it("lets an answer standing on a real attachment through", () => {
    const answer = answerOf({
      body: [
        {
          runs: [{ label: "the monitor", type: "link", url: "https://app.example.com/monitors/1" }],
          type: "paragraph",
        },
      ],
      images: ["/tmp/captures/monitor-panel.png"],
    });
    expect(inventedVisualsIn({ visuals: answerVisuals({ answer }) })).toStrictEqual([]);
  });
});

describe("prBodyVisuals", () => {
  it("collects an HTML embed in either quote style", () => {
    expect(
      prBodyVisuals({ body: `<img src="http://127.0.0.1:8792/before.html"><img src='/tmp/after.svg'>` }),
    ).toStrictEqual([
      { ref: "http://127.0.0.1:8792/before.html", seam: "pr-embed" },
      { ref: "/tmp/after.svg", seam: "pr-embed" },
    ]);
  });

  it("collects a markdown image", () => {
    expect(prBodyVisuals({ body: "![before](http://localhost:8792/before.html)" })).toStrictEqual([
      { ref: "http://localhost:8792/before.html", seam: "pr-embed" },
    ]);
  });

  it("ignores a plain link, which describes where something runs rather than proving anything", () => {
    expect(prBodyVisuals({ body: "the console runs at [locally](http://127.0.0.1:8792/)" })).toStrictEqual([]);
  });

  it("collects nothing from a body with no embeds", () => {
    expect(prBodyVisuals({ body: "| **Problem** | it broke |" })).toStrictEqual([]);
  });
});

describe("INVENTED_VISUAL_OVERRIDE", () => {
  it("is the one token every seam's break-glass quotes", () => {
    expect(INVENTED_VISUAL_OVERRIDE).toBe("visual.invented:v1");
  });
});
